import base64
import json
import time
import requests
import subprocess
from pathlib import Path

KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = 'gemini-3.5-flash-lite'
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}"
HEADERS = {'Content-Type': 'application/json'}

FIXTURES_DIR = Path("spikes/fixtures")

schema = {
    "type": "object",
    "properties": {
        "transcript": {"type": "string"},
        "summary": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "detected_language": {"type": "string"},
        "song_identification": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "artist": {"type": "string"},
                "is_original_audio": {"type": "boolean"}
            },
            "required": ["title", "artist", "is_original_audio"]
        }
    },
    "required": ["transcript", "summary", "tags", "detected_language", "song_identification"]
}

with open(FIXTURES_DIR / "ig_embed_summary.json") as f:
    items = json.load(f)

# Filter items with video_url and ground truth music
eval_items = []
for it in items:
    if it.get("has_video_url") and it.get("has_music"):
        fixture_file = FIXTURES_DIR / f"ig_embed_{it['code']}.json"
        if fixture_file.exists():
            with open(fixture_file) as ff:
                data = json.load(ff)
                it["full_video_url"] = data.get("video_url")
                eval_items.append(it)

print(f"Testing song identification and schema on {len(eval_items)} reels against ground truth...")

results = []
schema_compliant_count = 0
song_correct_count = 0

for idx, item in enumerate(eval_items):
    code = item["code"]
    gt_song = item.get("song_name", "").strip().lower()
    gt_artist = item.get("artist_name", "").strip().lower()
    gt_original = item.get("uses_original", False)
    
    # Download small chunk (first 1.5MB) or extract audio
    mp4_path = FIXTURES_DIR / f"reel_{code}.mp4"
    audio_path = FIXTURES_DIR / f"reel_{code}.m4a"
    
    try:
        if not audio_path.exists():
            print(f"[{idx+1}/{len(eval_items)}] Fetching video {code}...")
            r_vid = requests.get(item["full_video_url"], timeout=15)
            with open(mp4_path, "wb") as f:
                f.write(r_vid.content)
            # Extract audio
            subprocess.run(["ffmpeg", "-y", "-i", str(mp4_path), "-vn", "-c:a", "copy", str(audio_path)], capture_output=True)
            # Remove mp4 to save disk
            if mp4_path.exists():
                mp4_path.unlink()

        # Read audio
        with open(audio_path, "rb") as af:
            audio_bytes = af.read()
        
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        
        payload = {
            "contents": [{
                "parts": [
                    {"inline_data": {"mime_type": "audio/m4a", "data": audio_b64}},
                    {"text": "Analyze this reel audio. Transcribe exact speech. Identify song and artist if commercial music is playing. Return valid JSON."}
                ]
            }],
            "generationConfig": {
                "response_mime_type": "application/json",
                "response_schema": schema
            }
        }
        
        t0 = time.time()
        r_llm = requests.post(URL, headers=HEADERS, json=payload, timeout=45)
        elapsed = time.time() - t0
        
        if r_llm.status_code == 200:
            resp_json = r_llm.json()
            cand_text = resp_json.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            
            # Check schema compliance
            parsed_out = None
            is_compliant = False
            try:
                parsed_out = json.loads(cand_text)
                if all(k in parsed_out for k in ["transcript", "summary", "tags", "detected_language", "song_identification"]):
                    is_compliant = True
                    schema_compliant_count += 1
            except Exception:
                is_compliant = False
                
            pred_song_obj = parsed_out.get("song_identification", {}) if parsed_out else {}
            pred_title = pred_song_obj.get("title", "").strip().lower()
            pred_artist = pred_song_obj.get("artist", "").strip().lower()
            pred_original = pred_song_obj.get("is_original_audio", False)
            
            # Ground truth comparison:
            # If ground truth was "Original audio", match if pred_original is True or title is "unknown" / "none" / "original audio"
            # If ground truth was a specific song, match if song name substring matches
            is_match = False
            if gt_original:
                if pred_original or pred_title in ["unknown", "none", "original", "original audio", "", gt_song]:
                    is_match = True
            else:
                if gt_song in pred_title or pred_title in gt_song:
                    is_match = True
                    
            if is_match:
                song_correct_count += 1
                
            record = {
                "code": code,
                "ground_truth": {
                    "song": item.get("song_name"),
                    "artist": item.get("artist_name"),
                    "is_original": gt_original
                },
                "gemini_prediction": pred_song_obj,
                "detected_language": parsed_out.get("detected_language") if parsed_out else None,
                "transcript_snippet": (parsed_out.get("transcript") or "")[:80] if parsed_out else None,
                "schema_compliant": is_compliant,
                "song_match": is_match,
                "elapsed_s": round(elapsed, 2)
            }
            results.append(record)
            print(f"[{idx+1}/{len(eval_items)}] {code}: GT='{item.get('song_name')}' | PRED='{pred_song_obj.get('title')}' (orig:{pred_original}) | MATCH:{is_match} | Schema:{is_compliant}")
        elif r_llm.status_code == 429:
            print(f"[{idx+1}/{len(eval_items)}] Hit 429 rate limit! Pausing 5s...")
            time.sleep(5)
        else:
            print(f"[{idx+1}/{len(eval_items)}] Error {r_llm.status_code}: {r_llm.text[:100]}")
            
        # Respect 15 RPM (4s between requests)
        time.sleep(4.1)

    except Exception as e:
        print(f"[{idx+1}/{len(eval_items)}] Exception: {e}")

out_file = FIXTURES_DIR / "gemini_song_id_eval.json"
with open(out_file, "w") as f:
    json.dump({
        "total_tested": len(results),
        "schema_compliance_rate": f"{schema_compliant_count}/{len(results)} ({schema_compliant_count/max(1, len(results))*100:.1f}%)",
        "song_id_accuracy": f"{song_correct_count}/{len(results)} ({song_correct_count/max(1, len(results))*100:.1f}%)",
        "items": results
    }, f, indent=2)

print("\n=== EVALUATION RESULTS ===")
print(f"Total tested (n): {len(results)}")
print(f"Schema Compliance: {schema_compliant_count}/{len(results)} ({schema_compliant_count/max(1, len(results))*100:.1f}%)")
print(f"Song ID Accuracy: {song_correct_count}/{len(results)} ({song_correct_count/max(1, len(results))*100:.1f}%)")


import base64
import time
import json
import requests

KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = 'gemini-3.5-flash-lite'
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}"
HEADERS = {'Content-Type': 'application/json'}

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

# 1. Test Video MP4 Inline
with open('spikes/fixtures/sample_reel.mp4', 'rb') as f:
    video_b64 = base64.b64encode(f.read()).decode('utf-8')

payload_video = {
    "contents": [{
        "parts": [
            {"inline_data": {"mime_type": "video/mp4", "data": video_b64}},
            {"text": "Analyze this reel video. Return JSON with transcript, summary, tags, detected_language, and song_identification."}
        ]
    }],
    "generationConfig": {
        "response_mime_type": "application/json",
        "response_schema": schema
    }
}

print("Sending Video MP4 inline (992 KB)...")
t0 = time.time()
r_vid = requests.post(URL, headers=HEADERS, json=payload_video, timeout=60)
vid_duration = time.time() - t0
print(f"Video Status: {r_vid.status_code}, Duration: {vid_duration:.2f}s")
vid_res = r_vid.json() if r_vid.status_code == 200 else r_vid.text

# 2. Test Audio M4A Inline
with open('spikes/fixtures/sample_audio.m4a', 'rb') as f:
    audio_b64 = base64.b64encode(f.read()).decode('utf-8')

payload_audio = {
    "contents": [{
        "parts": [
            {"inline_data": {"mime_type": "audio/m4a", "data": audio_b64}},
            {"text": "Analyze this reel audio. Return JSON with transcript, summary, tags, detected_language, and song_identification."}
        ]
    }],
    "generationConfig": {
        "response_mime_type": "application/json",
        "response_schema": schema
    }
}

print("Sending Audio M4A inline (50 KB)...")
t1 = time.time()
r_aud = requests.post(URL, headers=HEADERS, json=payload_audio, timeout=60)
aud_duration = time.time() - t1
print(f"Audio Status: {r_aud.status_code}, Duration: {aud_duration:.2f}s")
aud_res = r_aud.json() if r_aud.status_code == 200 else r_aud.text

comparison = {
    "video_mp4": {
        "size_bytes": len(video_b64),
        "duration_s": round(vid_duration, 2),
        "status_code": r_vid.status_code,
        "usage": vid_res.get("usageMetadata") if isinstance(vid_res, dict) else None,
        "content": vid_res.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text") if isinstance(vid_res, dict) else str(vid_res)
    },
    "audio_m4a": {
        "size_bytes": len(audio_b64),
        "duration_s": round(aud_duration, 2),
        "status_code": r_aud.status_code,
        "usage": aud_res.get("usageMetadata") if isinstance(aud_res, dict) else None,
        "content": aud_res.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text") if isinstance(aud_res, dict) else str(aud_res)
    }
}

with open('spikes/fixtures/gemini_video_vs_audio.json', 'w') as f:
    json.dump(comparison, f, indent=2)

print("\n--- COMPARISON RESULTS ---")
print("Video input tokens:", comparison["video_mp4"]["usage"])
print("Audio input tokens:", comparison["audio_m4a"]["usage"])
print("Video content:", comparison["video_mp4"]["content"])
print("Audio content:", comparison["audio_m4a"]["content"])


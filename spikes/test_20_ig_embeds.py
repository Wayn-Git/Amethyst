import sqlite3
import requests
import json
import re
import time
import os
from pathlib import Path

FIXTURES_DIR = Path("spikes/fixtures")
FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

con = sqlite3.connect('/home/wayne/.amethyst/amethyst.db')
cur = con.cursor()
cur.execute("SELECT DISTINCT url FROM library_items WHERE url LIKE '%instagram.com/reel/%'")
db_urls = [r[0] for r in cur.fetchall()]

shortcodes = []
for u in db_urls:
    m = re.search(r'/reel/([A-Za-z0-9_-]+)', u)
    if m:
        c = m.group(1)
        if c not in shortcodes:
            shortcodes.append(c)

for c in ['DV79WToDXwb', 'DVlQSpfk8tl']:
    if c not in shortcodes:
        shortcodes.insert(0, c)

target_codes = shortcodes[:25]
print(f"Testing {len(target_codes)} Instagram Reel shortcodes...")

headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Accept-Language': 'en-US,en;q=0.9',
}

results = []

for idx, code in enumerate(target_codes):
    url = f"https://www.instagram.com/p/{code}/embed/captioned/"
    t0 = time.time()
    try:
        r = requests.get(url, headers=headers, timeout=12)
        elapsed = time.time() - t0
        status = r.status_code
        html = r.text
        
        extracted = None
        scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', html)
        for s in scripts:
            if 'contextJSON' in s:
                s_idx = s.find('s.handle(')
                if s_idx != -1:
                    raw = s[s_idx+len('s.handle('):]
                    dec = json.JSONDecoder()
                    try:
                        data, end = dec.raw_decode(raw)
                        for item in data.get('require', []):
                            for sub in item:
                                if isinstance(sub, list):
                                    for ssub in sub:
                                        if isinstance(ssub, dict) and 'contextJSON' in ssub:
                                            inner = json.loads(ssub['contextJSON'])
                                            media = inner.get('gql_data', {}).get('shortcode_media')
                                            if media:
                                                extracted = media
                                                break
                    except Exception:
                        pass
            if extracted:
                break
                
        if extracted:
            has_video_url = bool(extracted.get('video_url'))
            has_caption = bool(extracted.get('edge_media_to_caption', {}).get('edges'))
            caption_text = extracted.get('edge_media_to_caption', {}).get('edges', [{}])[0].get('node', {}).get('text', '')
            music_info = extracted.get('clips_music_attribution_info') or {}
            song_name = music_info.get('song_name')
            artist_name = music_info.get('artist_name')
            uses_original = music_info.get('uses_original_audio')
            
            oe_val = None
            ttl_hours = None
            if has_video_url:
                m_oe = re.search(r'oe=([0-9A-Fa-f]+)', extracted['video_url'])
                if m_oe:
                    oe_hex = int(m_oe.group(1), 16)
                    ttl_hours = (oe_hex - int(time.time())) / 3600.0
                    oe_val = m_oe.group(1)
            
            fixture_path = FIXTURES_DIR / f"ig_embed_{code}.json"
            with open(fixture_path, "w") as f:
                json.dump({
                    "shortcode": code,
                    "id": extracted.get("id"),
                    "caption": caption_text,
                    "video_url": extracted.get("video_url"),
                    "clips_music_attribution_info": music_info,
                    "video_duration": extracted.get("video_duration"),
                    "view_count": extracted.get("video_view_count"),
                    "ttl_hours": ttl_hours,
                }, f, indent=2)

            res = {
                "code": code,
                "status": "PASS",
                "has_video_url": has_video_url,
                "has_caption": has_caption,
                "has_music": bool(music_info),
                "song_name": song_name,
                "artist_name": artist_name,
                "uses_original": uses_original,
                "ttl_hours": round(ttl_hours, 1) if ttl_hours else None,
                "elapsed_s": round(elapsed, 2)
            }
        else:
            res = {
                "code": code,
                "status": "FAIL",
                "reason": "shortcode_media not found (error page / removed / private)",
                "elapsed_s": round(elapsed, 2)
            }
    except Exception as e:
        res = {
            "code": code,
            "status": "ERROR",
            "reason": str(e),
            "elapsed_s": round(time.time() - t0, 2)
        }
    
    results.append(res)
    print(f"[{idx+1}/{len(target_codes)}] {code}: {res['status']} | video:{res.get('has_video_url')} | music:{res.get('has_music')} ({res.get('song_name')}) | ttl:{res.get('ttl_hours')}h")

summary_path = FIXTURES_DIR / "ig_embed_summary.json"
with open(summary_path, "w") as f:
    json.dump(results, f, indent=2)

passed = [r for r in results if r["status"] == "PASS"]
print("\n=== SUMMARY ===")
print(f"Total tested (n): {len(results)}")
print(f"Passed: {len(passed)} ({len(passed)/len(results)*100:.1f}%)")
print(f"With video_url: {sum(1 for r in passed if r['has_video_url'])}/{len(passed)}")
print(f"With music attribution: {sum(1 for r in passed if r['has_music'])}/{len(passed)}")
print(f"With original audio flag: {sum(1 for r in passed if r['uses_original'])}/{len(passed)}")
ttls = [r['ttl_hours'] for r in passed if r.get('ttl_hours') is not None]
if ttls:
    print(f"Avg TTL: {sum(ttls)/len(ttls):.1f}h (min: {min(ttls):.1f}h, max: {max(ttls):.1f}h)")


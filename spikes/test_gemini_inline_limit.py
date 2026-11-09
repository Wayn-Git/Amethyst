import base64
import subprocess
import requests
import time
import json
import os
from pathlib import Path

KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = 'gemini-3.5-flash-lite'
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}"
HEADERS = {'Content-Type': 'application/json'}

# Generate real valid MP4 files using ffmpeg
def make_real_video(target_mb: float, out_path: str):
    # Calculate bitrate needed for 10s video to hit target_mb
    # target_bytes = target_mb * 1024 * 1024
    # bitrate_bps = (target_bytes * 8) / 10
    bitrate_k = int((target_mb * 1024 * 8) / 10)
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=10:size=640x360:rate=30",
        "-b:v", f"{bitrate_k}k", "-maxrate", f"{bitrate_k}k", "-bufsize", f"{bitrate_k*2}k",
        "-pix_fmt", "yuv420p", out_path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

test_sizes = [5.0, 10.0, 14.0, 15.0, 16.0, 18.0]
results = []

for smb in test_sizes:
    vpath = f"/tmp/test_vid_{int(smb)}mb.mp4"
    make_real_video(smb, vpath)
    actual_size = os.path.getsize(vpath) / (1024 * 1024)
    with open(vpath, "rb") as f:
        raw_b = f.read()
    b64_str = base64.b64encode(raw_b).decode("utf-8")
    b64_size_mb = len(b64_str) / (1024 * 1024)
    
    payload = {
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": "video/mp4", "data": b64_str}},
                {"text": "Is this video valid? Reply with 1 word."}
            ]
        }]
    }
    
    t0 = time.time()
    try:
        r = requests.post(URL, headers=HEADERS, json=payload, timeout=60)
        elapsed = time.time() - t0
        err_msg = None
        resp_text = None
        if r.status_code == 200:
            resp_text = r.json().get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '').strip()
        else:
            try:
                err_msg = r.json().get('error', {}).get('message')
            except Exception:
                err_msg = r.text[:120]
                
        record = {
            "target_raw_mb": smb,
            "actual_raw_mb": round(actual_size, 2),
            "b64_body_mb": round(b64_size_mb, 2),
            "status_code": r.status_code,
            "elapsed_s": round(elapsed, 2),
            "response": resp_text,
            "error": err_msg
        }
    except Exception as e:
        record = {
            "target_raw_mb": smb,
            "actual_raw_mb": round(actual_size, 2),
            "b64_body_mb": round(b64_size_mb, 2),
            "status_code": "EXCEPTION",
            "elapsed_s": round(time.time() - t0, 2),
            "error": str(e)
        }
    
    results.append(record)
    print(f"Raw {actual_size:.2f}MB (Base64 Body: {b64_size_mb:.2f}MB) -> Status: {record['status_code']} ({record['elapsed_s']}s) | Resp: {record.get('response')} | Err: {record.get('error')}")
    
    if os.path.exists(vpath):
        os.remove(vpath)
        
    time.sleep(4.2)

with open('spikes/fixtures/gemini_inline_limit_results.json', 'w') as f:
    json.dump(results, f, indent=2)

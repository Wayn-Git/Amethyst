import base64
import requests
import time
import json
import os

KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = 'gemini-3.5-flash-lite'
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}"
HEADERS = {'Content-Type': 'application/json'}

test_files = [
    '/home/wayne/.amethyst/library/media/000357.mp4', # 11.65 MB
    '/home/wayne/.amethyst/library/media/000318.mp4', # 12.16 MB
    '/home/wayne/.amethyst/library/media/000345.mp4', # 15.12 MB
    '/home/wayne/.amethyst/library/media/000265.mp4', # 17.08 MB
    '/home/wayne/.amethyst/library/media/000306.mp4', # 25.04 MB
]

results = []

for fpath in test_files:
    raw_size_mb = os.path.getsize(fpath) / (1024 * 1024)
    print(f"\nReading {fpath} ({raw_size_mb:.2f} MB)...")
    with open(fpath, "rb") as f:
        raw_b = f.read()
    b64_str = base64.b64encode(raw_b).decode("utf-8")
    b64_mb = len(b64_str) / (1024 * 1024)
    print(f"Base64 encoded: {b64_mb:.2f} MB payload.")
    
    payload = {
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": "video/mp4", "data": b64_str}},
                {"text": "Briefly describe this video in 5 words."}
            ]
        }]
    }
    
    t0 = time.time()
    try:
        r = requests.post(URL, headers=HEADERS, json=payload, timeout=90)
        elapsed = time.time() - t0
        status = r.status_code
        err_msg = None
        resp_text = None
        if status == 200:
            resp_text = r.json().get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '').strip()
        else:
            try:
                err_msg = r.json().get('error', {}).get('message')
            except Exception:
                err_msg = r.text[:150]
                
        record = {
            "file": os.path.basename(fpath),
            "raw_size_mb": round(raw_size_mb, 2),
            "b64_mb": round(b64_mb, 2),
            "status_code": status,
            "elapsed_s": round(elapsed, 2),
            "response": resp_text,
            "error": err_msg
        }
    except Exception as e:
        record = {
            "file": os.path.basename(fpath),
            "raw_size_mb": round(raw_size_mb, 2),
            "b64_mb": round(b64_mb, 2),
            "status_code": "EXCEPTION",
            "elapsed_s": round(time.time() - t0, 2),
            "error": str(e)
        }
        
    results.append(record)
    print(f"-> Result: Status {record['status_code']} ({record['elapsed_s']}s) | Resp: {record.get('response')} | Err: {record.get('error')}")
    time.sleep(5.0)

with open('spikes/fixtures/gemini_real_size_limit.json', 'w') as f:
    json.dump(results, f, indent=2)


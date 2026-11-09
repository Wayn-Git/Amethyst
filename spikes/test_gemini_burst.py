import requests
import time
import json
from pathlib import Path

KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = 'gemini-3.5-flash-lite'
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}"
HEADERS = {'Content-Type': 'application/json'}

print(f"=== BURST TEST ON {MODEL} ===")
results = []
t_start = time.time()

# Send rapid requests in a tight loop to trigger rate limits
for i in range(25):
    t0 = time.time()
    payload = {
        'contents': [{'parts': [{'text': f'Return request index {i} in JSON'}]}],
        'generationConfig': {'response_mime_type': 'application/json'}
    }
    r = requests.post(URL, headers=HEADERS, json=payload, timeout=10)
    dur = time.time() - t0
    headers_dict = dict(r.headers)
    
    # Check rate limit headers
    retry_after = r.headers.get('retry-after')
    limit_rpm = r.headers.get('x-ratelimit-limit-requests')
    limit_tpm = r.headers.get('x-ratelimit-limit-tokens')
    remaining_rpm = r.headers.get('x-ratelimit-remaining-requests')
    
    err_msg = None
    if r.status_code != 200:
        try:
            err_json = r.json()
            err_msg = err_json.get('error', {}).get('message')
        except Exception:
            err_msg = r.text[:100]

    record = {
        'req_index': i,
        'status_code': r.status_code,
        'elapsed_s': round(dur, 2),
        'retry_after': retry_after,
        'limit_rpm': limit_rpm,
        'remaining_rpm': remaining_rpm,
        'err_msg': err_msg,
    }
    results.append(record)
    print(f"Req {i+1:02d}: Status {r.status_code} ({dur:.2f}s) | Retry-After: {retry_after} | Err: {err_msg}")
    
    if r.status_code == 429:
        print("Hit 429! Testing exponential backoff recovery...")
        wait_s = float(retry_after) if retry_after else 4.0
        time.sleep(wait_s)
        # retry
        r_retry = requests.post(URL, headers=HEADERS, json=payload, timeout=10)
        print(f"  Retry after {wait_s}s: Status {r_retry.status_code}")
        break

with open('spikes/fixtures/gemini_burst_results.json', 'w') as f:
    json.dump(results, f, indent=2)

print("\nBurst test completed. Total time:", round(time.time() - t_start, 2), "s")


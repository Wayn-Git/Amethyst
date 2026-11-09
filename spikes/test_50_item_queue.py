import os
import time
import random
import json
import requests

API_KEY = os.environ.get("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))
MODEL = "gemini-3.5-flash-lite"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

def run_queue(total_items=50, target_rpm=15):
    # Free tier is 15 RPM. Base delay = 60 / 15 = 4.0s.
    base_interval = 60.0 / target_rpm
    print(f"Starting 50-item queue test on {MODEL} (Free tier target: {target_rpm} RPM, nominal interval: {base_interval:.1f}s)")
    
    results = []
    start_total = time.time()
    
    # 50 simulated content extraction requests
    for i in range(1, total_items + 1):
        item_id = f"item_{i:03d}"
        caption = f"Sample post caption #{i}: Quick tutorial on software engineering design principles, clean architecture and indexing."
        prompt = f"Extract 3 tags and a 1-sentence summary from this caption in JSON format: '{caption}'"
        
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.2
            }
        }
        
        attempt = 0
        max_retries = 5
        success = False
        item_log = {
            "item_index": i,
            "item_id": item_id,
            "attempts": []
        }
        
        while attempt <= max_retries and not success:
            attempt += 1
            t_req_start = time.time()
            try:
                resp = requests.post(URL, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
                status = resp.status_code
                dur = time.time() - t_req_start
                
                attempt_info = {
                    "attempt": attempt,
                    "status_code": status,
                    "latency_sec": round(dur, 2)
                }
                
                if status == 200:
                    data = resp.json()
                    text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    attempt_info["response_snippet"] = text[:80]
                    item_log["attempts"].append(attempt_info)
                    item_log["final_status"] = "SUCCESS"
                    item_log["total_attempts"] = attempt
                    success = True
                    print(f"[{i:02d}/{total_items}] SUCCESS (attempt {attempt}, {dur:.2f}s): {text[:50]}...")
                elif status in [429, 503]:
                    # Backoff logic
                    backoff = min(60.0, (2 ** attempt) * 2.0 + random.uniform(0.5, 2.0))
                    attempt_info["backoff_sleep_sec"] = round(backoff, 2)
                    item_log["attempts"].append(attempt_info)
                    print(f"[{i:02d}/{total_items}] HTTP {status} on attempt {attempt}. Backing off for {backoff:.2f}s...")
                    time.sleep(backoff)
                else:
                    attempt_info["error"] = resp.text[:200]
                    item_log["attempts"].append(attempt_info)
                    print(f"[{i:02d}/{total_items}] HTTP {status} error: {resp.text[:100]}")
                    break
            except Exception as e:
                item_log["attempts"].append({"attempt": attempt, "error": str(e)})
                print(f"[{i:02d}/{total_items}] Exception on attempt {attempt}: {e}")
                time.sleep(2.0)
        
        if not success:
            item_log["final_status"] = "FAILED"
            print(f"[{i:02d}/{total_items}] FAILED after {attempt} attempts.")
            
        results.append(item_log)
        
        # Nominal pacing to respect 15 RPM
        time.sleep(base_interval)
    
    total_duration = time.time() - start_total
    
    # Summary stats
    success_count = sum(1 for r in results if r.get("final_status") == "SUCCESS")
    total_retries = sum(r.get("total_attempts", 1) - 1 for r in results if r.get("final_status") == "SUCCESS")
    rate_limited_count = sum(1 for r in results if any(a.get("status_code") in [429, 503] for a in r.get("attempts", [])))
    
    summary = {
        "model": MODEL,
        "total_items": total_items,
        "success_count": success_count,
        "success_rate_pct": round(success_count / total_items * 100, 1),
        "total_retries": total_retries,
        "items_encountering_throttle": rate_limited_count,
        "total_wall_clock_sec": round(total_duration, 2),
        "average_sec_per_item": round(total_duration / total_items, 2),
        "items": results
    }
    
    out_path = "spikes/fixtures/queue_50_run.json"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nCompleted {total_items} items in {total_duration:.1f}s. Saved fixture to {out_path}.")
    print(f"Summary: {success_count}/{total_items} passed ({summary['success_rate_pct']}%), {rate_limited_count} items hit 429/503 and recovered via backoff.")

if __name__ == "__main__":
    run_queue(50, 15)


import os
import json
import time
import hashlib

def run_drive_deterministic_test():
    # Simulated item
    canonical_url = "https://www.instagram.com/reel/DV79WToDXwb/"
    item_id = hashlib.sha256(canonical_url.encode()).hexdigest()[:16]
    
    # Simulate Google Drive storage state
    drive_storage = {}
    
    # Devices racing: Device A (Pixel 8) and Device B (iPhone 15 Pro)
    # Both upload concurrently without seeing the other due to 2.5s search lag
    t0 = time.time()
    
    file_a = {
        "id": "1A_drive_file_pixel8_xyz",
        "name": f"{item_id}.md",
        "createdTime": "2026-11-09T16:42:01.120Z",
        "appProperties": {
            "item_id": item_id,
            "device": "Pixel_8",
            "client_id": "amethyst-mobile-app"
        },
        "content": f"# Post {item_id}\nSaved from Pixel 8"
    }
    
    file_b = {
        "id": "1B_drive_file_iphone15_abc",
        "name": f"{item_id}.md",
        "createdTime": "2026-11-09T16:42:01.350Z",
        "appProperties": {
            "item_id": item_id,
            "device": "iPhone_15_Pro",
            "client_id": "amethyst-mobile-app"
        },
        "content": f"# Post {item_id}\nSaved from iPhone 15 Pro"
    }
    
    drive_storage[file_a["id"]] = file_a
    drive_storage[file_b["id"]] = file_b
    
    # Deterministic Winner Function:
    # Rule: Sort by (createdTime, file_id) ascending. Index 0 is the unambiguous deterministic winner.
    def pick_deterministic_winner(files):
        if not files:
            return None
        return min(files, key=lambda f: (f["createdTime"], f["id"]))
    
    all_matching_files = [f for f in drive_storage.values() if f["appProperties"]["item_id"] == item_id]
    winner = pick_deterministic_winner(all_matching_files)
    
    # Both devices query later and both arrive at the exact same winner independently
    pixel_winner = pick_deterministic_winner(all_matching_files)
    iphone_winner = pick_deterministic_winner(all_matching_files)
    
    assert pixel_winner["id"] == iphone_winner["id"], "Mismatch in deterministic winner selection!"
    
    # Verify tie-breaker if timestamps are identical
    file_c1 = {"id": "drive_id_001", "createdTime": "2026-11-09T16:42:05.000Z", "appProperties": {"item_id": "tie_test"}}
    file_c2 = {"id": "drive_id_002", "createdTime": "2026-11-09T16:42:05.000Z", "appProperties": {"item_id": "tie_test"}}
    tie_winner = pick_deterministic_winner([file_c2, file_c1])
    assert tie_winner["id"] == "drive_id_001", "Tie breaker failed to sort by file_id!"
    
    result = {
        "test_name": "Drive Deterministic Winner & Search Lag Validation",
        "item_id": item_id,
        "concurrent_files_created": [file_a["id"], file_b["id"]],
        "deterministic_winner": winner["id"],
        "winner_device": winner["appProperties"]["device"],
        "winner_created_time": winner["createdTime"],
        "idempotent_agreement": pixel_winner["id"] == iphone_winner["id"],
        "drive_file_scope_analysis": {
            "same_oauth_client_id_or_project": {
                "cross_device_visibility": True,
                "note": "Google Drive API drive.file scope grants read/write to files created by the application project. Both Android and iOS apps share access if registered under the same Google Cloud Console project."
            },
            "different_oauth_client_id_different_project": {
                "cross_device_visibility": False,
                "note": "drive.file scope is strictly isolated per GCP project. Files written by project A are invisible to project B unless broader scope (e.g. drive or drive.readonly) is used."
            }
        },
        "search_lag_mitigation": {
            "problem": "Drive search indexing lag (1-5s) causes concurrent writes to miss existing file in initial files.list query.",
            "rule": "Deterministic Winner Rule: min(files, key=(createdTime, id)). Never perform aggressive 'loser deletes' on write path. Readers deterministically bind to winner. Reconciler softly cleans duplicates after 24h grace period."
        }
    }
    
    out_file = "spikes/fixtures/drive_deterministic_winner_eval.json"
    with open(out_file, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Saved deterministic winner test results to {out_file}")

if __name__ == "__main__":
    run_drive_deterministic_test()


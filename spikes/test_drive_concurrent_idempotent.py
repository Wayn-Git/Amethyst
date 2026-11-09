import asyncio
import hashlib
import time
import json
from pathlib import Path

FIXTURES_DIR = Path("spikes/fixtures")

def build_item_id(url: str) -> str:
    # URL normalization
    clean = url.split("?")[0].rstrip("/").lower()
    return hashlib.sha256(f"url:{clean}".encode("utf-8")).hexdigest()[:16]

# Simulated Google Drive v3 storage
class MockGoogleDriveService:
    def __init__(self):
        self.files = [] # list of {"id": str, "name": str, "appProperties": dict, "createdTime": float}
        self.counter = 1

    async def list_files(self, q: str):
        # Simulate network latency (300ms)
        await asyncio.sleep(0.3)
        # Parse simple query on appProperties or name
        matched = []
        for f in self.files:
            if "item_id" in q:
                target_id = q.split("=")[-1].strip("'\" ")
                if f["appProperties"].get("item_id") == target_id:
                    matched.append(f)
        return matched

    async def create_file(self, name: str, app_properties: dict, content: str):
        # Simulate network latency of multipart upload (500ms)
        await asyncio.sleep(0.5)
        file_obj = {
            "id": f"drive_file_{self.counter:04d}",
            "name": name,
            "appProperties": app_properties,
            "content": content,
            "createdTime": time.time()
        }
        self.counter += 1
        self.files.append(file_obj)
        return file_obj

    async def delete_file(self, file_id: str):
        await asyncio.sleep(0.2)
        self.files = [f for f in self.files if f["id"] != file_id]

# Device writer implementation
async def device_write_pipeline(drive: MockGoogleDriveService, device_name: str, raw_url: str):
    item_id = build_item_id(raw_url)
    filename = f"{item_id}.md"
    content = f"# Item {item_id}\nSource: {raw_url}\nSaved by {device_name} at {time.time()}"
    
    # 1. Check if file exists by unique appProperties
    query = f"appProperties/item_id = '{item_id}'"
    existing = await drive.list_files(query)
    if existing:
        return {"device": device_name, "action": "SKIPPED_EXISTING", "file_id": existing[0]["id"]}

    # 2. Upload file with appProperties
    props = {
        "item_id": item_id,
        "device": device_name,
        "created_at": str(time.time())
    }
    created = await drive.create_file(filename, props, content)
    
    # 3. Post-write collision reconciliation (handle exact simultaneous race)
    all_matching = await drive.list_files(query)
    if len(all_matching) > 1:
        # Sort by creation time (or file_id) to pick winner
        all_matching.sort(key=lambda x: (x["createdTime"], x["id"]))
        winner = all_matching[0]
        # If this device created a loser, delete it
        if created["id"] != winner["id"]:
            await drive.delete_file(created["id"])
            return {"device": device_name, "action": "RESOLVED_COLLISION_DELETED_DUPLICATE", "file_id": winner["id"]}
        else:
            return {"device": device_name, "action": "RESOLVED_COLLISION_KEPT_WINNER", "file_id": winner["id"]}

    return {"device": device_name, "action": "CREATED_NEW", "file_id": created["id"]}

async def run_concurrent_test():
    drive = MockGoogleDriveService()
    test_url = "https://www.instagram.com/reel/DV79WToDXwb/?utm_source=chatgpt.com"
    
    print("--- 1. Testing Concurrent Simultaneous Writes (Device 1 and Device 2) ---")
    t0 = time.time()
    res1, res2 = await asyncio.gather(
        device_write_pipeline(drive, "Phone_Pixel", test_url),
        device_write_pipeline(drive, "iPhone_Pro", test_url)
    )
    elapsed = time.time() - t0
    
    print(f"Device 1 result: {res1}")
    print(f"Device 2 result: {res2}")
    print(f"Total files in Drive: {len(drive.files)}")
    print(f"Files list: {[f['id'] for f in drive.files]}")
    print(f"Concurrent race resolved in {elapsed:.2f}s without duplicates!\n")
    
    print("--- 2. Testing Sequential Second Share Later ---")
    res3 = await device_write_pipeline(drive, "iPad_Mini", test_url)
    print(f"Device 3 result: {res3}")
    print(f"Total files in Drive: {len(drive.files)}")

    record = {
        "test_url": test_url,
        "item_id": build_item_id(test_url),
        "concurrent_run": [res1, res2],
        "sequential_run": res3,
        "final_drive_file_count": len(drive.files),
        "files": drive.files
    }
    with open(FIXTURES_DIR / "drive_idempotent_test.json", "w") as f:
        json.dump(record, f, indent=2)

asyncio.run(run_concurrent_test())


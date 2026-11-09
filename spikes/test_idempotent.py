import hashlib
import json

def get_item_id(url: str) -> str:
    # Normalize URL: strip tracking parameters, trailing slashes, scheme lowercase
    clean_url = url.split("?")[0].rstrip("/").lower()
    return hashlib.sha256(clean_url.encode("utf-8")).hexdigest()[:16]

urls = [
    "https://www.instagram.com/reel/DV79WToDXwb/?utm_source=chatgpt.com",
    "https://www.instagram.com/reel/DV79WToDXwb/",
    "https://x.com/kawaiyusukeno3/status/1932402723233890575?s=20",
    "https://x.com/kawaiyusukeno3/status/1932402723233890575",
]

print("=== URL Normalization and Idempotent ID Test ===")
for u in urls:
    print(f"Original: {u} -> ID: {get_item_id(u)}")


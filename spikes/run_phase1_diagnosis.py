import os
import sys
import json
import sqlite3
import urllib.request
import re
from pathlib import Path

def normalize_ig_url(url: str) -> str:
    if not url:
        return ""
    u = url.strip()
    # Normalize instagram /p/ vs /reel/ vs /reels/
    m = re.search(r'(?:instagram\.com|instagr\.am)/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)', u)
    if m:
        shortcode = m.group(1)
        return f"https://www.instagram.com/reel/{shortcode}/"
    # Normalize youtube
    m_yt = re.search(r'(?:youtube\.com/(?:watch\?v=|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})', u)
    if m_yt:
        return f"https://youtu.be/{m_yt.group(1)}"
    # Generic: strip query params and trailing slash
    clean = re.sub(r'\?.*$', '', u).rstrip('/')
    return clean

def main():
    print("=== Amethyst Phase 1 Diagnosis: PC, Drive, Phone ===")
    
    # 1. PC Database Items
    db_path = os.path.expanduser("~/.amethyst/amethyst.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""
        SELECT id, kind, title, url, status, summary, thumbnail_path, category, created_at 
        FROM library_items
        ORDER BY id DESC
    """)
    pc_rows = [dict(r) for r in c.fetchall()]
    print(f"Total PC library_items: {len(pc_rows)}")

    # 2. Phone Items from phone_storage.json
    phone_storage_file = Path("spikes/evidence/phone_storage.json")
    phone_saved = []
    phone_cached = []
    if phone_storage_file.exists():
        p_data = json.loads(phone_storage_file.read_text())
        phone_saved = p_data.get("saved", [])
        phone_cached = p_data.get("cached", [])
    print(f"Total Phone amethyst_saved_items: {len(phone_saved)}")
    print(f"Total Phone amethyst.cached_library: {len(phone_cached)}")

    # 3. Drive Items via Composio
    drive_files = []
    folder_id = "1J9QlvSGVd6g1qzgSoZQoVpevA9t2idUv"
    next_page_token = None
    try:
        env_lines = Path('.env').read_text().splitlines()
        key = next(l.split('=', 1)[1].strip() for l in env_lines if l.startswith('COMPOSIO_API_KEY='))
        endpoint = 'https://connect.composio.dev/mcp'

        payload = {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'tools/call',
            'params': {
                'name': 'COMPOSIO_MULTI_EXECUTE_TOOL',
                'arguments': {
                    'tools': [{
                        'tool_slug': 'GOOGLEDRIVE_LIST_FILES',
                        'arguments': {
                            'q': f"'{folder_id}' in parents and trashed = false",
                            'pageSize': 100
                        }
                    }]
                }
            }
        }

        req = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), headers={
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'x-consumer-api-key': key
        })

        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            for line in raw.splitlines():
                if line.startswith('data: '):
                    msg = json.loads(line[6:])
                    txt = msg['result']['content'][0]['text']
                    parsed = json.loads(txt)
                    drive_files = parsed['data']['results'][0]['response']['data']['files']
                    next_page_token = parsed['data']['results'][0]['response']['data'].get('nextPageToken')
                    break
        print(f"Total Drive files in amethyst-spike: {len(drive_files)}, nextPageToken: {next_page_token}")
    except Exception as e:
        print(f"Error querying Drive files: {e}")

    # Export structured lists
    exports = {
        "pc_items": [
            {
                "id": str(r["id"]),
                "url": r["url"] or "",
                "canonicalUrl": normalize_ig_url(r["url"] or ""),
                "title": r["title"] or "",
                "kind": r["kind"] or "",
                "status": r["status"] or "",
                "has_thumbnail": bool(r["thumbnail_path"]),
                "thumbnail_path": r["thumbnail_path"] or "",
                "has_summary": bool(r["summary"] and r["summary"].strip()),
            }
            for r in pc_rows
        ],
        "phone_pipeline_items": [
            {
                "id": str(r.get("id")),
                "url": r.get("url") or "",
                "canonicalUrl": normalize_ig_url(r.get("url") or r.get("canonicalUrl") or ""),
                "title": r.get("title") or r.get("caption") or "",
                "kind": r.get("mediaType") or r.get("kind") or "",
                "status": r.get("status") or "",
                "has_thumbnail": bool(r.get("thumbnail_path") or r.get("thumbnailUrl")),
                "has_summary": bool(r.get("summary") and r.get("summary").strip()),
            }
            for r in phone_saved
        ],
        "phone_cached_items": [
            {
                "id": str(r.get("id")),
                "url": r.get("url") or "",
                "canonicalUrl": normalize_ig_url(r.get("url") or ""),
                "title": r.get("title") or "",
                "kind": r.get("kind") or "",
                "status": r.get("status") or "",
                "has_thumbnail": bool(r.get("thumbnail_path") or r.get("thumbnail_url")),
                "has_summary": bool(r.get("summary") and r.get("summary").strip()),
            }
            for r in phone_cached
        ],
        "drive_items": [
            {
                "id": f.get("id"),
                "name": f.get("name"),
                "mimeType": f.get("mimeType"),
            }
            for f in drive_files
        ]
    }

    Path("spikes/evidence/diagnosis_item_lists.json").write_text(json.dumps(exports, indent=2))
    print("Exported item lists to spikes/evidence/diagnosis_item_lists.json")

    # 4. Diff Analysis
    # Match by normalized canonical URL
    pc_by_canon = {item["canonicalUrl"]: item for item in exports["pc_items"] if item["canonicalUrl"]}
    phone_saved_by_canon = {item["canonicalUrl"]: item for item in exports["phone_pipeline_items"] if item["canonicalUrl"]}
    phone_cached_by_canon = {item["canonicalUrl"]: item for item in exports["phone_cached_items"] if item["canonicalUrl"]}
    
    drive_hashes = {f["name"].replace(".json", "").replace(".md", ""): f for f in drive_files}

    print("\n--- Discrepancy & Diff Analysis ---")
    
    # Phone pipeline items vs PC
    print("\n[Phone Pipeline Items (amethyst_saved_items)]:")
    for p_item in exports["phone_pipeline_items"]:
        canon = p_item["canonicalUrl"]
        if canon in pc_by_canon:
            pc_item = pc_by_canon[canon]
            print(f"  MATCH: {canon}\n    -> Phone ID: {p_item['id']} (status: {p_item['status']})\n    -> PC ID: {pc_item['id']} (status: {pc_item['status']})")
        else:
            print(f"  MISSING ON PC: {canon}\n    -> Phone ID: {p_item['id']} (status: {p_item['status']})\n    -> Reason: Local save inside phone app, sync engine between phone and PC not triggered.")

    # Phone cached items vs PC
    print(f"\n[Phone Cached Library (amethyst.cached_library)]: Total {len(exports['phone_cached_items'])} items")
    cached_missing_from_pc = [c for c in phone_cached_by_canon if c not in pc_by_canon]
    print(f"  Cached items missing from PC DB: {len(cached_missing_from_pc)}")
    for c in cached_missing_from_pc:
        it = phone_cached_by_canon[c]
        print(f"    - Missing: ID={it['id']}, Title='{it['title']}', URL='{it['url']}'\n      Reason: Client-side optimistic placeholder or deleted on PC.")

    pc_missing_from_cached = [c for c in pc_by_canon if c not in phone_cached_by_canon]
    print(f"  PC DB items missing from phone cached library: {len(pc_missing_from_cached)}")
    for c in pc_missing_from_cached[:5]:
        it = pc_by_canon[c]
        print(f"    - Missing: ID={it['id']}, Title='{it['title']}', URL='{it['url']}'\n      Reason: Item was not included in previous sync snapshot or filtered out.")

    # Drive items analysis
    print(f"\n[Drive Folder amethyst-spike]: Total {len(drive_files)} files")
    print(f"  Pagination check: nextPageToken is '{next_page_token}' (Drive API returns max 100 per page; without pagination client cuts off at pageSize).")

    # 5. Junk Audit
    print("\n--- Junk Audit ---")
    
    # PC Junk
    pc_junk = []
    for r in exports["pc_items"]:
        reasons = []
        if not r["title"] or r["title"].strip() == "" or r["title"].startswith("http"):
            reasons.append("no_title")
        if not r["has_thumbnail"]:
            reasons.append("no_thumbnail")
        if not r["has_summary"]:
            reasons.append("no_summary")
        if r["status"] in ("failed", "unavailable"):
            reasons.append(f"status_{r['status']}")
        if reasons:
            pc_junk.append({"id": r["id"], "title": r["title"][:50], "url": r["url"], "reasons": reasons, "status": r["status"]})

    print(f"PC Junk items count: {len(pc_junk)} of {len(exports['pc_items'])}")
    reasons_count_pc = {}
    for j in pc_junk:
        for reason in j["reasons"]:
            reasons_count_pc[reason] = reasons_count_pc.get(reason, 0) + 1
    print(f"  PC Junk Breakdown: {reasons_count_pc}")

    # Phone Junk
    phone_junk = []
    # Combined phone items (saved + cached)
    seen_phone_ids = set()
    for r in exports["phone_pipeline_items"] + exports["phone_cached_items"]:
        if r["id"] in seen_phone_ids:
            continue
        seen_phone_ids.add(r["id"])
        reasons = []
        if not r["title"] or r["title"].strip() == "" or r["title"].startswith("http"):
            reasons.append("no_title")
        if not r["has_thumbnail"]:
            reasons.append("no_thumbnail")
        if not r["has_summary"]:
            reasons.append("no_summary")
        if r["status"] in ("failed", "unavailable"):
            reasons.append(f"status_{r['status']}")
        if reasons:
            phone_junk.append({"id": r["id"], "title": r["title"][:50], "url": r["url"], "reasons": reasons, "status": r["status"]})

    print(f"Phone Junk items count: {len(phone_junk)} of {len(seen_phone_ids)}")
    reasons_count_phone = {}
    for j in phone_junk:
        for reason in j["reasons"]:
            reasons_count_phone[reason] = reasons_count_phone.get(reason, 0) + 1
    print(f"  Phone Junk Breakdown: {reasons_count_phone}")

    # Save full audit
    audit = {
        "pc_total": len(exports["pc_items"]),
        "pc_junk_count": len(pc_junk),
        "pc_junk_breakdown": reasons_count_pc,
        "pc_junk_sample": pc_junk[:15],
        "phone_pipeline_total": len(exports["phone_pipeline_items"]),
        "phone_cached_total": len(exports["phone_cached_items"]),
        "phone_unique_total": len(seen_phone_ids),
        "phone_junk_count": len(phone_junk),
        "phone_junk_breakdown": reasons_count_phone,
        "phone_junk_sample": phone_junk[:15],
    }
    Path("spikes/evidence/diagnosis_junk_audit.json").write_text(json.dumps(audit, indent=2))
    print("Saved full audit to spikes/evidence/diagnosis_junk_audit.json")

if __name__ == '__main__':
    main()

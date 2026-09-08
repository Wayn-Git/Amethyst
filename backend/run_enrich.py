import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.resolve()))

from backend.library.store import LibraryStore
from backend.library.service import LibraryService

async def main():
    store = LibraryStore()
    svc = LibraryService(store=store)
    
    items = store.list(limit=1000)
    to_enrich = []
    
    for row in items:
        tags = row['tags'] or ''
        category = row['category'] or ''
        if 'society' in tags.lower() or category == 'general':
            to_enrich.append((row['id'], row['title']))
            
    print(f"Found {len(to_enrich)} items with 'society' tag or 'general' category.")
    
    for item_id, title in to_enrich:
        print(f"Re-enriching item {item_id} ({title})...")
        try:
            await svc.enrich(item_id)
            print(f"Success for {item_id}.")
        except Exception as e:
            print(f"Failed {item_id}: {e}")

if __name__ == "__main__":
    asyncio.run(main())

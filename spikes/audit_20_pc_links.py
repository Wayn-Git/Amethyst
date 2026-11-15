import sqlite3
import json
import os
import re
from pathlib import Path

def main():
    conn = sqlite3.connect(os.path.expanduser('~/.amethyst/amethyst.db'))
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Query items that have resources JSON or extracted links
    c.execute("""
        SELECT id, title, url, notes, summary, text_path, resources, text_source
        FROM library_items
        WHERE resources IS NOT NULL AND resources != '[]' AND resources != ''
        ORDER BY id DESC
        LIMIT 40
    """)
    rows = c.fetchall()

    items_audited = []
    total_chips_checked = 0
    hallucinated_or_inferred = 0

    for r in rows:
        if len(items_audited) >= 20:
            break

        try:
            res_list = json.loads(r['resources'])
        except Exception:
            continue

        # Filter for external link chips (tool, link, website, reference, etc.)
        link_chips = []
        for res in res_list:
            if not isinstance(res, dict):
                continue
            u = res.get('url') or res.get('remote_url')
            if not u or not isinstance(u, str) or not u.startswith('http'):
                continue
            # Exclude direct mp4 video stream and cdn slide urls
            if u.endswith('.mp4') or 'fbcdn.net' in u or 'cdninstagram.com' in u:
                continue
            # Exclude self-link to item itself
            if r['url'] and u.rstrip('/') == r['url'].rstrip('/'):
                continue
            link_chips.append({
                'name': res.get('name') or res.get('title') or 'Link',
                'type': res.get('type') or 'link',
                'url': u
            })

        if not link_chips:
            continue

        # Load all source text
        source_texts = []
        if r['notes']:
            source_texts.append(r['notes'])
        if r['text_path'] and os.path.exists(r['text_path']):
            try:
                source_texts.append(Path(r['text_path']).read_text())
            except Exception:
                pass

        full_source_text = "\n".join(source_texts)

        chip_results = []
        for chip in link_chips:
            target_url = chip['url']
            # Literal appearance check: check target_url in full_source_text
            # Also check without trailing slash, or protocol
            norm_target = re.sub(r'^https?://', '', target_url).rstrip('/')
            
            # Literal check
            literal_present = (target_url in full_source_text) or (norm_target in full_source_text)
            
            chip_results.append({
                'name': chip['name'],
                'url': target_url,
                'literal_in_source': literal_present
            })
            total_chips_checked += 1
            if not literal_present:
                hallucinated_or_inferred += 1

        items_audited.append({
            'id': r['id'],
            'title': r['title'],
            'chips': chip_results
        })

    report = {
        'items_count': len(items_audited),
        'total_chips_checked': total_chips_checked,
        'literal_count': total_chips_checked - hallucinated_or_inferred,
        'not_literal_count': hallucinated_or_inferred,
        'percentage_not_literal': f"{(hallucinated_or_inferred / total_chips_checked * 100):.1f}%" if total_chips_checked else "0%",
        'items': items_audited
    }

    Path('spikes/evidence/audit_20_pc_links.json').write_text(json.dumps(report, indent=2))
    print(f"Audited {len(items_audited)} items, {total_chips_checked} link chips.")
    print(f"Chips literally in source: {total_chips_checked - hallucinated_or_inferred}")
    print(f"Chips NOT literally in source: {hallucinated_or_inferred} ({report['percentage_not_literal']})")

if __name__ == '__main__':
    main()


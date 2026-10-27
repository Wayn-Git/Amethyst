"""Check documentation and development inventory against shipped manifests."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.dashboard.registry import MANIFESTS

expected = {m['id'] for m in MANIFESTS}
text = (ROOT / 'docs/ui-widget-map.md').read_text()
mapped = re.findall(r'^\| `([^`]+)` \|', text, re.M)
assert len(mapped) == len(set(mapped)), 'Duplicate widget map IDs'
assert set(mapped) == expected, f'Missing: {expected-set(mapped)}; extra: {set(mapped)-expected}'
snapshot = json.loads((ROOT / 'frontend/src/dev/widgets/manifests.json').read_text())
assert snapshot == MANIFESTS, 'Dev manifest snapshot is stale; regenerate from MANIFESTS'
registry = (ROOT / 'frontend/src/dashboard/registry.js').read_text()
assert set(re.findall(r"'([^']+)': lazy", registry)) == expected, 'Frontend registry differs'
print(f'PASS: all {len(expected)} manifests mapped exactly once; dev snapshot and registry match')

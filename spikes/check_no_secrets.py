#!/usr/bin/env python3
"""
Verification check: fails loudly with exit code 1 if any API key or pairing token
pattern appears in spikes/evidence/.
"""
import os
import re
import sys

KEY_PATTERNS = [
    (r'AQ\.[A-Za-z0-9_-]{20,}', 'Gemini API Key (AQ....)'),
    (r'ck_[A-Za-z0-9_-]{15,}', 'Composio API Key (ck_....)'),
    (r'AIza[A-Za-z0-9_-]{35}', 'Google API Key (AIza....)'),
    (r'c88a08[a-zA-Z0-9_-]{15,}', 'Companion Pairing Token'),
    (r'token=[a-zA-Z0-9_-]{16,}', 'URL Token Query Param'),
    (r'\"token\":\s*\"[a-zA-Z0-9_-]{16,}\"', 'JSON Token Field'),
    (r'x-consumer-api-key:\s*[^\s]+', 'Composio Header Key'),
]

def check_secrets():
    evidence_dir = 'spikes/evidence'
    if not os.path.isdir(evidence_dir):
        print(f"ERROR: Evidence directory {evidence_dir} not found!", file=sys.stderr)
        sys.exit(1)

    violations = []
    for root, _, files in os.walk(evidence_dir):
        for f in files:
            if f.endswith(('.txt', '.json', '.md', '.log')):
                path = os.path.join(root, f)
                with open(path, 'r', encoding='utf-8', errors='ignore') as fp:
                    for line_no, line in enumerate(fp, 1):
                        for pattern, name in KEY_PATTERNS:
                            m = re.search(pattern, line)
                            if m:
                                violations.append({
                                    'file': path,
                                    'line': line_no,
                                    'pattern_name': name,
                                    'snippet': line.strip()[:80]
                                })

    if violations:
        print(f"FATAL: Found {len(violations)} secret violations in {evidence_dir}:", file=sys.stderr)
        for v in violations:
            print(f"  {v['file']}:{v['line']} [{v['pattern_name']}] -> {v['snippet']}", file=sys.stderr)
        sys.exit(1)

    print("PASS: Zero API keys, pairing tokens, or secrets found in spikes/evidence.")
    return 0

if __name__ == '__main__':
    sys.exit(check_secrets())


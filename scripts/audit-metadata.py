#!/usr/bin/env python3
"""Check all tracked text, including this file, without embedding private terms."""
import json, os, pathlib, re, subprocess, sys
root = pathlib.Path(__file__).resolve().parents[1]
files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
terms = json.loads(os.environ.get('PUBLIC_DENY_TERMS') or '[]')
patterns = [
    r'/Users/[A-Za-z0-9._-]+/',
    r'\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b',
    r'"transport"\s*:\s*"ssh:',
]
issues = set()
for name in filter(None, files):
    p = root / name
    if not p.is_file():
        continue
    try:
        content = p.read_text()
    except UnicodeDecodeError:
        continue
    if any(re.search(pattern, content) for pattern in patterns):
        issues.add(name)
    if any(term.casefold() in content.casefold() for term in terms):
        issues.add(name)
if issues:
    print('Publication metadata check failed in: ' + ', '.join(sorted(issues)))
    sys.exit(1)
print('Publication metadata check passed, including audit scripts')

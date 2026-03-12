#!/usr/bin/env python3
# One-shot script to push seed data to live POV System API
# Run: python3 push-seed.py

import json, os, re, urllib.request

BASE_URL = "https://melodious-sunburst-8e3e37.netlify.app/api/items"
SEED_DIR = os.path.join(os.path.dirname(__file__), "seed")

def parse_frontmatter(content):
    m = re.match(r'^---\n([\s\S]*?)\n---\n?([\s\S]*)$', content)
    if not m: return None, content
    meta, body = {}, m.group(2).strip()
    lines = m.group(1).split('\n')
    i = 0
    while i < len(lines):
        km = re.match(r'^(\w+):\s*(.*)', lines[i])
        if not km: i += 1; continue
        key, val = km.group(1), km.group(2).strip()
        if val == '' or val == '[]':
            if val == '[]': meta[key] = []; i += 1; continue
            arr = []; i += 1
            while i < len(lines) and lines[i].startswith('  - '):
                item = lines[i][4:].strip().strip('"')
                arr.append(item); i += 1
            meta[key] = arr; continue
        elif val == 'null': meta[key] = None
        elif val.startswith('"') and val.endswith('"'): meta[key] = val[1:-1]
        else: meta[key] = val
        i += 1
    return meta, body

def md_to_item(filepath):
    with open(filepath, 'r') as f: content = f.read()
    meta, body = parse_frontmatter(content)
    if not meta: return None
    item = {
        'id':       meta.get('id'),
        'functions': meta.get('functions', [meta.get('type','proof')]),
        'title':    meta.get('title',''),
        'body':     body or meta.get('title',''),
        'domains':  meta.get('domains', ['Strategy']),
        'keywords': meta.get('keywords', []),
        'created':  meta.get('created', '2026-02-15')
    }
    if 'status' in meta:           item['status']        = meta['status']
    if 'linked_ids' in meta:       item['linkedIds']     = meta['linked_ids']
    if 'supports_beliefs' in meta: item['supportsBelief']= meta['supports_beliefs']
    if 'related_belief' in meta:   item['relatedBelief'] = meta['related_belief']
    if 'source' in meta:           item['source']        = meta['source']
    if 'source_type' in meta:      item['sourceType']    = meta['source_type']
    if 'why_saved' in meta:        item['whySaved']      = meta['why_saved']
    if 'principle' in meta:        item['principle']     = meta['principle']
    if 'belief' in item['functions'] and 'linkedIds' not in item:
        item['linkedIds'] = []
    return item

def push(item):
    data = json.dumps(item).encode('utf-8')
    req = urllib.request.Request(BASE_URL, data=data,
          headers={'Content-Type':'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status

all_items = []
for folder in ['beliefs', 'proof', 'craft']:
    d = os.path.join(SEED_DIR, folder)
    if not os.path.exists(d): continue
    for fname in sorted(os.listdir(d)):
        if not fname.endswith('.md'): continue
        item = md_to_item(os.path.join(d, fname))
        if item: all_items.append(item)

print(f"Pushing {len(all_items)} items...")
ok, fail = 0, 0
for item in all_items:
    try:
        push(item)
        print(f"  ✓ {item['id']} — {item['title']}")
        ok += 1
    except Exception as e:
        print(f"  ✗ {item['id']} — {e}")
        fail += 1

print(f"\nDone: {ok} saved, {fail} failed")

"""Refresh offline tag-group membership from the public Danbooru wiki (no prose retained)."""
import json
from pathlib import Path
import re
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
def fetch(title):
    url = 'https://safebooru.donmai.us/wiki_pages.json?search[title]=' + title.replace(' ', '%20')
    with urlopen(url, timeout=30) as response: return json.load(response)
index = fetch('tag_groups')[0]
names = sorted({match.split('|')[0].split('#')[0].strip().lower().replace(' ', '_') for match in re.findall(r'\[\[([^\]]+)\]\]', index['body']) if match.lower().startswith('tag group:')})
pages = []
for name in names:
    batch = fetch(name)
    pages.extend(batch)
    print(name, flush=True)
    time.sleep(.25)
groups = {}
for row in pages:
    title = row['title']
    if not title.startswith('tag_group:'): continue
    links = {match.split('|')[0].split('#')[0].strip().lower().replace(' ', '_') for match in re.findall(r'\[\[([^\]]+)\]\]', row['body'])}
    groups[title] = {'label': title.split(':', 1)[1].replace('_', ' ').title(), 'tags': sorted(link for link in links if ':' not in link), 'children': sorted(link for link in links if link.startswith('tag_group:') and link != title), 'source': 'https://danbooru.donmai.us/wiki_pages/' + title, 'updated_at': row['updated_at']}
(ROOT / 'data' / 'danbooru-groups.json').write_text(json.dumps({'source': 'https://danbooru.donmai.us/wiki_pages/tag_groups', 'groups': groups}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Saved {len(groups)} wiki groups')

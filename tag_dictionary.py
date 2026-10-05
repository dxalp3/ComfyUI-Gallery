"""Offline canonical Danbooru names. No prompts or images leave this process."""
import csv
from functools import lru_cache
import gzip
from pathlib import Path
import re

QUALITY = {'masterpiece', 'best_quality', 'worst_quality', 'low_quality', 'normal_quality',
           'high_quality', 'amazing_quality', 'very_aesthetic', 'absurdres', 'highres',
           'ultra_detailed', '8k', '4k', 'score_9', 'score_8_up', 'score_7_up'}


def normalize(value):
    value = value.strip().lower().replace('\\(', '(').replace('\\)', ')')
    value = re.sub(r'^\((.*):[-+]?\d+(?:\.\d+)?\)$', r'\1', value)
    if value.startswith('(') and value.endswith(')'): value = value[1:-1]
    return re.sub(r'\s+', '_', value)


@lru_cache(maxsize=1)
def dictionary():
    values = {}
    with gzip.open(Path(__file__).parent / 'data' / 'danbooru.csv.gz', 'rt', encoding='utf-8-sig') as stream:
        for row in csv.reader(stream):
            if len(row) < 3 or row[1] not in ('0', '1', '3', '4'): continue  # Exclude meta/quality tags.
            name = row[0]
            if name in QUALITY: continue
            values[name] = name
            for alias in row[3].split(',') if len(row) > 3 else []:
                if alias and alias not in QUALITY: values.setdefault(alias, name)
    return values


def prompt_tags(text):
    if not isinstance(text, str) or len(text) > 1000000: raise ValueError('Prompt must be text under 1 million characters')
    lookup = dictionary()
    result = []
    for part in re.split(r'[,\r\n]+', text):
        name = normalize(part)
        if name not in QUALITY and name in lookup and lookup[name] not in result: result.append(lookup[name])
    return result


def format_terms(terms, prefer_spaces=True):
    """Only recognized vocabulary is reformatted; custom text/LoRAs stay literal."""
    lookup = dictionary()
    result = []
    for term in terms:
        canonical = lookup.get(normalize(term))
        if canonical is None:
            result.append(term)
            continue
        text = canonical.replace('_', ' ') if prefer_spaces else canonical
        weighted = re.fullmatch(r'\((.*):([-+]?\d+(?:\.\d+)?)\)', term.strip())
        if weighted:
            text = '(' + text + ':' + weighted[2] + ')'
        result.append(text)
    return result


@lru_cache(maxsize=1)
def vocabulary_rows():
    lookup = dictionary()
    with gzip.open(Path(__file__).parent / 'data' / 'danbooru.csv.gz', 'rt', encoding='utf-8-sig') as stream:
        return tuple({'name': row[0], 'count': int(row[2]), 'aliases': row[3] if len(row) > 3 else ''} for row in csv.reader(stream) if len(row) >= 3 and row[0] in lookup and lookup[row[0]] == row[0])


@lru_cache(maxsize=1)
def tag_groups():
    import json
    source = json.loads((Path(__file__).parent / 'data' / 'danbooru-groups.json').read_text(encoding='utf-8'))
    lookup = dictionary()
    return {key: {**group, 'tags': frozenset(lookup[tag] for tag in group['tags'] if tag in lookup)} for key, group in source['groups'].items()}


def browse_vocabulary(data):
    groups = tag_groups()
    category = str(data.get('category', ''))
    if category and category not in groups: raise ValueError('Unknown wiki category')
    query = normalize(str(data.get('query', ''))[:256])
    favorites = data.get('favorites')
    if favorites is not None and (not isinstance(favorites, list) or len(favorites) > 10000 or any(not isinstance(value, str) for value in favorites)):
        raise ValueError('Invalid favorite tags')
    favorites = set(favorites) if favorites is not None else None
    rows = [row for row in vocabulary_rows() if (not category or row['name'] in groups[category]['tags']) and (favorites is None or row['name'] in favorites) and (not query or query in row['name'] or query in row['aliases'])]
    rows.sort(key=(lambda row: row['name']) if data.get('sort') == 'alphabetical' else (lambda row: (-row['count'], row['name'])))
    offset = max(0, min(200000, int(data.get('offset', 0))))
    limit = max(1, min(10000 if data.get('selection') is True else 100, int(data.get('limit', 60))))
    return {'items': [{'name': row['name'], 'count': row['count']} for row in rows[offset:offset + limit]], 'total': len(rows), 'categories': [{'value': key, 'label': group['label'], 'count': len(group['tags']), 'source': group['source']} for key, group in sorted(groups.items()) if group['tags']]}

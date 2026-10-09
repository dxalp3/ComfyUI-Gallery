"""One user-scoped Prompt Library file, shared by the gallery and prefix nodes."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import uuid
from urllib.parse import urlsplit
from aiohttp import web

LOCK = threading.RLock()


def validate(value):
    if not isinstance(value, dict) or value.get('version') not in (1, 2):
        raise ValueError('Unsupported Prompt Library format.')
    result = {'version': 2, 'tags': value.get('tags'), 'prefixes': value.get('prefixes')}
    for kind in ('tags', 'prefixes'):
        rows = result[kind]
        if not isinstance(rows, list) or len(rows) > 200000:
            raise ValueError('Invalid library entries.')
        ids = set()
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id'] or row['id'] in ids or not isinstance(row.get('name'), str) or not row['name'].strip():
                raise ValueError('Invalid or duplicate library entry.')
            ids.add(row['id'])
            if kind == 'tags' and (not isinstance(row.get('text'), str) or not row['text'].strip()):
                raise ValueError('Tag text cannot be empty.')
    tags = {row['id'] for row in result['tags']}
    for row in result['prefixes']:
        if not isinstance(row.get('tags'), list) or any(not isinstance(tag, str) or tag not in tags for tag in row['tags']) or len(set(row['tags'])) != len(row['tags']):
            raise ValueError('A prefix refers to invalid tags.')
        negatives = row.get('negative_terms', [])
        if not isinstance(negatives, list) or len(negatives) > 500 or any(not isinstance(term, str) or len(term) > 1024 for term in negatives):
            raise ValueError('Invalid negative prefix terms.')
    associations = value.get('associations', {})
    if not isinstance(associations, dict) or len(associations) > 50000:
        raise ValueError('Invalid image associations.')
    for key, item in associations.items():
        if not isinstance(key, str) or len(key) > 4096 or not isinstance(item, dict) or not isinstance(item.get('prefix_id'), str) or not isinstance(item.get('terms'), list) or len(item['terms']) > 500 or any(not isinstance(term, str) or len(term) > 1024 for term in item['terms']):
            raise ValueError('Invalid image association.')
        negatives = item.get('negative_terms', [])
        if not isinstance(negatives, list) or len(negatives) > 500 or any(not isinstance(term, str) or len(term) > 1024 for term in negatives):
            raise ValueError('Invalid associated negative prompts.')
        image = item.get('image')
        if image is not None and (not isinstance(image, dict) or any(not isinstance(v, str) or len(v) > 4096 for v in image.values())):
            raise ValueError('Invalid associated image reference.')
    if associations: result['associations'] = associations
    return result


def read(path):
    try:
        raw = path.read_bytes()
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError('Prompt Library exceeds 16 MiB.')
        value = validate(json.loads(raw))
    except FileNotFoundError:
        value = {'version': 2, 'tags': [], 'prefixes': []}
        raw = b''
    return value, hashlib.sha256(raw).hexdigest()


def update(path, data):
    with LOCK:
        library, revision = read(path)
        if data.get('revision') != revision:
            raise FileExistsError('The shared library changed. Refresh it before saving; your draft has been kept.')
        action = data.get('action')
        if action == 'migrate':
            if library['tags'] or library['prefixes']:
                raise ValueError('Migration only applies to an empty shared library.')
            library = validate(data.get('library'))
        elif action == 'delete':
            library['prefixes'] = [prefix for prefix in library['prefixes'] if prefix['id'] != data.get('id')]
        elif action == 'save':
            name, terms = data.get('name'), data.get('terms')
            if not isinstance(name, str) or not name.strip() or len(name) > 200:
                raise ValueError('Enter a prefix name of up to 200 characters.')
            if not isinstance(terms, list) or not 0 <= len(terms) <= 500 or any(not isinstance(term, str) or not term.strip() or len(term) > 1024 for term in terms):
                raise ValueError('Choose 1–500 nonempty terms, each at most 1,024 characters.')
            negatives = data.get('negative_terms')
            if negatives is not None and (not isinstance(negatives, list) or len(negatives) > 500 or any(not isinstance(term, str) or not term.strip() or len(term) > 1024 for term in negatives)):
                raise ValueError('Invalid negative prefix terms.')
            if not terms and not negatives:
                raise ValueError('Choose at least one positive or negative term.')
            name = name.strip()
            existing = next((p for p in library['prefixes'] if p['name'].casefold() == name.casefold()), None)
            ids = []
            for term in dict.fromkeys(term.strip() for term in terms):
                tag = next((t for t in library['tags'] if t['text'] == term), None)
                if tag is None:
                    tag = {'id': str(uuid.uuid4()), 'name': term, 'text': term}
                    library['tags'].append(tag)
                ids.append(tag['id'])
            if existing:
                existing['tags'] = ids
            else:
                library['prefixes'].append({'id': str(uuid.uuid4()), 'name': name, 'tags': ids})
            saved = next(p for p in library['prefixes'] if p['name'].casefold() == name.casefold())
            if negatives is not None: saved['negative_terms'] = list(dict.fromkeys(term.strip() for term in negatives))
            references = data.get('image_refs', {})
            if not isinstance(references, dict) or len(references) > 64: raise ValueError('Invalid image references.')
            image_keys = data.get('image_keys', [])
            if not isinstance(image_keys, list) or len(image_keys) > 64 or any(not isinstance(key, str) or not key or len(key) > 4096 for key in image_keys):
                raise ValueError('Invalid image keys.')
            if image_keys:
                saved = next(p for p in library['prefixes'] if p['name'].casefold() == name.casefold())
                for key in image_keys:
                    library.setdefault('associations', {})[key] = {'prefix_id': saved['id'], 'terms': list(dict.fromkeys(term.strip() for term in terms)), 'negative_terms': saved.get('negative_terms', []), **({'image': references[key]} if key in references else {})}
                validate(library)
        elif action in ('associate', 'dissociate'):
            # Pair images with a saved prefix (or unpair them) without touching the prefix's terms.
            image_keys = data.get('image_keys', [])
            if not isinstance(image_keys, list) or not 1 <= len(image_keys) <= 256 or any(not isinstance(key, str) or not key or len(key) > 4096 for key in image_keys):
                raise ValueError('Choose 1–256 images.')
            associations = library.setdefault('associations', {})
            if action == 'dissociate':
                for key in image_keys: associations.pop(key, None)
                if not associations: library.pop('associations', None)
            else:
                prefix = next((p for p in library['prefixes'] if p['id'] == data.get('prefix_id')), None)
                if prefix is None: raise ValueError('That prefix no longer exists. Refresh the library.')
                references = data.get('image_refs', {})
                if not isinstance(references, dict) or len(references) > 256: raise ValueError('Invalid image references.')
                texts = {t['id']: t['text'] for t in library['tags']}
                terms = [texts[tag] for tag in prefix['tags'] if tag in texts]
                for key in image_keys:
                    associations[key] = {'prefix_id': prefix['id'], 'terms': terms, 'negative_terms': prefix.get('negative_terms', []), **({'image': references[key]} if isinstance(references.get(key), dict) else {})}
            validate(library)
        else:
            raise ValueError('Invalid library action.')
        raw = json.dumps(library, ensure_ascii=False, indent=2).encode()
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError('Prompt Library exceeds 16 MiB.')
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
        return {'library': library, 'revision': hashlib.sha256(raw).hexdigest()}


def register_prefix_routes(routes, get_path):
    @routes.get('/Gallery/prefixes')
    @routes.post('/Gallery/prefixes')
    async def library(request):
        try:
            origin = request.headers.get('Origin')
            if request.method == 'POST' and (request.headers.get('Sec-Fetch-Site') == 'cross-site' or origin and urlsplit(origin).netloc.lower() != request.host.lower()):
                return web.json_response({'error': 'Cross-origin library writes are not allowed.'}, status=403)
            resolved = get_path(request)
            if not resolved:
                raise ValueError('The current ComfyUI user is unavailable.')
            path = Path(resolved)
            if request.method == 'GET':
                with LOCK:
                    value, revision = read(path)
                result = {'library': value, 'revision': revision}
            else:
                data = await request.json()
                if not isinstance(data, dict):
                    raise ValueError('Expected a library operation.')
                result = update(path, data)
            return web.json_response(result, headers={'Cache-Control': 'no-store'})
        except FileExistsError as error:
            return web.json_response({'error': str(error)}, status=409)
        except (ValueError, KeyError) as error:
            return web.json_response({'error': str(error)}, status=400)
        except OSError:
            return web.json_response({'error': 'Cannot access the shared Prompt Library file.'}, status=500)


class GalleryPromptLibrary:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'prefix': ('STRING', {'multiline': True, 'default': ''})}}

    RETURN_TYPES = ('STRING',)
    RETURN_NAMES = ('prefix',)
    FUNCTION = 'output_prefix'
    CATEGORY = 'prompt/library'

    def output_prefix(self, prefix):
        return (prefix,)


# The Gallery Prompt Encode node compiles its tag boxes into one string. The connected
# `source_text` is its own box; its position is marked in that string and replaced here,
# when the workflow runs and the source text is finally known.
SOURCE_MARKER = '\u27e6source\u27e7'
SOURCE_MODES = ('after', 'before', 'replace', 'boxes')
# Saved images get a `gallery_prompts` text chunk: per encoder node, the prompt before and after
# {a|b|c} choices were made. It travels into the Hydrus note with the rest of the metadata.
RESOLVED_KEY = 'gallery_prompts'


# Tags removed from the source box ride inside the marker: ⟦source -["tag a","tag b"]⟧ (a JSON list).
SOURCE_MARKER_PATTERN = re.compile('⟦source(?: -(\\[[^⟧]*\\]))?⟧')


def split_top(text, separator=','):
    """Split on a separator outside (), [], {} and <>; unbalanced text falls back to a plain split."""
    depth, cuts, balanced = 0, [], True
    for index, char in enumerate(text):
        if char in '([{<': depth += 1
        elif char in ')]}>':
            depth -= 1
            if depth < 0: balanced, depth = False, 0
        elif char == separator and depth == 0: cuts.append(index)
    if depth or not balanced: return text.split(separator)
    parts, start = [], 0
    for index in cuts:
        parts.append(text[start:index]); start = index + 1
    parts.append(text[start:])
    return parts


def source_key(tag):
    return re.sub(r'\s+', ' ', tag.strip().lower().replace('_', ' '))


def marker_excluded(match):
    try:
        value = json.loads(match.group(1)) if match.group(1) else []
    except ValueError:
        return []
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def filter_source(source, excluded):
    if not excluded: return source
    drop = {source_key(tag) for tag in excluded}
    return ','.join(part for part in split_top(source) if source_key(part) not in drop)


def source_exclusions(text):
    """Every tag removed from the source box(es) of a compiled prompt."""
    return [tag for match in SOURCE_MARKER_PATTERN.finditer(text or '') for tag in marker_excluded(match)]


def compose_prompt(text, source_text=None, source_mode='after'):
    if source_mode not in SOURCE_MODES: raise ValueError('Invalid source prompt order.')
    if source_mode == 'boxes':
        source = (source_text or '').strip().strip(',').strip()
        joined = SOURCE_MARKER_PATTERN.sub(lambda match: filter_source(source, marker_excluded(match)).strip(), text or '')
        joined = re.sub(r'(?:\s*,\s*){2,}', ', ', joined)
        return joined.strip().strip(',').strip()
    return text if source_text is None else source_text if source_mode == 'replace' else ', '.join(part.strip() for part in ([source_text, text] if source_mode == 'before' else [text, source_text]) if part.strip())


def resolve_dynamic(text, rng=None):
    """Pick one option of every {a|b|c} group, innermost first, like ComfyUI's dynamic prompts.

    ComfyUI resolves the encoder's own text in the browser when it queues a workflow, but text that
    arrives through `source_text` (or from a node without dynamic prompts) would otherwise reach CLIP
    with the braces still in it. Returns the resolved text and the choices that were made here.
    """
    import random
    rng = rng or random
    choices = []
    prompt = text or ''
    for _ in range(10000):
        end = next((i for i, c in enumerate(prompt) if c == '}' and (i == 0 or prompt[i - 1] != '\\')), -1)
        if end < 0: break
        start = next((i for i in range(end - 1, -1, -1) if prompt[i] == '{' and (i == 0 or prompt[i - 1] != '\\')), -1)
        if start < 0: break
        options = prompt[start + 1:end].split('|')
        chosen = rng.choice(options)
        choices.append({'options': [option.strip() for option in options], 'chosen': chosen.strip()})
        prompt = prompt[:start] + chosen + prompt[end + 1:]
    prompt = re.sub(r'(?:\s*,\s*){2,}', ', ', prompt).strip().strip(',').strip()
    return prompt, choices


class GalleryPromptEncode:
    """Prompt boxes + shared library picker, compatible with standard CLIP conditioning."""
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'clip': ('CLIP',), 'text': ('STRING', {'multiline': True, 'dynamicPrompts': True, 'default': ''})},
                'optional': {'source_text': ('STRING', {'forceInput': True}), 'source_mode': (list(SOURCE_MODES), {'default': 'after'})},
                'hidden': {'extra_pnginfo': 'EXTRA_PNGINFO', 'unique_id': 'UNIQUE_ID'}}

    RETURN_TYPES = ('CONDITIONING', 'STRING')
    RETURN_NAMES = ('conditioning', 'text')
    FUNCTION = 'encode'
    CATEGORY = 'prompt/library'

    @classmethod
    def IS_CHANGED(cls, text='', source_text=None, source_mode='after', **kwargs):
        # Unresolved {a|b} groups are picked here each run, so the result must not be cached.
        return float('nan') if '{' in (text or '') + (source_text or '') else ''

    def encode(self, clip, text, source_text=None, source_mode='after', extra_pnginfo=None, unique_id=None):
        if clip is None:
            raise ValueError('Connect a CLIP text encoder to Gallery Prompt Encode.')
        composed = compose_prompt(text, source_text, source_mode)
        effective, choices = resolve_dynamic(composed)
        record_resolution(extra_pnginfo, unique_id, composed, effective, choices, source_text, source_exclusions(text) if source_mode == 'boxes' else None)
        return {'ui': {'effective_prompt': [effective], 'source_text': [source_text or '']}, 'result': (clip.encode_from_tokens_scheduled(clip.tokenize(effective)), effective)}


def record_resolution(extra_pnginfo, unique_id, composed, effective, choices, source_text=None, source_excluded=None):
    """Store what this encoder actually encoded. SaveImage writes every extra_pnginfo key as a PNG text chunk."""
    if not isinstance(extra_pnginfo, dict) or unique_id is None: return
    try:
        entry = {'text': composed, 'resolved': effective}
        if choices: entry['choices'] = choices
        if source_text: entry['source_text'] = source_text
        if source_excluded: entry['source_excluded'] = source_excluded
        extra_pnginfo.setdefault(RESOLVED_KEY, {})[str(unique_id)] = entry
    except (TypeError, AttributeError):
        pass

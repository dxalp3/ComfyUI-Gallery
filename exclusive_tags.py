"""Exclusive tag sets: tags in one set describe the same attribute (one hair length, one framing, ...).

The built-in list is data/exclusive-tags.json. Editing it in the gallery saves a copy per ComfyUI user
(gallery-exclusive-tags.json in the user folder); resetting deletes that copy.
"""
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit

from aiohttp import web

DEFAULT_PATH = Path(__file__).parent / 'data' / 'exclusive-tags.json'
MAX_SETS, MAX_TAGS, MAX_TEXT = 5000, 1000, 200


def clean_sets(value):
    """Validated `[{name, tags}]`: every set needs a name of at most 80 characters and two or more distinct tags."""
    if not isinstance(value, list) or len(value) > MAX_SETS:
        raise ValueError(f'Send at most {MAX_SETS} sets.')
    result = []
    for item in value:
        if not isinstance(item, dict): raise ValueError('Each set needs a name and tags.')
        name, tags = item.get('name', ''), item.get('tags')
        if not isinstance(name, str) or len(name) > 80: raise ValueError('Set names must be text of at most 80 characters.')
        if not isinstance(tags, list) or len(tags) > MAX_TAGS or any(not isinstance(tag, str) or len(tag) > MAX_TEXT for tag in tags):
            raise ValueError(f'Each set holds at most {MAX_TAGS} tags of at most {MAX_TEXT} characters.')
        unique = list(dict.fromkeys(tag.strip() for tag in tags if tag.strip()))
        if len(unique) >= 2: result.append({'name': name.strip(), 'tags': unique})
    return result


def read_sets(path):
    """The user's list when there is one, otherwise the built-in list."""
    for source, custom in ((path, True), (DEFAULT_PATH, False)):
        if source and Path(source).is_file():
            try:
                return {'sets': clean_sets(json.loads(Path(source).read_text(encoding='utf-8')).get('sets', [])), 'custom': custom}
            except (ValueError, AttributeError, OSError):
                if not custom: raise
    return {'sets': [], 'custom': False}


def write_sets(path, sets):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps({'version': 1, 'sets': clean_sets(sets)}, ensure_ascii=False, indent=2).encode()
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary: temporary.unlink(missing_ok=True)


def register_exclusive_routes(routes, get_path):
    @routes.get('/Gallery/exclusive-tags')
    @routes.post('/Gallery/exclusive-tags')
    async def exclusive_tags(request):
        try:
            origin = request.headers.get('Origin')
            if request.method == 'POST' and (request.headers.get('Sec-Fetch-Site') == 'cross-site' or origin and urlsplit(origin).netloc.lower() != request.host.lower()):
                return web.json_response({'error': 'Cross-origin writes are not allowed.'}, status=403)
            path = get_path(request)
            if not path: raise ValueError('The current ComfyUI user is unavailable.')
            if request.method == 'POST':
                data = await request.json()
                if not isinstance(data, dict): raise ValueError('Expected {"sets": [...]} or {"reset": true}.')
                if data.get('reset') is True: Path(path).unlink(missing_ok=True)
                else: write_sets(path, data.get('sets'))
            return web.json_response(read_sets(path), headers={'Cache-Control': 'no-store'})
        except (ValueError, KeyError) as error:
            return web.json_response({'error': str(error)}, status=400)
        except OSError:
            return web.json_response({'error': 'Cannot access the exclusive tag list.'}, status=500)

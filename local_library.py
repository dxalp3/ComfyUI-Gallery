"""Local-only organization. Rules never address files on the Hydrus server."""
import asyncio
import json
import os
from pathlib import Path
import re
import shutil
import threading
import time
from urllib.parse import urlsplit
from aiohttp import web

_lock = threading.RLock()
_settings = lambda: {}
_output = lambda: Path('.')


def configure_library(settings, output):
    global _settings, _output
    _settings, _output = settings, output


def root_path(value, output):
    path = Path(value or '.')
    return (path if path.is_absolute() else Path(output) / path).resolve()


def inside(path, root):
    return path == root or root in path.parents


def local_path(root, url):
    if not isinstance(url, str) or not url.startswith('/static_gallery/'):
        raise ValueError('Expected a local gallery file')
    path = (root / url[len('/static_gallery/'):]).resolve()
    if not inside(path, root) or not path.is_file():
        raise ValueError('File is missing or outside the local gallery root')
    return path


def prompts(metadata):
    """Resolve API text connections by polarity; ignore model and filename inputs."""
    def obj(value):
        if isinstance(value, str):
            try: value = json.loads(value)
            except ValueError: return {}
        return value if isinstance(value, dict) else {}
    meta = obj(metadata)
    graph = obj(meta.get('prompt'))
    result = {'positive': [], 'negative': []}
    def side(key):
        key = key.lower().replace(' ', '_').replace('-', '_')
        if key in ('positive', 'positive_prompt', 'positive_conditioning', 'pos'): return 'positive'
        if key in ('negative', 'negative_prompt', 'negative_conditioning', 'neg'): return 'negative'
    def collect(value, polarity, seen, depth=0):
        if depth > 64: return
        if isinstance(value, str) and value.strip(): result[polarity].append(value.strip())
        elif isinstance(value, list) and len(value) == 2:
            key = str(value[0])
            if key in seen: return
            seen.add(key)
            node = obj(graph.get(key))
            inputs = obj(node.get('inputs'))
            if node.get('class_type') == 'GalleryPromptEncode' and 'source_text' in inputs:
                mode = inputs.get('source_mode', 'after')
                if mode in ('before', 'replace'): collect(inputs['source_text'], polarity, seen, depth + 1)
                if mode != 'replace': collect(inputs.get('text', ''), polarity, seen, depth + 1)
                if mode not in ('before', 'replace'): collect(inputs['source_text'], polarity, seen, depth + 1)
                return
            if node.get('class_type') == 'GalleryImageSource' and value[1] in (4, 5):
                manifest = obj(inputs.get('sources'))
                images = manifest.get('images', [])
                if not isinstance(images, list): return
                index = manifest.get('active_index', 0)
                if type(index) is not int: return
                if manifest.get('layout', 'single') == 'single': images = images[index:index + 1]
                for image in images: collect(obj(obj(image).get('prompt')).get('positive' if value[1] == 4 else 'negative', ''), polarity, seen, depth + 1)
                return
            for name, item in obj(node.get('inputs')).items():
                branch = side(name)
                if (branch == polarity or (not branch and re.match(r'^(text|prompt|prefix|wildcard|populated_text|value|string|conditioning|clip_l|clip_g|t5xxl)(_|\d|$)', name))):
                    collect(item, polarity, seen, depth + 1)
    for node in graph.values():
        for name, value in obj(obj(node).get('inputs')).items():
            polarity = side(name)
            if not polarity and name == 'conditioning' and obj(node).get('class_type') == 'BasicGuider': polarity = 'positive'
            if polarity: collect(value, polarity, set())
    for polarity in result:
        if not result[polarity]:
            for source in (graph, meta):
                value = source.get(polarity) or source.get(polarity + '_prompt')
                if isinstance(value, str): result[polarity].append(value)
    parameters = meta.get('parameters', '')
    if isinstance(parameters, str):
        parts = re.split(r'\nNegative prompt:\s*', re.split(r'\nSteps:\s*\d', parameters, flags=re.I)[0], flags=re.I)
        if not result['positive']: result['positive'] = parts[:1]
        if not result['negative']: result['negative'] = parts[1:]
    return {side: '\n'.join(dict.fromkeys(values)) for side, values in result.items()}


def destinations(settings, root, output):
    return [root] + [root_path(value, output) for value in settings.get('extraFolders', []) if isinstance(value, str) and value.strip()]


def plan(root, folders, settings, output):
    allowed = destinations(settings, root, output)
    rules = settings.get('routingRules', [])
    checked = []
    for rule in rules:
        if not rule.get('enabled', True): continue
        terms = [t.strip().casefold() for t in rule.get('terms', []) if isinstance(t, str) and t.strip()]
        if not terms or not rule.get('folder'): continue
        base = root_path(rule.get('destinationRoot') or str(root), output)
        if base not in allowed: raise ValueError('Routing destination must be the current root or a saved extra folder')
        target = (base / rule['folder']).resolve()
        if not inside(target, base) or target == base: raise ValueError('Routing folder must be a subfolder of its saved root')
        checked.append((rule, terms, target))
    moves = []
    seen = set()
    for files in folders.values():
        for file in files.values():
            if file.get('type') != 'image': continue
            try: path = local_path(root, file['url'])
            except (ValueError, OSError): continue
            if path in seen: continue
            seen.add(path)
            # Destination trees are terminal: rules cannot bounce files between folders.
            if any(inside(path, target) for _, _, target in checked): continue
            parsed = prompts(file.get('metadata', {}))
            for rule, terms, target in checked:
                text = parsed.get(rule.get('field', 'positive'), '').casefold()
                if not text: continue
                matches = [term in text for term in terms]
                if (any(matches) if rule.get('match') == 'any' else all(matches)):
                    moves.append({'url': file['url'], 'target': str(target / path.name), 'rule': rule.get('name', ''), 'source': str(path)})
                    break
    return moves


def move_no_replace(source, target):
    """Copy with exclusive creation; remove source only after verified complete copy."""
    before = source.stat()
    target.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with target.open('xb') as out:
            created = True
            with source.open('rb') as inp: shutil.copyfileobj(inp, out)
            out.flush()
            os.fsync(out.fileno())
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or target.stat().st_size != before.st_size:
            raise ValueError('Source changed during move; try again when generation has finished')
        shutil.copystat(source, target)
        source.unlink()
    except Exception:
        if created: target.unlink(missing_ok=True)
        raise


def organize(root, folders, settings, output, apply=False):
    root = Path(root).resolve()
    with _lock:
        moves = plan(root, folders, settings, output)
        results = []
        for item in moves:
            row = {k: v for k, v in item.items() if k != 'source'}
            source, target = Path(item['source']), Path(item['target'])
            if not source.is_file(): row['error'] = 'Source disappeared; reload before retrying'
            elif target.exists(): row['error'] = 'Destination already exists; skipped (no overwrite)'
            elif time.time() - source.stat().st_mtime < 2: row['error'] = 'File is still new; waiting for generation to finish'
            elif apply:
                try:
                    move_no_replace(source, target)
                    row['moved'] = True
                    for key, files in list(folders.items()):
                        for name, file in list(files.items()):
                            if file['url'] != item['url']: continue
                            del files[name]
                            if inside(target, root):
                                relative = target.relative_to(root)
                                folder = (Path(root.name) / relative.parent).as_posix()
                                folders.setdefault(folder, {})[target.name] = {**file, 'name': target.name, 'url': '/static_gallery/' + relative.as_posix()}
                        if not files: folders.pop(key, None)
                except (OSError, ValueError) as error: row['error'] = str(error)
            results.append(row)
        return results


def auto_organize(root, folders):
    settings = _settings()
    if settings.get('autoOrganize') and Path(root).resolve() == root_path(settings.get('relativePath'), _output()):
        return organize(root, folders, settings, _output(), True)
    return []


def routing_enabled(root):
    settings = _settings()
    return bool(settings.get('autoOrganize')) and Path(root).resolve() == root_path(settings.get('relativePath'), _output())


def register_library_routes(routes, get_root, get_settings, get_output, scan):
    configure_library(get_settings, get_output)
    async def organize_request(request):
        origin = request.headers.get('Origin')
        if request.headers.get('Sec-Fetch-Site') == 'cross-site' or (origin and urlsplit(origin).netloc.lower() != request.host.lower()):
            return web.json_response({'error': 'Cross-origin requests are not allowed'}, status=403)
        try:
            data = await request.json()
            root = Path(get_root()).resolve()
            if root_path(data.get('root'), get_output()) != root: raise ValueError('Gallery root changed; reload before organizing')
            settings = {**get_settings(), 'routingRules': data.get('rules', get_settings().get('routingRules', []))}
            folders = await asyncio.to_thread(scan, root)
            rows = await asyncio.to_thread(organize, root, folders, settings, get_output(), data.get('apply') is True)
            return web.json_response({'items': rows})
        except (ValueError, OSError, TypeError) as error:
            return web.json_response({'error': str(error)}, status=400)
    async def delete_request(request):
        origin = request.headers.get('Origin')
        if request.headers.get('Sec-Fetch-Site') == 'cross-site' or (origin and urlsplit(origin).netloc.lower() != request.host.lower()):
            return web.json_response({'error': 'Cross-origin deletion is not allowed'}, status=403)
        try:
            data = await request.json()
            root = Path(get_root()).resolve()
            if data.get('root') is not None and root_path(data['root'], get_output()) != root:
                return web.json_response({'error': 'Gallery root changed; reload before deleting'}, status=409)
            def remove():
                with _lock: local_path(root, data.get('image_path')).unlink()
            await asyncio.to_thread(remove)
            return web.json_response({'deleted': data['image_path']})
        except (ValueError, OSError, TypeError) as error:
            return web.json_response({'error': str(error)}, status=400)
    routes.post('/Gallery/delete')(delete_request)
    routes.post('/Gallery/organize')(organize_request)

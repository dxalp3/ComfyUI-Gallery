"""Carry metadata without changing content-addressed originals."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
from PIL import Image


def read_metadata(path):
    path = Path(path)
    result = {}
    try:
        with Image.open(path) as image:
            result = {key: image.info[key] for key in ('prompt', 'workflow', 'parameters') if key in image.info}
    except (OSError, ValueError):
        pass
    sidecar = path.with_name(path.name + '.gallery.json')
    if sidecar.is_file() and not sidecar.is_symlink() and sidecar.stat().st_size <= 8 * 1024 * 1024:
        saved = json.loads(sidecar.read_text(encoding='utf-8'))
        with path.open('rb') as stream:
            hasher = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b''): hasher.update(chunk)
            digest = hasher.hexdigest()
        if saved.get('sha256') == digest:
            result.update(saved.get('metadata', {}))
    return result


def write_metadata(path, digest, metadata):
    path = Path(path)
    sidecar = path.with_name(path.name + '.gallery.json')
    if sidecar.is_symlink():
        raise ValueError('Metadata sidecar cannot be a symbolic link')
    if sidecar.exists():
        saved = json.loads(sidecar.read_text(encoding='utf-8'))
        if saved.get('version') != 1 or saved.get('sha256') != digest:
            raise ValueError('A different metadata sidecar occupies this filename')
    body = json.dumps({'version': 1, 'sha256': digest, 'metadata': metadata}, ensure_ascii=False, default=str)
    if len(body.encode('utf-8')) > 8 * 1024 * 1024:
        raise ValueError('Transfer metadata exceeds 8 MiB; original bytes remain preserved')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
        os.replace(temporary, sidecar)
    finally:
        if temporary: temporary.unlink(missing_ok=True)

"""Local image imports and preview routes for Gallery Image Source."""

import asyncio
import hashlib
import os
from pathlib import Path
import tempfile
from urllib.parse import urlencode, urlsplit

from aiohttp import web
from PIL import Image

try:
    from .transfer_metadata import read_metadata, write_metadata
    from .thumbnails import register_thumbnail_routes
    from .hydrus import HydrusError, resolve_image
    from .image_source import (ImageSourceError, MAX_SOURCE_BYTES, file_fingerprint,
                               inspect_image, preview_composition)
except ImportError:  # Standalone unit tests.
    from transfer_metadata import read_metadata, write_metadata
    from thumbnails import register_thumbnail_routes
    from hydrus import HydrusError, resolve_image
    from image_source import (ImageSourceError, MAX_SOURCE_BYTES, file_fingerprint,
                              inspect_image, preview_composition)


def import_local_image(gallery_root, input_root, url):
    result = import_file(resolve_image(gallery_root, url), input_root)
    result['metadata'] = {**result['metadata'], 'gallery_url': url, 'gallery_origin': 'gallery'}
    write_metadata(Path(input_root) / result['input_name'], result['hash'], result['metadata'])
    return result


def import_input_image(input_root, name):
    """An image already in ComfyUI's input folder (a Load Image node's image, or a file dropped on the node)."""
    if not isinstance(name, str) or not name or len(name) > 2048:
        raise ImageSourceError("Name an image from ComfyUI's input folder.")
    # Load Image values look like "sub/name.png" or "name.png [input]".
    clean = name.replace("\\", "/").rsplit(" [", 1)[0] if name.endswith("]") else name.replace("\\", "/")
    base = Path(input_root).resolve(strict=True)
    try:
        source = (base / clean).resolve(strict=True)
        source.relative_to(base)
    except (OSError, ValueError):
        raise ImageSourceError("That image is not in ComfyUI's input folder.") from None
    if not source.is_file():
        raise ImageSourceError("That image is not in ComfyUI's input folder.")
    return import_file(source, input_root)


def import_file(source, input_root):
    before = file_fingerprint(source)
    if before[0] > MAX_SOURCE_BYTES:
        raise ImageSourceError("The source image exceeds the 256 MiB file limit.")
    base = Path(input_root).resolve(strict=True)
    directory = base / "gallery_sources"
    directory.mkdir(exist_ok=True)
    try:
        directory.resolve(strict=True).relative_to(base)
    except (OSError, ValueError):
        raise ImageSourceError("Gallery source storage must stay inside ComfyUI's input folder.") from None
    temporary = None
    try:
        digest = hashlib.sha256()
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".gallery-source-", delete=False) as output:
            temporary = Path(output.name)
            with source.open("rb") as stream:
                size = 0
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    size += len(chunk)
                    if size > MAX_SOURCE_BYTES:
                        raise ImageSourceError("The source image exceeds the 256 MiB file limit.")
                    digest.update(chunk)
                    output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if file_fingerprint(source) != before:
            raise ImageSourceError("The source image changed while copying; please retry.")
        width, height = inspect_image(temporary)
        with Image.open(temporary) as image:
            extension = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "GIF": ".gif",
                         "BMP": ".bmp", "TIFF": ".tiff", "AVIF": ".avif", "JPEGXL": ".jxl"}.get(image.format)
            if extension is None:
                raise ImageSourceError("This image format is not supported as a gallery source.")
            image.verify()
        destination = directory / (digest.hexdigest() + extension)
        try:
            # Link the complete temporary file atomically; never replace an existing file.
            os.link(temporary, destination)
        except FileExistsError:
            if destination.is_symlink() or not destination.is_file():
                raise ImageSourceError("The saved gallery source is not a regular file.") from None
            actual = hashlib.sha256()
            with destination.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    actual.update(chunk)
            if actual.hexdigest() != digest.hexdigest():
                raise ImageSourceError("A different file occupies the saved gallery source path; it was not overwritten.")
        metadata = read_metadata(source)
        write_metadata(destination, digest.hexdigest(), metadata)
        return {"metadata": metadata, "input_name": "gallery_sources/" + destination.name,
                "url": "/view?" + urlencode({"filename": destination.name, "subfolder": "gallery_sources", "type": "input"}),
                "width": width, "height": height, "title": source.name, "hash": digest.hexdigest()}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


HASH_CACHE = {}
SIZE_CACHE = {}
INPUT_IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".avif"}


def list_input_images(input_root, limit=5000):
    """Images in ComfyUI's input folder (what Load Image lists), newest first, for the Image Source picker.

    The gallery's own copies (gallery_sources/, hydrus/) are left out: they are already sources somewhere.
    """
    base = Path(input_root).resolve(strict=True)
    found = []
    for directory, folders, files in os.walk(base):
        folders[:] = [name for name in folders if not name.startswith(".") and not (Path(directory) == base and name in ("gallery_sources", "hydrus"))]
        for name in files:
            path = Path(directory) / name
            if name.startswith(".") or path.suffix.lower() not in INPUT_IMAGE_TYPES:
                continue
            try:
                stamp = file_fingerprint(path)
            except OSError:
                continue
            found.append((stamp, path))
    found.sort(key=lambda item: item[0][1], reverse=True)
    items = []
    for stamp, path in found[:limit]:
        size = SIZE_CACHE.get(str(path))
        if not size or size[0] != stamp:
            try:
                with Image.open(path) as image:
                    size = (stamp, image.size)
            except (OSError, ValueError, Image.DecompressionBombError):
                size = (stamp, None)
            if len(SIZE_CACHE) > 50000: SIZE_CACHE.clear()
            SIZE_CACHE[str(path)] = size
        items.append({"name": path.relative_to(base).as_posix(), "modified": stamp[1] / 1e9, "bytes": stamp[0],
                      **({"width": size[1][0], "height": size[1][1]} if size[1] else {})})
    return {"images": items, "total": len(found)}


def local_hashes(gallery_root, urls):
    """SHA-256 of gallery images (the same hash Hydrus and Gallery Image Source copies use).

    Lets a prefix paired with a local image find the images that were generated from it.
    Results are cached by file fingerprint; unreadable or vanished files are skipped.
    """
    if not isinstance(urls, list) or len(urls) > 5000 or any(not isinstance(url, str) for url in urls):
        raise ImageSourceError("Send up to 5,000 gallery image URLs.")
    result = {}
    for url in dict.fromkeys(urls):
        try:
            path = resolve_image(gallery_root, url)
            stamp = file_fingerprint(path)
            cached = HASH_CACHE.get(str(path))
            if cached and cached[0] == stamp:
                result[url] = cached[1]
                continue
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            if len(HASH_CACHE) > 50000: HASH_CACHE.clear()
            HASH_CACHE[str(path)] = (stamp, digest.hexdigest())
            result[url] = digest.hexdigest()
        except (HydrusError, OSError):
            continue
    return {"hashes": result}


def register_source_routes(routes, get_gallery_root, get_input_root):
    workers = asyncio.Semaphore(2)
    register_thumbnail_routes(routes, get_input_root, route_path="/Gallery/source/thumbnail")

    async def handle(request, action):
        origin = request.headers.get("Origin")
        if (request.headers.get("Sec-Fetch-Site") == "cross-site"
                or (origin and urlsplit(origin).netloc.lower() != request.host.lower())):
            return web.json_response({"error": "Cross-origin gallery source requests are not allowed."}, status=403)
        try:
            try:
                data = await request.json()
            except (ValueError, UnicodeError):
                raise ImageSourceError("Request body must be JSON.") from None
            if not isinstance(data, dict):
                raise ImageSourceError("Request body must be a JSON object.")
            async with workers:
                if action == "hashes":
                    return web.json_response(await asyncio.to_thread(local_hashes, get_gallery_root(), data.get("urls")))
                if action == "inputs":
                    return web.json_response(await asyncio.to_thread(list_input_images, get_input_root()))
                if action == "input":
                    return web.json_response(await asyncio.to_thread(import_input_image, get_input_root(), data.get("name")))
                if action == "local":
                    result = await asyncio.to_thread(import_local_image, get_gallery_root(), get_input_root(), data.get("url"))
                    if isinstance(data.get('metadata'), dict):
                        result['metadata'] = {**data['metadata'], **result.get('metadata', {})}
                        await asyncio.to_thread(write_metadata, Path(get_input_root()) / result['input_name'], result['hash'], result['metadata'])
                    return web.json_response(result)
                image, width, height = await asyncio.to_thread(preview_composition, data.get("manifest"), get_input_root())
                return web.Response(body=image, content_type="image/png", headers={
                    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                    "X-Image-Width": str(width), "X-Image-Height": str(height)})
        except (ImageSourceError, HydrusError) as error:
            return web.json_response({"error": str(error)}, status=400)
        except (OSError, ValueError, Image.DecompressionBombError):
            return web.json_response({"error": "The source image could not be read or saved. Check its format and folder permissions."}, status=400)

    @routes.post("/Gallery/source/local")
    async def import_local(request):
        return await handle(request, "local")

    @routes.post("/Gallery/source/inputs")
    async def input_images(request):
        return await handle(request, "inputs")

    @routes.post("/Gallery/source/input")
    async def import_input(request):
        return await handle(request, "input")

    @routes.post("/Gallery/source/hashes")
    async def hashes(request):
        return await handle(request, "hashes")

    @routes.post("/Gallery/source/preview")
    async def preview(request):
        return await handle(request, "preview")

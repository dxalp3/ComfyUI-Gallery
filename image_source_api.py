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
    from .thumbnails import register_thumbnail_routes
    from .hydrus import HydrusError, resolve_image
    from .image_source import (ImageSourceError, MAX_SOURCE_BYTES, file_fingerprint,
                               inspect_image, preview_composition)
except ImportError:  # Standalone unit tests.
    from thumbnails import register_thumbnail_routes
    from hydrus import HydrusError, resolve_image
    from image_source import (ImageSourceError, MAX_SOURCE_BYTES, file_fingerprint,
                              inspect_image, preview_composition)


def import_local_image(gallery_root, input_root, url):
    source = resolve_image(gallery_root, url)
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
        return {"input_name": "gallery_sources/" + destination.name,
                "url": "/view?" + urlencode({"filename": destination.name, "subfolder": "gallery_sources", "type": "input"}),
                "width": width, "height": height, "title": source.name, "hash": digest.hexdigest()}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


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
                if action == "local":
                    result = await asyncio.to_thread(import_local_image, get_gallery_root(), get_input_root(), data.get("url"))
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

    @routes.post("/Gallery/source/preview")
    async def preview(request):
        return await handle(request, "preview")

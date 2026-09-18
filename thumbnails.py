"""Small gallery previews, without rewriting or caching copies of original files."""

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
import hashlib
from io import BytesIO
import threading

from aiohttp import web
from PIL import Image, ImageOps, features

try:
    from .hydrus import HydrusError, fingerprint, resolve_image
except ImportError:  # Standalone unit tests.
    from hydrus import HydrusError, fingerprint, resolve_image


THUMBNAIL_EDGE = 512
MAX_CACHE_BYTES = 32 * 1024 * 1024
MAX_CACHE_ENTRIES = 512
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_SOURCE_PIXELS = 64 * 1024 * 1024


@dataclass(frozen=True)
class Thumbnail:
    data: bytes
    content_type: str
    etag: str


class ThumbnailCache:
    """A byte- and entry-bounded LRU, shared by the two decoding workers."""

    def __init__(self, max_bytes=MAX_CACHE_BYTES, max_entries=MAX_CACHE_ENTRIES):
        self.max_bytes = max_bytes
        self.max_entries = max_entries
        self.size = 0
        self.entries = OrderedDict()
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            value = self.entries.get(key)
            if value is not None:
                self.entries.move_to_end(key)
            return value

    def put(self, key, thumbnail):
        with self.lock:
            old = self.entries.pop(key, None)
            if old:
                self.size -= len(old.data)
            # Replaced originals should not leave stale versions occupying RAM.
            for existing in list(self.entries):
                if existing[0] == key[0]:
                    self.size -= len(self.entries.pop(existing).data)
            if len(thumbnail.data) > self.max_bytes or self.max_entries < 1:
                return
            self.entries[key] = thumbnail
            self.size += len(thumbnail.data)
            while self.size > self.max_bytes or len(self.entries) > self.max_entries:
                _, removed = self.entries.popitem(last=False)
                self.size -= len(removed.data)


class ThumbnailService:
    def __init__(self, get_root, cache=None):
        self.get_root = get_root
        self.cache = cache if cache is not None else ThumbnailCache()
        self.workers = asyncio.Semaphore(2)
        self.pending = {}

    def render(self, root, url):
        """All filesystem access and image decoding happen off the event loop."""
        path = resolve_image(root, url)
        before = path.stat()
        key = (str(path), fingerprint(before))
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        if before.st_size > MAX_SOURCE_BYTES:
            raise ValueError("Image is too large for a gallery thumbnail.")
        with Image.open(path) as source:
            if source.width * source.height > MAX_SOURCE_PIXELS:
                raise ValueError("Image dimensions are too large for a gallery thumbnail.")
            # JPEG decoders can reduce the image before expanding all its pixels.
            source.draft("RGB", (THUMBNAIL_EDGE, THUMBNAIL_EDGE))
            source.seek(0)
            source.thumbnail((THUMBNAIL_EDGE, THUMBNAIL_EDGE), Image.Resampling.LANCZOS,
                             reducing_gap=3.0)
            oriented = ImageOps.exif_transpose(source)
            try:
                transparent = "A" in oriented.getbands() or "transparency" in oriented.info
                converted = oriented.convert("RGBA" if transparent else "RGB")
                try:
                    # Preview files do not need workflow, prompt, or EXIF payloads.
                    converted.info.clear()
                    output = BytesIO()
                    if features.check("webp"):
                        converted.save(output, "WEBP", quality=82, method=4)
                        content_type = "image/webp"
                    else:
                        converted.save(output, "PNG", optimize=False)
                        content_type = "image/png"
                    data = output.getvalue()
                finally:
                    converted.close()
            finally:
                oriented.close()
        if fingerprint(path.stat()) != key[1]:
            raise ValueError("Image changed while its thumbnail was being generated.")
        result = Thumbnail(data, content_type, hashlib.sha256(data).hexdigest())
        self.cache.put(key, result)
        return result

    async def _render(self, root, url):
        async with self.workers:
            return await asyncio.to_thread(self.render, root, url)

    async def get(self, url):
        key = (str(self.get_root()), url)
        task = self.pending.get(key)
        if task is None:
            task = asyncio.create_task(self._render(*key))
            self.pending[key] = task

            def done(completed):
                self.pending.pop(key, None)
                # Consume an exception even if every requesting browser left.
                if not completed.cancelled():
                    completed.exception()

            task.add_done_callback(done)
        return await asyncio.shield(task)


def register_thumbnail_routes(routes, get_root, cache=None):
    service = ThumbnailService(get_root, cache)

    @routes.get("/Gallery/thumbnail")
    async def thumbnail(request):
        try:
            url = request.query.get("url", "")
            if len(url) > 8192:
                raise ValueError("Invalid image path.")
            result = await service.get(url)
        except (HydrusError, OSError, ValueError, Image.DecompressionBombError):
            # The gallery can fall back to the original image for unsupported formats.
            return web.Response(status=404, text="Thumbnail unavailable.",
                                headers={"Cache-Control": "no-store"})
        etag = '"' + result.etag + '"'
        headers = {"ETag": etag, "Cache-Control": "private, max-age=30, must-revalidate",
                   "X-Content-Type-Options": "nosniff"}
        candidates = request.headers.get("If-None-Match", "").split(",")
        if any(candidate.strip().removeprefix("W/") in (etag, "*") for candidate in candidates):
            return web.Response(status=304, headers=headers)
        return web.Response(body=result.data, content_type=result.content_type, headers=headers)

    return service

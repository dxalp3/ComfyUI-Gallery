"""Run with python -m unittest discover -s tests -p 'test_thumbnails.py'."""

import asyncio
from io import BytesIO
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from thumbnails import (Thumbnail, ThumbnailCache, ThumbnailService,
                        register_thumbnail_routes)


class CacheTests(unittest.TestCase):
    def test_bytes_entries_lru_and_replacement_are_bounded(self):
        cache = ThumbnailCache(max_bytes=10, max_entries=2)
        value = Thumbnail(b"1234", "image/webp", "x")
        cache.put(("a", 1), value)
        cache.put(("b", 1), value)
        self.assertIs(cache.get(("a", 1)), value)
        cache.put(("c", 1), value)
        self.assertIsNone(cache.get(("b", 1)))
        self.assertEqual(cache.size, 8)
        cache.put(("a", 2), value)
        self.assertIsNone(cache.get(("a", 1)))
        self.assertEqual(cache.size, 8)
        cache.put(("d", 1), Thumbnail(b"x" * 11, "image/webp", "y"))
        self.assertIsNone(cache.get(("d", 1)))
        self.assertLessEqual(cache.size, 10)
        cache.put(("e", 1), Thumbnail(b"1234567", "image/webp", "z"))
        self.assertEqual(cache.size, 7)
        self.assertEqual(len(cache.entries), 1)


class ThumbnailRoutesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / "literal %20 # image.png"
        info = PngImagePlugin.PngInfo()
        info.add_text("prompt", "generation payload")
        Image.new("RGBA", (1600, 800), (200, 30, 10, 100)).save(self.path, pnginfo=info)
        self.raw_id = "/static_gallery/" + self.path.name
        self.current_root = self.root
        routes = web.RouteTableDef()
        self.service = register_thumbnail_routes(routes, lambda: self.current_root)
        app = web.Application()
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def request(self, url=None, headers=None):
        return await self.client.get("/Gallery/thumbnail", params={"url": url or self.raw_id},
                                     headers=headers)

    async def test_small_aspect_correct_transparent_preview_and_original_untouched(self):
        original = self.path.read_bytes()
        response = await self.request()
        self.assertEqual(response.status, 200)
        self.assertIn(response.content_type, ("image/webp", "image/png"))
        with Image.open(BytesIO(await response.read())) as preview:
            self.assertEqual(preview.size, (512, 256))
            self.assertIn("A", preview.getbands())
            self.assertAlmostEqual(preview.getpixel((0, 0))[3], 100, delta=1)
            self.assertNotIn("prompt", preview.info)
        self.assertEqual(self.path.read_bytes(), original)

    async def test_cache_hit_revalidates_and_replacement_invalidates(self):
        first = await self.request()
        first_bytes = await first.read()
        etag = first.headers["ETag"]
        with patch("thumbnails.Image.open", side_effect=AssertionError("Must use cached bytes")):
            second = await self.request()
            self.assertEqual(await second.read(), first_bytes)
            revalidated = await self.request(headers={"If-None-Match": '"old", W/' + etag})
            self.assertEqual(revalidated.status, 304)
            self.assertEqual(await revalidated.read(), b"")
        Image.new("RGB", (800, 1600), "blue").save(self.path)
        changed = await self.request(headers={"If-None-Match": etag})
        self.assertEqual(changed.status, 200)
        self.assertNotEqual(changed.headers["ETag"], etag)
        with Image.open(BytesIO(await changed.read())) as preview:
            self.assertEqual(preview.size, (256, 512))
        self.assertEqual(len(self.service.cache.entries), 1)

    async def test_exif_orientation_and_first_frame(self):
        path = self.root / "oriented.jpg"
        exif = Image.Exif()
        exif[274] = 6
        Image.new("RGB", (1000, 500), "red").save(path, exif=exif)
        response = await self.request("/static_gallery/oriented.jpg")
        with Image.open(BytesIO(await response.read())) as preview:
            self.assertEqual(preview.size, (256, 512))
            self.assertFalse(preview.getexif())
        frames = [Image.new("RGB", (30, 20), color) for color in ("red", "blue")]
        frames[0].save(self.root / "animated.gif", save_all=True, append_images=frames[1:], duration=100)
        response = await self.request("/static_gallery/animated.gif")
        with Image.open(BytesIO(await response.read())) as preview:
            self.assertEqual(preview.size, (30, 20))
            self.assertGreater(preview.convert("RGB").getpixel((5, 5))[0], 200)
            self.assertEqual(getattr(preview, "n_frames", 1), 1)

    async def test_paths_bad_data_and_source_limits_are_safe_404(self):
        (self.root / "bad.png").write_text("not an image")
        (self.root / "text.txt").write_text("a text file")
        for value in ("/static_gallery/../outside.png", "/static_gallery/folder/../../a.png",
                      "/static_gallery/C:/private.png", "/static_gallery/folder\\a.png",
                      "https://example.com/file.png", "/static_gallery/missing.png",
                      "/static_gallery/bad.png", "/static_gallery/text.txt"):
            response = await self.request(value)
            self.assertEqual(response.status, 404, value)
            self.assertEqual(await response.text(), "Thumbnail unavailable.")
        with patch("thumbnails.MAX_SOURCE_BYTES", 1):
            self.assertEqual((await self.request()).status, 404)
        with patch("thumbnails.MAX_SOURCE_PIXELS", 1):
            self.assertEqual((await self.request()).status, 404)

    async def test_changing_gallery_root_cannot_return_previous_root_thumbnail(self):
        first = await self.request()
        await first.read()
        replacement = self.root / "second-root"
        replacement.mkdir()
        Image.new("RGB", (10, 30), "blue").save(replacement / self.path.name)
        self.current_root = replacement
        second = await self.request()
        self.assertNotEqual(first.headers["ETag"], second.headers["ETag"])
        with Image.open(BytesIO(await second.read())) as preview:
            self.assertEqual(preview.size, (10, 30))

    async def test_concurrent_requests_share_decode_without_blocking_event_loop(self):
        calls = []

        def slow_render(root, url):
            calls.append(url)
            time.sleep(0.1)
            return Thumbnail(b"preview", "image/webp", "x")

        service = ThumbnailService(lambda: self.root)
        with patch.object(service, "render", side_effect=slow_render):
            tasks = [asyncio.create_task(service.get(self.raw_id)) for _ in range(5)]
            await asyncio.sleep(0.03)
            self.assertFalse(tasks[0].done())
            results = await asyncio.gather(*tasks)
        self.assertEqual(calls, [self.raw_id])
        self.assertEqual([result.data for result in results], [b"preview"] * 5)

    async def test_symlink_outside_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / "private.png"
            Image.new("RGB", (10, 10), "blue").save(target)
            link = self.root / "outside.png"
            try:
                link.symlink_to(target)
            except OSError:
                self.skipTest("Creating symlinks requires privileges on this system.")
            self.assertEqual((await self.request("/static_gallery/outside.png")).status, 404)


if __name__ == "__main__":
    unittest.main()

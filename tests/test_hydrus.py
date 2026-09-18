"""Run with python -m unittest discover -s tests -p 'test_hydrus*.py'."""

import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hydrus import (HydrusBridge, HydrusClient, HydrusError, HydrusMemory,
                    HydrusSettings, image_snapshot, normalize_url, register_hydrus_routes,
                    resolve_image, service_list, target_identity)


KEY = "ab" * 32


def create_image(path, color="red"):
    info = PngImagePlugin.PngInfo()
    info.add_text("prompt", '{"1":{"class_type":"KSampler","inputs":{"seed":42}}}')
    info.add_text("workflow", '{"nodes":[{"id":1}]}')
    Image.new("RGB", (12, 8), color).save(path, pnginfo=info)


class FakeHydrus:
    def __init__(self):
        self.calls = []
        self.import_status = 1
        self.fail_tags = False
        self.fail_notes = False
        self.fail_metadata = False
        self.metadata_mode = "present"
        self.imported = set()

    def __call__(self, settings):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def request(self, method, endpoint, **kwargs):
        if endpoint == "/add_files/add_file":
            raw = kwargs["data"].read()
            digest = hashlib.sha256(raw).hexdigest()
            self.calls.append((endpoint, raw, kwargs["headers"]))
            self.imported.add(digest)
            return {"status": self.import_status, "hash": digest}
        self.calls.append((endpoint, kwargs.get("json")))
        if endpoint == "/add_tags/add_tags" and self.fail_tags:
            raise HydrusError("Tag permission denied.")
        if endpoint == "/add_notes/set_notes" and self.fail_notes:
            raise HydrusError("Note permission denied.")
        return {}

    async def metadata(self, digest):
        self.calls.append(("metadata", digest))
        if self.fail_metadata:
            raise HydrusError("Hydrus is offline.")
        if self.metadata_mode == "missing":
            return None
        return {"hash": digest, "file_id": 123, "is_local": self.metadata_mode != "nonlocal",
                "is_deleted": self.metadata_mode == "deleted", "is_trashed": False,
                "tags": {"1234": {"display_tags": {"0": ["test:tag"]}}},
                "notes": {"my note": "keep me"}, "services_v2": [{"service_key": "1234", "name": "my tags", "type": 5}]}


class LocalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.image = self.root / "image.png"
        create_image(self.image)

    def test_settings_are_masked_atomic_and_key_rotation_preserves_identity(self):
        settings = HydrusSettings(self.root)
        public = settings.save({"access_key": KEY, "default_tags": [" a ", "a", "b"]})
        self.assertNotIn("access_key", public)
        self.assertNotIn(KEY, json.dumps(public))
        self.assertTrue(public["has_access_key"])
        identity = target_identity(settings.load())
        settings.save({"access_key": ""})
        self.assertEqual(settings.load()["access_key"], KEY)
        settings.save({"access_key": "cd" * 32})
        self.assertEqual(identity, target_identity(settings.load()))
        settings.save({"profile": "another-library"})
        self.assertNotEqual(identity, target_identity(settings.load()))
        settings.save({"clear_access_key": True})
        self.assertFalse(settings.public(settings.load())["has_access_key"])
        self.assertEqual(settings.load()["default_tags"], ["a", "b"])
        self.assertFalse(list(self.root.glob(".hydrus-settings-*")))

    def test_invalid_settings_do_not_overwrite_saved_values_or_echo_key(self):
        settings = HydrusSettings(self.root)
        settings.save({"access_key": KEY})
        for patch in ({"url": "http://user:secret@example.org"}, {"url": "http://example.org/?key=" + KEY},
                      {"send_metadata": "false"}, {"timeout_seconds": 0}, {"access_key": "secret-token"},
                      {"default_tags": "tag"}):
            with self.subTest(patch=patch), self.assertRaises(HydrusError) as caught:
                settings.save(patch)
            self.assertNotIn(KEY, str(caught.exception))
            self.assertEqual(settings.load()["access_key"], KEY)

    def test_positive_prompt_prefix_default_is_persisted_and_backwards_compatible(self):
        settings = HydrusSettings(self.root)
        self.assertTrue(settings.load()["prefix_positive_prompt_tags"])
        settings.save({"prefix_positive_prompt_tags": False})
        self.assertFalse(HydrusSettings(self.root).load()["prefix_positive_prompt_tags"])
        with self.assertRaises(HydrusError):
            settings.save({"prefix_positive_prompt_tags": "false"})

    def test_url_normalization_and_credentials_rejected(self):
        self.assertEqual(normalize_url("http://LOCALHOST:80/"), "http://localhost")
        self.assertEqual(normalize_url("https://[::1]:443/api/"), "https://[::1]/api")
        for url in ("file:///tmp", "http://user:pass@host", "http://host/#key", "http://host/?key=123", "http://host:bad"):
            with self.subTest(url=url), self.assertRaises(HydrusError):
                normalize_url(url)

    def test_raw_percent_hash_and_unicode_filenames_survive(self):
        name = "100%20 literal # 青.png"
        create_image(self.root / name)
        self.assertEqual(resolve_image(self.root, "/static_gallery/" + name), (self.root / name).resolve())

    def test_traversal_absolute_paths_nonimages_and_missing_are_rejected(self):
        (self.root / "mesh.obj").write_text("mesh")
        for url in ("/static_gallery/../outside.png", "/static_gallery//etc/a.png", "/static_gallery/C:/a.png",
                    "/static_gallery/a\\b.png", "/static_gallery/mesh.obj", "/static_gallery/missing.png",
                    "http://server/static_gallery/image.png", "/static_gallery/%2e%2e/outside.png"):
            with self.subTest(url=url), self.assertRaises(HydrusError):
                resolve_image(self.root, url)

    def test_symlink_outside_root_rejected(self):
        nested = self.root / "gallery"
        nested.mkdir()
        try:
            (nested / "escape.png").symlink_to(self.image)
        except OSError:
            self.skipTest("Platform does not permit symlink creation.")
        with self.assertRaises(HydrusError):
            resolve_image(nested, "/static_gallery/escape.png")

    def test_hash_cache_invalidates_content_replacement(self):
        memory = HydrusMemory(self.root)
        first = memory.hash_file(self.image)
        self.assertEqual(first, memory.hash_file(self.image))
        create_image(self.image, "blue")
        changed = memory.hash_file(self.image)
        self.assertNotEqual(first, changed)
        self.assertEqual(changed, hashlib.sha256(self.image.read_bytes()).hexdigest())

    def test_snapshot_preserves_exact_bytes_and_generation_metadata(self):
        stream, digest, note, warning = image_snapshot(self.image)
        with stream:
            self.assertEqual(stream.read(), self.image.read_bytes())
        self.assertEqual(digest, hashlib.sha256(self.image.read_bytes()).hexdigest())
        self.assertIn("prompt", json.loads(note))
        self.assertIsNone(warning)
        self.image.write_text("not an image")
        with self.assertRaises(OSError):
            image_snapshot(self.image)

    def test_service_versions(self):
        current = [{"service_key": "aa", "name": "tags", "type": 5}]
        self.assertEqual(service_list({"services_v2": current}), current)
        self.assertEqual(service_list({"services": current}), current)
        self.assertEqual(service_list({"services": {"aa": {"name": "tags", "type": 5}}}), current)
        self.assertEqual(service_list({"local_tags": [{"service_key": "aa", "name": "tags"}]}), current)

    def test_service_discovery_merges_versions_and_tolerates_malformed_fields(self):
        result = service_list({
            "services_v2": [{"service_key": "aa", "name": "current tags"}, None],
            "services": {"aa": {"name": "legacy tags", "type": "5"}},
            "local_tags": "invalid",
            "tag_repositories": [{"service_key": "bb", "name": "repository"}],
            "local_files": None,
        })
        self.assertEqual(result, [{"service_key": "aa", "name": "current tags", "type": 5},
                                  {"service_key": "bb", "name": "repository", "type": 0}])


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.image = self.root / "image.png"
        create_image(self.image)
        self.url = "/static_gallery/image.png"
        self.fake = FakeHydrus()
        self.bridge = HydrusBridge(lambda: self.root, self.root / "state", self.fake)
        self.bridge.settings.save({"access_key": KEY, "tag_service_key": "1234", "default_tags": ["default:tag"]})

    async def export(self, **kwargs):
        return (await self.bridge.batch("export", {"urls": [self.url], **kwargs}))["items"][0]

    async def test_import_exact_bytes_tags_notes_and_restart_memory(self):
        item = await self.export(tags=["batch:tag"], send_metadata=True)
        self.assertTrue(item["success"])
        self.assertTrue(item["exported"])
        self.assertEqual(item["status"], "imported")
        self.assertIsNotNone(item["last_exported_at"])
        upload = self.fake.calls[0]
        self.assertEqual(upload[1], self.image.read_bytes())
        self.assertEqual(upload[2]["Content-Type"], "application/octet-stream")
        tags = next(call[1] for call in self.fake.calls if call[0] == "/add_tags/add_tags")
        self.assertEqual(tags["service_keys_to_tags"]["1234"], ["default:tag", "batch:tag"])
        self.assertFalse(tags["override_previously_deleted_mappings"])
        notes = next(call[1] for call in self.fake.calls if call[0] == "/add_notes/set_notes")
        self.assertTrue(notes["merge_cleverly"])
        self.assertEqual(notes["conflict_resolution"], 3)
        restarted = HydrusBridge(lambda: self.root, self.root / "state", self.fake)
        self.fake.calls.clear()
        cached = (await restarted.status({"urls": [self.url]}))["items"][0]
        self.assertTrue(cached["exported"])
        self.assertEqual(cached["metadata"]["notes"], {"my note": "keep me"})
        self.assertEqual(self.fake.calls, [])

    async def test_export_service_override_preserves_default_and_prompt_tags_stay_separate(self):
        item = await self.export(tag_service_key="abcd", tags=["positive_prompt:blue sky", "negative_prompt:blurry"], send_metadata=False)
        self.assertTrue(item["success"])
        tag_call = next(call[1] for call in self.fake.calls if call[0] == "/add_tags/add_tags")
        self.assertEqual(tag_call["service_keys_to_tags"], {"abcd": ["default:tag", "positive_prompt:blue sky", "negative_prompt:blurry"]})
        self.assertEqual(self.bridge.settings.load()["tag_service_key"], "1234")
        self.assertFalse(any(call[0] == "/add_notes/set_notes" for call in self.fake.calls))
        self.fake.calls.clear()
        await self.export()
        tag_call = next(call[1] for call in self.fake.calls if call[0] == "/add_tags/add_tags")
        self.assertEqual(list(tag_call["service_keys_to_tags"]), ["1234"])

    async def test_invalid_export_service_rejected_before_import(self):
        with self.assertRaises(HydrusError):
            await self.export(tag_service_key="invalid-service")
        self.assertEqual(self.fake.calls, [])

    async def test_content_memory_survives_move_but_not_changed_bytes_or_target(self):
        await self.export()
        moved = self.root / "moved.png"
        self.image.rename(moved)
        moved_url = "/static_gallery/moved.png"
        item = (await self.bridge.status({"urls": [moved_url]}))["items"][0]
        self.assertTrue(item["exported"])
        self.bridge.settings.save({"url": "http://127.0.0.1:45870"})
        self.assertFalse((await self.bridge.status({"urls": [moved_url]}))["items"][0]["exported"])
        self.bridge.settings.save({"url": "http://127.0.0.1:45869"})
        create_image(moved, "blue")
        self.assertFalse((await self.bridge.status({"urls": [moved_url]}))["items"][0]["exported"])

    async def test_partial_failures_preserve_success_and_retry(self):
        self.fake.fail_tags = self.fake.fail_notes = self.fake.fail_metadata = True
        item = await self.export(send_metadata=True)
        self.assertTrue(item["success"])
        self.assertTrue(item["exported"])
        self.assertEqual(len(item["warnings"]), 3)
        cached = (await self.bridge.status({"urls": [self.url]}))["items"][0]
        self.assertTrue(cached["exported"])
        self.fake.fail_tags = self.fake.fail_notes = self.fake.fail_metadata = False
        self.fake.import_status = 2
        item = await self.export(send_metadata=True)
        self.assertEqual(item["status"], "already_present")
        self.assertEqual(item["warnings"], [])
        self.assertEqual(len([call for call in self.fake.calls if call[0] == "/add_files/add_file"]), 2)

    async def test_import_failure_statuses_never_mark_exported_or_add_tags(self):
        for status in (3, 4, 7, 99):
            with self.subTest(status=status):
                self.fake.import_status = status
                self.fake.calls.clear()
                item = await self.export(send_metadata=True)
                self.assertFalse(item["success"])
                self.assertFalse(item["exported"])
                self.assertIsNone(item["last_exported_at"])
                self.assertEqual(len(self.fake.calls), 1)

    async def test_refresh_tracks_deletion_and_missing_without_losing_history(self):
        exported = await self.export()
        for mode in ("deleted", "missing", "nonlocal"):
            self.fake.metadata_mode = mode
            result = (await self.bridge.batch("refresh", {"urls": [self.url]}))["items"][0]
            self.assertTrue(result["success"])
            self.assertTrue(result["exported"])
            self.assertFalse(result["current_present"])
            self.assertEqual(result["status"], "deleted" if mode == "deleted" else "missing")
            self.assertEqual(result["last_exported_at"], exported["last_exported_at"])
            self.assertIsNotNone(result["metadata"])

    async def test_offline_refresh_keeps_snapshot_and_last_check(self):
        exported = await self.export()
        self.fake.fail_metadata = True
        result = (await self.bridge.batch("refresh", {"urls": [self.url]}))["items"][0]
        self.assertFalse(result["success"])
        self.assertEqual(result["metadata"], exported["metadata"])
        self.assertEqual(result["last_checked_at"], exported["last_checked_at"])
        self.assertTrue(result["exported"])

    async def test_refresh_discovers_existing_image_without_claiming_export_time(self):
        result = (await self.bridge.batch("refresh", {"urls": [self.url]}))["items"][0]
        self.assertTrue(result["exported"])
        self.assertIsNone(result["last_exported_at"])
        self.assertEqual(result["status"], "present")

    async def test_batch_handles_missing_item_and_limits(self):
        result = await self.bridge.batch("export", {"urls": ["/static_gallery/gone.png", self.url]})
        self.assertEqual(result["summary"]["succeeded"], 1)
        self.assertEqual(result["summary"]["failed"], 1)
        with self.assertRaises(HydrusError):
            await self.bridge.status({"urls": [self.url] * 201})


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = web.Application()
        self.requests = []

        async def chunked(request):
            self.requests.append(request)
            response = web.StreamResponse(headers={"Content-Type": "application/json"})
            await response.prepare(request)
            await response.write(b'{"metadata":')
            await asyncio.sleep(0.01)
            await response.write(b'[],"services_v2":[]}')
            await response.write_eof()
            return response

        async def denied(request):
            return web.Response(status=403, text="sensitive upstream " + KEY)

        async def redirect(request):
            raise web.HTTPFound("/leaked")

        async def leaked(request):
            self.fail("Redirect was followed with the Hydrus access key.")

        async def upload(request):
            raw = await request.read()
            self.requests.append((dict(request.headers), raw))
            return web.json_response({"status": 1, "hash": hashlib.sha256(raw).hexdigest()})

        self.app.router.add_get("/chunked", chunked)
        self.app.router.add_get("/denied", denied)
        self.app.router.add_get("/redirect", redirect)
        self.app.router.add_get("/leaked", leaked)
        self.app.router.add_post("/add_files/add_file", upload)
        self.server = TestServer(self.app)
        await self.server.start_server()
        self.addAsyncCleanup(self.server.close)
        self.settings = HydrusSettings(self.root).draft({"url": str(self.server.make_url("/")).rstrip("/"), "access_key": KEY})

    async def test_chunked_json_waits_for_eof(self):
        async with HydrusClient(self.settings) as client:
            result = await client.request("GET", "/chunked")
        self.assertEqual(result, {"metadata": [], "services_v2": []})
        self.assertEqual(self.requests[0].headers["Hydrus-Client-API-Access-Key"], KEY)

    async def test_upstream_errors_never_echo_secrets(self):
        async with HydrusClient(self.settings) as client:
            with self.assertRaises(HydrusError) as caught:
                await client.request("GET", "/denied")
        self.assertNotIn(KEY, str(caught.exception))
        self.assertIn("permissions", str(caught.exception))

    async def test_redirect_not_followed(self):
        async with HydrusClient(self.settings) as client:
            with self.assertRaises(HydrusError) as caught:
                await client.request("GET", "/redirect")
        self.assertIn("redirect", str(caught.exception).lower())

    async def test_upload_transport_sends_file_bytes_not_shared_path(self):
        path = self.root / "sample.png"
        create_image(path)
        stream, digest, _, _ = image_snapshot(path)
        try:
            async with HydrusClient(self.settings) as client:
                result = await client.request("POST", "/add_files/add_file", data=stream,
                                              headers={"Content-Type": "application/octet-stream"})
        finally:
            stream.close()
        self.assertEqual(result["hash"], digest)
        self.assertEqual(self.requests[0][1], path.read_bytes())
        self.assertEqual(self.requests[0][0]["Content-Type"], "application/octet-stream")


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        app = web.Application()
        routes = web.RouteTableDef()
        self.bridge = register_hydrus_routes(routes, lambda: self.root, self.root / "state")
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def test_settings_routes_mask_keys_and_reject_cross_origin(self):
        response = await self.client.post("/Gallery/hydrus/settings", json={"access_key": KEY})
        self.assertEqual(response.status, 200)
        self.assertNotIn(KEY, await response.text())
        response = await self.client.get("/Gallery/hydrus/settings")
        body = await response.json()
        self.assertTrue(body["has_access_key"])
        self.assertNotIn("access_key", body)
        response = await self.client.post("/Gallery/hydrus/settings", json={"clear_access_key": True},
                                          headers={"Origin": "https://untrusted.example"})
        self.assertEqual(response.status, 403)
        self.assertEqual(self.bridge.settings.load()["access_key"], KEY)

    async def test_invalid_json_and_oversized_batch(self):
        response = await self.client.post("/Gallery/hydrus/settings", data="not json")
        self.assertEqual(response.status, 400)
        response = await self.client.post("/Gallery/hydrus/status", json={"urls": ["x"] * 201})
        self.assertEqual(response.status, 400)
        self.assertIn("200", (await response.json())["error"])


if __name__ == "__main__":
    unittest.main()

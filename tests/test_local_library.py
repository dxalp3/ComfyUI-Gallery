import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_library import organize, prompts, register_library_routes, move_no_replace


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'output'
        self.root.mkdir()
        self.path = self.root / 'literal %20 # image.png'
        self.path.write_bytes(b'original bytes')
        os.utime(self.path, (time.time() - 10, time.time() - 10))
        self.folders = {'output': {self.path.name: {'name': self.path.name, 'url': '/static_gallery/' + self.path.name, 'type': 'image', 'metadata': {'positive': 'blue sky, mountain', 'negative': 'watermark'}}}}
        self.settings = {'routingRules': [{'terms': ['BLUE SKY'], 'folder': 'landscapes', 'field': 'positive'}]}

    def test_preview_then_move_preserves_bytes_and_terminal_destination(self):
        rows = organize(self.root, self.folders, self.settings, self.root)
        self.assertEqual(len(rows), 1)
        self.assertTrue(self.path.exists())
        rows = organize(self.root, self.folders, self.settings, self.root, True)
        self.assertTrue(rows[0]['moved'])
        target = self.root / 'landscapes' / self.path.name
        self.assertEqual(target.read_bytes(), b'original bytes')
        self.assertFalse(self.path.exists())
        self.assertEqual(organize(self.root, self.folders, self.settings, self.root, True), [])

    def test_no_overwrite_and_never_move_remote_or_video(self):
        target = self.root / 'landscapes' / self.path.name
        target.parent.mkdir()
        target.write_bytes(b'existing')
        rows = organize(self.root, self.folders, self.settings, self.root, True)
        self.assertIn('error', rows[0])
        self.assertEqual(target.read_bytes(), b'existing')
        self.assertTrue(self.path.exists())
        self.folders['output'][self.path.name]['type'] = 'media'
        self.assertEqual(organize(self.root, self.folders, self.settings, self.root, True), [])

    def test_rules_any_all_negative_first_match_and_saved_extra_root(self):
        extra = self.root.parent / 'extra'
        self.settings['extraFolders'] = [str(extra)]
        rule = self.settings['routingRules'][0]
        rule.update(terms=['not present', 'watermark'], field='negative', match='all', destinationRoot=str(extra))
        self.assertEqual(organize(self.root, self.folders, self.settings, self.root), [])
        rule['match'] = 'any'
        self.settings['routingRules'].append({'terms': ['sky'], 'folder': 'second'})
        result = organize(self.root, self.folders, self.settings, self.root, True)
        self.assertTrue(result[0]['moved'])
        self.assertEqual((extra / 'landscapes' / self.path.name).read_bytes(), b'original bytes')
        self.assertEqual(self.folders, {})

    def test_escape_and_unregistered_destination_rejected(self):
        rule = self.settings['routingRules'][0]
        rule['folder'] = '../escape'
        with self.assertRaises(ValueError): organize(self.root, self.folders, self.settings, self.root, True)
        rule.update(folder='safe', destinationRoot=str(self.root.parent / 'not-saved'))
        with self.assertRaises(ValueError): organize(self.root, self.folders, self.settings, self.root, True)
        self.assertTrue(self.path.exists())

    def test_new_file_deferred_and_failed_copy_keeps_original(self):
        os.utime(self.path, None)
        self.assertIn('waiting', organize(self.root, self.folders, self.settings, self.root, True)[0]['error'])
        target = self.root / 'target.png'
        with patch('local_library.shutil.copyfileobj', side_effect=OSError('disk full')):
            with self.assertRaises(OSError): move_no_replace(self.path, target)
        self.assertTrue(self.path.exists())
        self.assertFalse(target.exists())

    def test_scanner_auto_routes_only_when_enabled_and_preview_scan_is_read_only(self):
        import importlib.util
        import types
        import local_library
        package = types.ModuleType('local_scan_qa'); package.__path__ = [str(Path(__file__).resolve().parents[1])]
        metadata = types.ModuleType('local_scan_qa.metadata_extractor')
        metadata.buildMetadata = lambda path: (None, None, {'positive': 'blue sky'})
        modules = {'local_scan_qa': package, 'local_scan_qa.metadata_extractor': metadata, 'local_scan_qa.local_library': local_library}
        with patch.dict(sys.modules, modules):
            spec = importlib.util.spec_from_file_location('local_scan_qa.folder_scanner', Path(__file__).resolve().parents[1] / 'folder_scanner.py')
            scanner = importlib.util.module_from_spec(spec); spec.loader.exec_module(scanner)
            local_library.configure_library(lambda: {**self.settings, 'relativePath': str(self.root), 'autoOrganize': True}, lambda: self.root)
            try:
                scanner._scan_for_images(str(self.root), 'output', True, organize_files=False)
                self.assertTrue(self.path.exists())
                folders, changed = scanner._scan_for_images(str(self.root), 'output', True)
                self.assertTrue(changed)
                self.assertIn('output/landscapes', folders)
                self.assertFalse(self.path.exists())
            finally: local_library.configure_library(lambda: {}, lambda: Path('.'))

    def test_prompt_prefix_connections_and_polarity(self):
        data = {'prompt': {'1': {'inputs': {'positive': ['2', 0], 'negative': ['3', 0]}}, '2': {'inputs': {'text': ['4', 0], 'clip': ['5', 0]}}, '3': {'inputs': {'text': 'watermark'}}, '4': {'class_type': 'PromptLibrary', 'inputs': {'prefix': 'blue sky, mountain'}}, '5': {'inputs': {'ckpt_name': 'not a prompt'}}}}
        self.assertEqual(prompts(data), {'positive': 'blue sky, mountain', 'negative': 'watermark'})


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'image.png'
        self.path.write_bytes(b'preserve')
        routes = web.RouteTableDef()
        register_library_routes(routes, lambda: self.root, lambda: {}, lambda: self.root, lambda root: {})
        app = web.Application(); app.add_routes(routes)
        self.client = TestClient(TestServer(app)); await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def test_delete_confirms_root_checks_origin_and_exact_path(self):
        for body, status in [({'root': str(self.root / 'wrong'), 'image_path': '/static_gallery/image.png'}, 409), ({'image_path': '/static_gallery/../outside.png'}, 400), ({'image_path': 'https://hydrus/file'}, 400)]:
            result = await self.client.post('/Gallery/delete', json=body)
            self.assertEqual(result.status, status)
            self.assertTrue(self.path.exists())
        result = await self.client.post('/Gallery/delete', json={'image_path': '/static_gallery/image.png'}, headers={'Origin': 'https://untrusted.example'})
        self.assertEqual(result.status, 403)
        self.assertTrue(self.path.exists())
        result = await self.client.post('/Gallery/delete', json={'root': str(self.root), 'image_path': '/static_gallery/image.png'})
        self.assertEqual(result.status, 200)
        self.assertFalse(self.path.exists())

    async def test_preview_endpoint_does_not_apply(self):
        result = await self.client.post('/Gallery/organize', json={'root': str(self.root), 'apply': False, 'rules': []})
        self.assertEqual(result.status, 200)
        self.assertEqual(await result.json(), {'items': []})
        self.assertTrue(self.path.exists())


if __name__ == '__main__': unittest.main()

import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hydrus import HydrusError, register_hydrus_routes, save_input_image


class BrowserTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.input = self.root / 'input'
        self.input.mkdir()
        buffer = io.BytesIO()
        Image.new('RGB', (16, 12), 'purple').save(buffer, 'PNG')
        self.original = buffer.getvalue()
        self.digest = hashlib.sha256(self.original).hexdigest()
        self.calls = []
        self.page_mode = 'nested'
        self.suggestion_payload = {'tags': [{'value': 'landscape', 'count': 12},
                                            {'value': 'landscape:mountain', 'count': 5}]}
        self.download_status = 200
        self.search_status = 200
        self.search_payload = {'file_ids': [12, 13]}
        self.services_status = 200
        self.services_payload = {'services': {'c6f63616c2074616773': {'name': 'my tags', 'type': 5}}}
        self.record = {'hash': self.digest, 'file_id': 12, 'mime': 'image/png', 'is_local': True,
                       'width': 16, 'height': 12, 'is_trashed': False}

        async def upstream(request):
            self.assertEqual(request.headers.get('Hydrus-Client-API-Access-Key'), 'ab' * 32)
            self.calls.append((request.path, dict(request.query)))
            if request.path == '/verify_access_key':
                return web.json_response({'permits_everything': True, 'basic_permissions': [1, 2, 3, 4, 7]})
            if request.path == '/get_services':
                if self.services_status != 200:
                    return web.Response(status=self.services_status, text='private: ' + 'ab' * 32)
                return web.json_response(self.services_payload)
            if request.path == '/add_tags/search_tags':
                return web.json_response(self.suggestion_payload)
            if request.path == '/get_files/search_files':
                if self.search_status != 200:
                    return web.Response(status=self.search_status, text='private: ' + 'ab' * 32)
                # Hydrus's parser does not recognise bare "bmp". The previous
                # mandatory list failed every search; broad aliases support the
                # client's available formats, including AVIF/JXL.
                predicates = json.loads(request.query.get('tags', '[]'))
                for predicate in predicates:
                    if isinstance(predicate, str) and predicate.startswith('system:filetype'):
                        formats = [part.strip() for part in predicate.split('=', 1)[1].split(',')]
                        if any(value not in {'image', 'animation'} for value in formats):
                            return web.Response(status=400, text='Could not parse filetype predicate')
                return web.json_response(self.search_payload)
            if request.path == '/get_files/file_metadata':
                # Mixed video and image results verify image-only filtering.
                return web.json_response({'metadata': [dict(self.record, file_id=13, mime='video/mp4'), self.record]})
            if request.path == '/manage_pages/get_pages':
                return web.json_response({'pages': {'pages': [{'name': 'References', 'page_key': 'cd' * 32, 'is_media_page': True}]}})
            if request.path == '/manage_pages/get_page_info':
                media = {'hash_ids': [12, 13]}
                return web.json_response({'page_info': {'name': 'References', **({'media': media} if self.page_mode == 'nested' else {})}, **({'media': media} if self.page_mode == 'root' else {})})
            if request.path in ('/get_files/file', '/get_files/thumbnail'):
                if self.download_status != 200:
                    return web.Response(status=self.download_status, text='private upstream error: ' + 'ab' * 32)
                return web.Response(body=self.original, content_type='image/png')
            return web.Response(status=404)

        remote = web.Application()
        remote.router.add_route('*', '/{path:.*}', upstream)
        self.remote = TestServer(remote)
        await self.remote.start_server()
        self.addAsyncCleanup(self.remote.close)
        app = web.Application()
        routes = web.RouteTableDef()
        self.bridge = register_hydrus_routes(routes, lambda: str(self.root), storage_dir=self.root / 'state', get_input_root=lambda: str(self.input))
        self.bridge.settings.save({'url': str(self.remote.make_url('')).rstrip('/'), 'access_key': 'ab' * 32})
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def post(self, endpoint, data):
        response = await self.client.post('/Gallery/hydrus/' + endpoint, json=data)
        self.assertEqual(response.status, 200, await response.text())
        return await response.json()

    async def test_search_filters_images_and_bounds_query(self):
        result = await self.post('search', {'tags': ['landscape', '-portrait'], 'limit': 10})
        self.assertEqual([item['hash'] for item in result['items']], [self.digest])
        params = next(query for endpoint, query in self.calls if endpoint.endswith('search_files'))
        self.assertIn('system:limit=10', json.loads(params['tags']))
        self.assertIn('-portrait', json.loads(params['tags']))
        self.assertEqual(params['file_sort_asc'], 'false')
        self.assertEqual(params['return_file_ids'], 'true')
        self.assertIn('system:filetype = image, animation', json.loads(params['tags']))

    async def test_connection_probes_image_search_and_services_independently(self):
        result = await self.post('test', {})
        self.assertTrue(result['ok'])
        self.assertEqual(result['capabilities'], {'search': {'ok': True}, 'services': {'ok': True}})
        self.assertEqual(result['services'][0]['name'], 'my tags')
        query = next(query for path, query in self.calls if path.endswith('search_files'))
        self.assertEqual(json.loads(query['tags']), ['system:filetype = image, animation', 'system:limit=1'])
        self.assertFalse(any(path.endswith('file_metadata') for path, _ in self.calls))

    async def test_connection_reports_failed_search_without_hiding_working_services(self):
        for status in (400, 403):
            self.search_status = status
            result = await self.post('test', {})
            self.assertTrue(result['ok'])
            self.assertFalse(result['capabilities']['search']['ok'])
            self.assertTrue(result['capabilities']['services']['ok'])
            self.assertIn('/get_files/search_files', result['capabilities']['search']['error'])
            self.assertTrue(any('Image search is unavailable' in warning for warning in result['warnings']))
            self.assertNotIn('ab' * 32, json.dumps(result))

    async def test_connection_reports_failed_services_without_hiding_working_search(self):
        self.services_status = 403
        result = await self.post('test', {})
        self.assertFalse(result['capabilities']['services']['ok'])
        self.assertTrue(result['capabilities']['search']['ok'])
        self.assertEqual(result['services'], [])
        self.assertNotIn('ab' * 32, json.dumps(result))

    async def test_services_can_be_loaded_without_test_or_settings_save(self):
        before = self.bridge.settings.load()
        result = await self.post('services', {'profile': 'draft only'})
        self.assertEqual(result['services'], [{'service_key': 'c6f63616c2074616773', 'name': 'my tags', 'type': 5}])
        self.assertEqual(self.calls, [('/get_services', {})])
        self.assertEqual(self.bridge.settings.load(), before)

    async def test_search_rejection_identifies_endpoint_and_hides_private_upstream_body(self):
        self.search_status = 400
        response = await self.client.post('/Gallery/hydrus/search', json={})
        self.assertEqual(response.status, 400)
        body = await response.json()
        self.assertIn('/get_files/search_files', body['error'])
        self.assertNotIn('ab' * 32, json.dumps(body))

    async def test_malformed_search_response_is_not_reported_as_empty_results(self):
        for payload in ({}, {'file_ids': None}, {'file_ids': [True]}, {'file_ids': ['12']}):
            self.search_payload = payload
            response = await self.client.post('/Gallery/hydrus/search', json={})
            self.assertEqual(response.status, 400)
            self.assertIn('invalid file IDs', (await response.json())['error'])

    async def test_or_search_keeps_exclusions_and_system_filters_outside_group(self):
        await self.post('search', {'tags': ['landscape', 'portrait', '-low quality',
                                          'system:width > 1000', 'landscape', 'system:limit=99999'],
                                   'match': 'any', 'limit': 25})
        query = next(query for endpoint, query in self.calls if endpoint.endswith('search_files'))
        tags = json.loads(query['tags'])
        self.assertIn(['landscape', 'portrait'], tags)
        self.assertIn('-low quality', tags)
        self.assertIn('system:width > 1000', tags)
        self.assertIn('system:limit=25', tags)
        self.assertNotIn('system:limit=99999', tags)
        self.assertTrue(any(isinstance(tag, str) and tag.startswith('system:filetype') for tag in tags))

    async def test_and_search_and_or_without_alternatives_have_no_nested_group(self):
        for match, tags in [('all', ['landscape', 'portrait']), ('any', ['-portrait', 'system:inbox']),
                            ('any', ['landscape'])]:
            self.calls.clear()
            await self.post('search', {'tags': tags, 'match': match})
            query = next(query for endpoint, query in self.calls if endpoint.endswith('search_files'))
            predicates = json.loads(query['tags'])
            self.assertTrue(all(isinstance(tag, str) for tag in predicates))
            self.assertTrue(set(tags).issubset(predicates))
        response = await self.client.post('/Gallery/hydrus/search', json={'match': 'unknown'})
        self.assertEqual(response.status, 400)

    async def test_tag_recommendations_use_display_tags_and_preserve_exclusion_query(self):
        result = await self.post('suggest', {'query': ' -land ', 'limit': 1})
        self.assertEqual(result, {'tags': [{'value': 'landscape', 'count': 12}], 'has_more': True})
        params = next(query for endpoint, query in self.calls if endpoint.endswith('search_tags'))
        self.assertEqual(params, {'search': '-land', 'tag_display_type': 'display'})
        self.assertNotIn('ab' * 32, json.dumps(result))

    async def test_tag_recommendations_filter_malformed_entries_and_deduplicate(self):
        self.suggestion_payload = {'tags': [None, 'not a tag object', {'value': ''}, {'value': 9},
                                           {'value': 'a' * 1025}, {'value': ' tree ', 'count': 4, 'secret': 'ab' * 32},
                                           {'value': 'tree', 'count': 7}, {'value': 'forest', 'count': -4},
                                           {'value': 'woods', 'count': True}]}
        result = await self.post('suggest', {'query': 't'})
        self.assertEqual(result, {'tags': [{'value': 'tree', 'count': 4}, {'value': 'forest'},
                                          {'value': 'woods'}], 'has_more': False})

    async def test_export_recommendations_use_selected_service_and_validate_before_calling(self):
        await self.post('suggest', {'query': 'land', 'tag_service_key': 'cd' * 32})
        self.assertEqual(self.calls[-1][1]['tag_service_key'], 'cd' * 32)
        self.calls.clear()
        for service in (12, None, 'not-a-key', 'f' * 257):
            response = await self.client.post('/Gallery/hydrus/suggest', json={'query': 'x', 'tag_service_key': service})
            self.assertEqual(response.status, 400)
        self.assertEqual(self.calls, [])

    async def test_tag_recommendations_validate_bounds_and_skip_empty_queries(self):
        for query in ('', '   ', '-'):
            self.assertEqual(await self.post('suggest', {'query': query}), {'tags': [], 'has_more': False})
        self.assertEqual(self.calls, [])
        for data in ({'query': 7}, {'query': 'x' * 1025}, {'query': 'x', 'limit': 0},
                     {'query': 'x', 'limit': 51}, {'query': 'x', 'limit': True}):
            response = await self.client.post('/Gallery/hydrus/suggest', json=data)
            self.assertEqual(response.status, 400)
        self.assertEqual(self.calls, [])
        self.suggestion_payload = {'tags': 'private invalid data ' + 'ab' * 32}
        response = await self.client.post('/Gallery/hydrus/suggest', json={'query': 'x'})
        self.assertEqual(response.status, 400)
        self.assertNotIn('ab' * 32, await response.text())

    async def test_pages_and_page_media_versions(self):
        pages = await self.post('pages', {})
        self.assertEqual(pages['pages']['pages'][0]['name'], 'References')
        for mode in ('nested', 'root'):
            self.page_mode = mode
            result = await self.post('page', {'page_key': 'cd' * 32, 'limit': 1})
            self.assertEqual(result['total'], 2)
            self.assertEqual(result['items'][0]['hash'], self.digest)
        self.assertTrue(all(query['simple'] == 'false' for path, query in self.calls if path.endswith('get_page_info')))

    async def test_copy_original_to_input_is_reusable_and_verified(self):
        first = await self.post('import', {'hash': self.digest})
        second = await self.post('import', {'hash': self.digest})
        self.assertEqual(first, second)
        self.assertEqual(first['input_name'], 'hydrus/' + self.digest + '.png')
        self.assertEqual((self.input / first['input_name']).read_bytes(), self.original)
        self.assertNotIn('ab' * 32, json.dumps(first))

    async def test_thumbnail_proxy_and_bad_hash(self):
        response = await self.client.get('/Gallery/hydrus/thumbnail', params={'hash': self.digest})
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.read(), self.original)
        self.assertEqual(response.headers['Content-Type'], 'image/png')
        response = await self.client.post('/Gallery/hydrus/import', json={'hash': '../evil'})
        self.assertEqual(response.status, 400)

    async def test_download_hash_mismatch_never_saved(self):
        response = await self.client.post('/Gallery/hydrus/import', json={'hash': 'f' * 64})
        self.assertEqual(response.status, 400)
        self.assertEqual(list(self.input.iterdir()), [])

    async def test_original_download_is_authenticated_verified_attachment_without_input_copy(self):
        response = await self.client.get('/Gallery/hydrus/download', params={'hash': self.digest.upper()})
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.read(), self.original)
        self.assertEqual(response.headers['Content-Disposition'], 'attachment; filename="' + self.digest + '.png"')
        self.assertEqual(response.headers['Content-Type'], 'image/png')
        self.assertEqual(response.headers['Content-Length'], str(len(self.original)))
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        self.assertNotIn('ab' * 32, str(response.headers))
        self.assertEqual(self.calls, [('/get_files/file', {'hash': self.digest})])
        self.assertEqual(list(self.input.iterdir()), [])

    async def test_original_download_rejects_invalid_hash_mismatch_and_hides_upstream_errors(self):
        response = await self.client.get('/Gallery/hydrus/download', params={'hash': '../bad.png'})
        self.assertEqual(response.status, 400)
        self.assertEqual(self.calls, [])
        response = await self.client.get('/Gallery/hydrus/download', params={'hash': 'f' * 64})
        self.assertEqual(response.status, 400)
        self.assertNotIn('Content-Disposition', response.headers)
        self.assertIn('hash does not match', await response.text())
        self.download_status = 403
        response = await self.client.get('/Gallery/hydrus/download', params={'hash': self.digest})
        self.assertEqual(response.status, 400)
        self.assertNotIn('ab' * 32, await response.text())
        self.assertEqual(list(self.input.iterdir()), [])

    async def test_original_download_preserves_formats_unknown_to_pillow(self):
        self.original = b'original format unsupported by this Pillow installation'
        digest = hashlib.sha256(self.original).hexdigest()
        response = await self.client.get('/Gallery/hydrus/download', params={'hash': digest})
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.read(), self.original)
        self.assertEqual(response.headers['Content-Disposition'], 'attachment; filename="' + digest + '.bin"')
        self.assertEqual(response.headers['Content-Type'], 'application/octet-stream')

    async def test_input_does_not_overwrite_other_content(self):
        (self.input / 'hydrus').mkdir()
        destination = self.input / 'hydrus' / (self.digest + '.png')
        destination.write_bytes(b'preserve this')
        with self.assertRaises(HydrusError):
            save_input_image(io.BytesIO(self.original), self.digest, self.input)
        self.assertEqual(destination.read_bytes(), b'preserve this')

    async def test_search_limit_and_cross_origin_import_rejected(self):
        response = await self.client.post('/Gallery/hydrus/search', json={'limit': 9999})
        self.assertEqual(response.status, 400)
        response = await self.client.post('/Gallery/hydrus/import', json={'hash': self.digest}, headers={'Origin': 'https://untrusted.example'})
        self.assertEqual(response.status, 403)

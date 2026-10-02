import asyncio
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hydrus import HydrusBridge, HydrusError
from hydrus_sync import NOTE


class Remote:
    def __init__(self):
        self.records = {}
        self.offline = False
        self.calls = []

    def __call__(self, settings):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def metadata(self, digest):
        if self.offline:
            raise HydrusError('Offline')
        return copy.deepcopy(self.records.get(digest))

    async def request(self, method, endpoint, **kwargs):
        if self.offline:
            raise HydrusError('Offline')
        self.calls.append((endpoint, kwargs))
        if endpoint == '/get_files/search_files':
            return {'file_ids': [r['file_id'] for r in self.records.values()]}
        if endpoint == '/get_files/file_metadata':
            ids = json.loads(kwargs['params']['file_ids'])
            return {'metadata': [copy.deepcopy(r) for r in self.records.values() if r['file_id'] in ids]}
        body = kwargs['json']
        if endpoint == '/add_notes/set_notes':
            self.records[body['hash']]['notes'].update(body['notes'])
        return {}


class SyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.remote = Remote()
        self.bridge = HydrusBridge(lambda: self.temp.name, self.temp.name, self.remote)
        self.bridge.settings.save({'access_key': 'ab' * 32, 'tag_service_key': 'cd' * 32})
        self.settings = self.bridge.settings.load()
        self.digest = 'a' * 64
        self.remote.records[self.digest] = {'hash': self.digest, 'file_id': 1, 'is_local': True, 'mime': 'image/png', 'notes': {}}

    def enqueue(self, text):
        return self.bridge.sync.enqueue(self.settings, self.digest, 'note', {'name': NOTE, 'base': None, 'text': text})

    async def test_offline_restart_reconnect_and_idempotence(self):
        first = self.enqueue('{"positive":"blue hair"}')
        self.assertEqual(first, self.enqueue('{"positive":"blue hair"}'))
        self.remote.offline = True
        await self.bridge.sync.tick()
        self.assertEqual(self.bridge.sync.status(self.settings)['jobs'][0]['state'], 'pending')
        self.bridge = HydrusBridge(lambda: self.temp.name, self.temp.name, self.remote)
        self.remote.offline = False
        await self.bridge.sync.tick()
        self.assertEqual(self.bridge.sync.status(self.settings)['jobs'], [])
        self.assertEqual(self.remote.records[self.digest]['notes'][NOTE], '{"positive":"blue hair"}')
        self.enqueue('{"positive":"blue hair"}')
        await self.bridge.sync.tick()
        self.assertEqual(sum(path == '/add_notes/set_notes' for path, _ in self.remote.calls), 1)

    async def test_conflict_resolution_rechecks_remote_and_keeps_both(self):
        self.remote.records[self.digest]['notes'][NOTE] = 'remote one'
        job = self.enqueue('local')
        await self.bridge.sync.tick()
        self.assertEqual(self.bridge.sync.status(self.settings)['jobs'][0]['state'], 'conflict')
        await self.bridge.sync.resolve(self.settings, job, 'local')
        self.remote.records[self.digest]['notes'][NOTE] = 'remote two'
        await self.bridge.sync.tick()
        self.assertEqual(self.remote.records[self.digest]['notes'][NOTE], 'remote two')
        await self.bridge.sync.resolve(self.settings, job, 'both')
        await self.bridge.sync.tick()
        self.assertEqual(set(self.remote.records[self.digest]['notes'].values()), {'remote two', 'local'})
        self.assertEqual(self.bridge.sync.status(self.settings)['jobs'], [])

    async def test_keep_remote_and_scope_isolation(self):
        self.remote.records[self.digest]['notes'][NOTE] = 'remote'
        job = self.enqueue('local')
        other = dict(self.settings, profile='other')
        self.assertEqual(self.bridge.sync.status(other)['jobs'], [])
        await self.bridge.sync.tick()
        with self.assertRaises(ValueError):
            await self.bridge.sync.resolve(other, job, 'local')
        await self.bridge.sync.resolve(self.settings, job, 'remote')
        self.assertEqual(self.remote.records[self.digest]['notes'][NOTE], 'remote')
        self.assertEqual(self.bridge.sync.status(self.settings)['jobs'], [])

    async def test_local_only_change_uses_last_synced_baseline(self):
        self.enqueue('original')
        await self.bridge.sync.tick()
        self.enqueue('local edit')
        await self.bridge.sync.tick()
        self.assertEqual(self.remote.records[self.digest]['notes'][NOTE], 'local edit')
        self.remote.records[self.digest]['notes'][NOTE] = 'remote edit'
        self.enqueue('second local edit')
        await self.bridge.sync.tick()
        self.assertEqual(self.bridge.sync.status(self.settings)['jobs'][0]['state'], 'conflict')
        self.assertEqual(self.remote.records[self.digest]['notes'][NOTE], 'remote edit')

    async def test_resumable_index_over_200_and_offline_prompt_search(self):
        self.remote.records = {f'{i:064x}': {'hash': f'{i:064x}', 'file_id': i, 'is_local': True, 'mime': 'image/png',
                               'notes': {NOTE: json.dumps({'positive': f'pose_{i}', 'negative': 'blurry'})}} for i in range(1, 252)}
        await self.bridge.sync.tick()
        self.assertEqual(self.bridge.sync.status(self.settings)['processed'], 100)
        self.bridge = HydrusBridge(lambda: self.temp.name, self.temp.name, self.remote)
        await self.bridge.sync.tick()
        await self.bridge.sync.tick()
        status = self.bridge.sync.status(self.settings)
        self.assertEqual(status['indexed'], 251)
        self.assertTrue(status['last_complete'])
        self.remote.offline = True
        result = await self.bridge.browse('search', {'metadata_terms': ['pose_251'], 'metadata_field': 'positive'})
        self.assertEqual([r['file_id'] for r in result['items']], [251])
        self.assertEqual(self.bridge.sync.search(self.settings, 'negative', ['pose_251']), [])
        predicates = json.loads(next(kwargs['params']['tags'] for path, kwargs in self.remote.calls if path.endswith('search_files')))
        self.assertIn('system:has note with name ' + NOTE, predicates)
        self.assertFalse(any('system:limit' in p for p in predicates))

    async def test_tags_remember_original_service_and_do_not_restore_deleted(self):
        self.bridge.sync.enqueue(self.settings, self.digest, 'tags', {'service': 'cd' * 32, 'tags': ['standing']})
        self.bridge.settings.save({'tag_service_key': 'ef' * 32})
        await self.bridge.sync.tick()
        payload = next(kwargs['json'] for path, kwargs in self.remote.calls if path == '/add_tags/add_tags')
        self.assertEqual(payload['service_keys_to_tags'], {'cd' * 32: ['standing']})
        self.assertFalse(payload['override_previously_deleted_mappings'])

    async def test_worker_lifecycle_and_deleted_file(self):
        self.remote.records[self.digest]['is_trashed'] = True
        self.enqueue('local')
        await self.bridge.sync.startup(None)
        for _ in range(100):
            if self.bridge.sync.status(self.settings)['jobs'][0]['error']:
                break
            await asyncio.sleep(.01)
        await self.bridge.sync.cleanup(None)
        self.assertTrue(self.bridge.sync.task.done())
        self.assertFalse(any(path == '/add_notes/set_notes' for path, _ in self.remote.calls))
        self.assertEqual(self.bridge.sync.status(self.settings)['jobs'][0]['state'], 'pending')

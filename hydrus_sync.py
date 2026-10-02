"""Durable, target-scoped metadata outbox and resumable Hydrus note index."""
import asyncio
import hashlib
import json
import random
import time

NOTE = 'ComfyUI Gallery generation metadata'


class HydrusSync:
    def __init__(self, bridge):
        self.bridge = bridge
        self.lock = asyncio.Lock()
        self.wake = asyncio.Event()
        self.task = None
        self.error = None
        self.rescan = False
        with bridge.memory.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS sync_jobs (
                    id INTEGER PRIMARY KEY, target TEXT NOT NULL, hash TEXT NOT NULL,
                    kind TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
                    remote TEXT, error TEXT, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS sync_index (
                    target TEXT NOT NULL, hash TEXT NOT NULL, record TEXT NOT NULL,
                    PRIMARY KEY(target, hash));
                CREATE TABLE IF NOT EXISTS sync_crawl (
                    target TEXT PRIMARY KEY, state TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sync_text (
                    target TEXT NOT NULL, hash TEXT NOT NULL, positive TEXT, negative TEXT,
                    hydrus TEXT, name TEXT, all_text TEXT, PRIMARY KEY(target,hash));
                CREATE TABLE IF NOT EXISTS sync_baseline (
                    target TEXT NOT NULL, hash TEXT NOT NULL, name TEXT NOT NULL, text TEXT,
                    PRIMARY KEY(target,hash,name));
            ''')
            if 'attempted' not in {r[1] for r in db.execute('PRAGMA table_info(sync_jobs)')}:
                db.execute('ALTER TABLE sync_jobs ADD COLUMN attempted REAL NOT NULL DEFAULT 0')
            if 'file_id' not in {r[1] for r in db.execute('PRAGMA table_info(sync_index)')}:
                db.execute('ALTER TABLE sync_index ADD COLUMN file_id INTEGER')
                db.execute("UPDATE sync_index SET file_id=json_extract(record,'$.file_id')")
            db.execute('CREATE INDEX IF NOT EXISTS sync_file_ids ON sync_index(target,file_id)')

    def scope(self, settings):
        # Never persist credentials; rotation within the same profile is supported.
        return settings['url'] + '|' + settings['profile']

    def enqueue(self, settings, digest, kind, payload):
        target = self.scope(settings)
        if kind == 'note':
            with self.bridge.memory.connect() as db:
                baseline = db.execute('SELECT text FROM sync_baseline WHERE target=? AND hash=? AND name=?',
                                      (target, digest, payload['name'])).fetchone()
            if baseline:
                payload = dict(payload, base=baseline[0])
        encoded = json.dumps(payload, ensure_ascii=False)
        if len(encoded.encode()) > 8 * 1024 * 1024:
            raise ValueError('Metadata and conflict baseline exceed the 8 MiB synchronization limit.')
        with self.bridge.memory.connect() as db:
            row = db.execute("SELECT id FROM sync_jobs WHERE target=? AND hash=? AND kind=? AND payload=? AND state IN ('pending','conflict')",
                             (target, digest, kind, encoded)).fetchone()
            if row:
                return row[0]
            job = db.execute('INSERT INTO sync_jobs(target,hash,kind,payload,created) VALUES(?,?,?,?,?)',
                             (target, digest, kind, encoded, time.time())).lastrowid
        self.wake.set()
        return job

    def records(self, settings):
        with self.bridge.memory.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT record FROM sync_index WHERE target=?', (self.scope(settings),))]

    def put_records(self, settings, records):
        with self.bridge.memory.connect() as db:
            db.executemany('INSERT OR REPLACE INTO sync_index(target,hash,record,file_id) VALUES(?,?,?,?)',
                           [(self.scope(settings), r['hash'], json.dumps(r), r.get('file_id')) for r in records])
            for record in records:
                values = search_values(record)
                db.execute('INSERT OR REPLACE INTO sync_text VALUES(?,?,?,?,?,?,?)',
                           (self.scope(settings), record['hash'], *[values[k].lower().replace('_', ' ') for k in ('positive', 'negative', 'hydrus', 'name', 'all_text')]))

    def search(self, settings, field, terms):
        column = 'all_text' if field == 'all' else field
        if column not in ('positive', 'negative', 'hydrus', 'name', 'all_text'):
            raise ValueError('Invalid metadata field.')
        where = ' AND '.join('instr(t.' + column + ',?)>0' for _ in terms) or '1'
        with self.bridge.memory.connect() as db:
            return [json.loads(row[0]) for row in db.execute(
                'SELECT i.record FROM sync_index i JOIN sync_text t ON i.target=t.target AND i.hash=t.hash WHERE i.target=? AND ' + where,
                (self.scope(settings), *[term.lower().replace('_', ' ') for term in terms]))]

    def status(self, settings):
        target = self.scope(settings)
        with self.bridge.memory.connect() as db:
            jobs = [dict(zip(('id', 'hash', 'kind', 'state', 'payload', 'remote', 'error'), row)) for row in db.execute(
                "SELECT id,hash,kind,state,payload,remote,error FROM sync_jobs WHERE target=? AND state!='done' ORDER BY id", (target,))]
            count = db.execute('SELECT count(*) FROM sync_index WHERE target=?', (target,)).fetchone()[0]
            row = db.execute('SELECT state FROM sync_crawl WHERE target=?', (target,)).fetchone()
        for job in jobs:
            job['payload'] = json.loads(job['payload'])
            job['remote'] = json.loads(job['remote']) if job['remote'] else None
        crawl = json.loads(row[0]) if row else {}
        return {'target': target, 'jobs': jobs, 'indexed': count, 'processed': crawl.get('cursor', 0),
                'discovered': len(crawl.get('ids', [])), 'last_complete': crawl.get('completed'),
                'indexing': bool(crawl.get('ids') and crawl.get('cursor', 0) < len(crawl['ids'])),
                'error': self.error, 'running': self.lock.locked()}

    async def resolve(self, settings, job_id, choice):
        async with self.lock:
            with self.bridge.memory.connect() as db:
                if choice == 'cancel':
                    db.execute("UPDATE sync_jobs SET state='done',error=NULL WHERE id=? AND target=?", (job_id, self.scope(settings)))
                    return
                row = db.execute("SELECT payload,remote,hash FROM sync_jobs WHERE id=? AND target=? AND state='conflict'",
                                 (job_id, self.scope(settings))).fetchone()
                if not row or choice not in ('local', 'remote', 'both'):
                    raise ValueError('Choose an existing conflict and a valid resolution.')
                payload, remote = json.loads(row[0]), json.loads(row[1])
                if choice == 'remote':
                    db.execute('INSERT OR REPLACE INTO sync_baseline VALUES(?,?,?,?)',
                               (self.scope(settings), row[2], payload['name'], remote))
                    db.execute("UPDATE sync_jobs SET state='done',error=NULL WHERE id=?", (job_id,))
                else:
                    # Re-check this exact remote version before a replacement.
                    payload['base'] = remote
                    if choice == 'both':
                        payload['name'] = NOTE + ' (gallery ' + hashlib.sha256(payload['text'].encode()).hexdigest()[:12] + ')'
                        payload['base'] = None
                    db.execute("UPDATE sync_jobs SET state='pending',payload=?,error=NULL WHERE id=?", (json.dumps(payload), job_id))
            self.wake.set()

    async def drain(self, settings, client):
        with self.bridge.memory.connect() as db:
            jobs = list(db.execute("SELECT id,hash,kind,payload FROM sync_jobs WHERE target=? AND state='pending' ORDER BY attempted,id LIMIT 32", (self.scope(settings),)))
        failures = []
        for job_id, digest, kind, encoded in jobs:
            payload = json.loads(encoded)
            try:
                with self.bridge.memory.connect() as db:
                    db.execute('UPDATE sync_jobs SET attempted=? WHERE id=?', (time.time(), job_id))
                record = await client.metadata(digest)
                if not record or not record.get('is_local') or record.get('is_trashed') or record.get('is_deleted'):
                    raise ValueError('File is absent or deleted in Hydrus. Restore it there or cancel this pending change.')
                await self.bridge.cache_records([record], settings)
                if kind == 'tags':
                    # Additive operations are idempotent and never resurrect deleted mappings.
                    await client.request('POST', '/add_tags/add_tags', json={'hash': digest,
                        'service_keys_to_tags': {payload['service']: payload['tags']}, 'override_previously_deleted_mappings': False})
                else:
                    remote = record.get('notes', {}).get(payload['name'])
                    if remote != payload['text']:
                        if remote != payload.get('base'):
                            with self.bridge.memory.connect() as db:
                                db.execute("UPDATE sync_jobs SET state='conflict',remote=?,error=NULL WHERE id=?", (json.dumps(remote), job_id))
                            continue
                        await client.request('POST', '/add_notes/set_notes', json={'hash': digest,
                            'notes': {payload['name']: payload['text']}, 'merge_cleverly': False})
                # A retry after a crash repeats the same operation safely.
                updated = await client.metadata(digest)
                if updated:
                    await self.bridge.cache_records([updated], settings)
                with self.bridge.memory.connect() as db:
                    if kind == 'note':
                        db.execute('INSERT OR REPLACE INTO sync_baseline VALUES(?,?,?,?)',
                                   (self.scope(settings), digest, payload['name'], payload['text']))
                    db.execute("UPDATE sync_jobs SET state='done',error=NULL WHERE id=?", (job_id,))
            except asyncio.CancelledError:
                raise
            except Exception as error:
                with self.bridge.memory.connect() as db:
                    db.execute('UPDATE sync_jobs SET error=? WHERE id=?', (str(error), job_id))
                failures.append(str(error))
                if getattr(error, 'transient', False):
                    raise
        return failures

    async def crawl(self, settings, client):
        target = self.scope(settings)
        with self.bridge.memory.connect() as db:
            row = db.execute('SELECT state FROM sync_crawl WHERE target=?', (target,)).fetchone()
        state = json.loads(row[0]) if row else {}
        if not state or state.get('cursor', 0) >= len(state.get('ids', [])):
            if not self.rescan and time.time() - state.get('completed', 0) < 900:
                return
            self.rescan = False
            ids = await self.bridge.search_identifiers(client, {'tags': ['system:has note with name ' + NOTE]}, None)
            # Refresh already linked files too, including files whose note was removed.
            if not state:
                identity = hashlib.sha256((settings['url'] + '\n' + settings['profile']).encode()).hexdigest()
                with self.bridge.memory.connect() as db:
                    old = [json.loads(row[0]) for row in db.execute('SELECT record FROM exports WHERE target=?', (identity,))]
                await asyncio.to_thread(self.put_records, settings, [item['metadata'] for item in old if item.get('metadata') and item.get('current_present')])
            with self.bridge.memory.connect() as db:
                known = [row[0] for row in db.execute('SELECT file_id FROM sync_index WHERE target=? AND file_id IS NOT NULL', (target,))]
            ids = list(dict.fromkeys(ids + known))
            state = {'ids': ids, 'cursor': 0, 'completed': state.get('completed')}
        batch = state['ids'][state['cursor']:state['cursor'] + 100]
        if batch:
            records = await self.bridge.remote_metadata(client, batch)
            await self.bridge.cache_records(records, settings)
            returned = {r['file_id'] for r in records}
            # Remove stale/deleted/inaccessible files only after a successful metadata response.
            with self.bridge.memory.connect() as db:
                known_batch = list(db.execute(
                    'SELECT hash,file_id FROM sync_index WHERE target=? AND file_id IN (' + ','.join('?' for _ in batch) + ')', (target, *batch)))
                for digest, file_id in known_batch:
                    if file_id not in returned:
                        db.execute('DELETE FROM sync_index WHERE target=? AND hash=?', (target, digest))
                        db.execute('DELETE FROM sync_text WHERE target=? AND hash=?', (target, digest))
            state['cursor'] += len(batch)
        if state['cursor'] >= len(state['ids']):
            state['completed'] = time.time()
        with self.bridge.memory.connect() as db:
            db.execute('INSERT OR REPLACE INTO sync_crawl VALUES(?,?)', (target, json.dumps(state)))

    async def tick(self):
        async with self.lock:
            try:
                settings = self.bridge.settings.load()
                if not settings['access_key']:
                    return
                async with self.bridge.client_factory(settings) as client:
                    # Metadata indexing remains available even if a queued write lacks permission.
                    try:
                        failures = await self.drain(settings, client)
                        self.error = failures[0] if failures else None
                    except Exception as error:
                        self.error = str(error)
                    await self.crawl(settings, client)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.error = str(error)

    async def run(self):
        while True:
            self.wake.clear()
            await self.tick()
            try:
                await asyncio.wait_for(self.wake.wait(), timeout=30 if not self.error else 60)
            except asyncio.TimeoutError:
                pass

    async def startup(self, app):
        self.rescan = True
        self.task = asyncio.create_task(self.run())

    async def cleanup(self, app):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass


def search_values(record):
    try:
        from .local_library import prompts
    except ImportError:
        from local_library import prompts
    metadata = []
    for name, note in (record.get('notes') or {}).items():
        if name.startswith(NOTE):
            try:
                parsed = json.loads(note)
                if isinstance(parsed, dict):
                    metadata.append(parsed)
            except (ValueError, TypeError):
                pass
    generated = [prompts(value) for value in metadata]
    tags = []
    for service in record.get('tags', {}).values():
        for key in ('display_tags', 'storage_tags'):
            for status in ('0', '2'):
                tags.extend(service.get(key, {}).get(status, []))
    names = [str(value['fileinfo'].get('filename', '')) for value in metadata if isinstance(value.get('fileinfo'), dict)]
    values = {'positive': '\n'.join(value['positive'] for value in generated), 'negative': '\n'.join(value['negative'] for value in generated), 'hydrus': ', '.join(tags),
              'name': ' '.join(names + [record['hash']])}
    values['all_text'] = ' '.join(values.values())
    return values


def matches(record, field, terms):
    values = search_values(record)
    text = values['all_text' if field == 'all' else field].lower().replace('_', ' ')
    return all(term.lower().replace('_', ' ') in text for term in terms)


def sort_records(records, sort_type, ascending):
    if sort_type == 4:
        random.shuffle(records)
        return
    def imported(record):
        times = [record.get('time_imported') or 0]
        for service in (record.get('file_services', {}).get('current', {}) or {}).values():
            if isinstance(service, dict):
                times.append(service.get('time_imported') or 0)
        return max(times)
    keys = {2: imported, 3: lambda r: r.get('mime', ''), 20: lambda r: r['hash'],
            0: lambda r: r.get('size') or 0, 5: lambda r: r.get('width') or 0,
            6: lambda r: r.get('height') or 0, 1: lambda r: r.get('duration') or 0,
            14: lambda r: r.get('time_modified') or 0}
    records.sort(key=keys.get(sort_type, imported), reverse=not ascending)

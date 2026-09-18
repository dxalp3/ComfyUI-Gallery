"""Server-side Hydrus Client API bridge and persistent, content-addressed memory.

API reference: https://hydrusnetwork.github.io/hydrus/developer_api.html
No ComfyUI imports: the active gallery root is supplied by the server.
"""

import asyncio
import hashlib
import json
import os
import re
import sqlite3
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import aiohttp
from aiohttp import web
from PIL import Image


MAX_BATCH_SIZE = 200
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".jxl"}
# Use Hydrus's broad aliases, including newly supported formats. Bare "bmp" is
# not an accepted alias and made the previous mandatory filetype filter invalid.
HYDRUS_IMAGE_PREDICATE = "system:filetype = image, animation"
DEFAULTS = {
    "url": "http://127.0.0.1:45869",
    "access_key": "",
    "tag_service_key": "",
    "default_tags": [],
    "send_metadata": False,
    "positive_prompt_tags": False,
    "negative_prompt_tags": False,
    "prefix_positive_prompt_tags": True,
    "profile": "main",
    "timeout_seconds": 30,
}


class HydrusError(Exception):
    """An error whose message is safe to return to the browser."""


def now():
    return datetime.now(timezone.utc).isoformat()


def clean_tags(value):
    if not isinstance(value, list) or len(value) > 500:
        raise HydrusError("Tags must be an array of at most 500 strings.")
    if any(not isinstance(tag, str) or len(tag) > 1024 for tag in value):
        raise HydrusError("Each tag must be a string of at most 1024 characters.")
    return list(dict.fromkeys(tag.strip() for tag in value if tag.strip()))


def normalize_url(value):
    if not isinstance(value, str) or len(value) > 2048 or any(ord(c) < 33 for c in value):
        raise HydrusError("Enter a valid HTTP or HTTPS Hydrus URL.")
    try:
        parsed = urlsplit(value)
        port = parsed.port
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.query or parsed.fragment):
            raise ValueError()
        host = parsed.hostname.lower()
        if ":" in host:
            host = "[" + host + "]"
        if port is not None and port != {"http": 80, "https": 443}[parsed.scheme]:
            host += ":" + str(port)
        return urlunsplit((parsed.scheme, host, parsed.path.rstrip("/"), "", ""))
    except ValueError:
        raise HydrusError("Hydrus URL must use HTTP(S), without credentials, query, or fragment.") from None


class HydrusSettings:
    def __init__(self, directory):
        self.path = Path(directory) / "hydrus_settings.json"
        self.lock = threading.RLock()

    def load(self):
        with self.lock:
            result = dict(DEFAULTS)
            try:
                saved = json.loads(self.path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return result
            except (OSError, ValueError):
                raise HydrusError("Cannot read hydrus_settings.json; check the file and its permissions.") from None
            if not isinstance(saved, dict):
                raise HydrusError("hydrus_settings.json must contain an object.")
            result.update({k: v for k, v in saved.items() if k in DEFAULTS})
            return self.validate(result)

    @staticmethod
    def validate(result):
        result = dict(result)
        result["url"] = normalize_url(result["url"])
        for key, limit in (("access_key", 256), ("tag_service_key", 256), ("profile", 128)):
            if not isinstance(result[key], str) or len(result[key]) > limit:
                raise HydrusError("Invalid " + key + ".")
            result[key] = result[key].strip()
        for key in ("access_key", "tag_service_key"):
            if result[key] and not re.fullmatch(r"[0-9a-fA-F]+", result[key]):
                raise HydrusError(key + " must contain hexadecimal characters.")
        if not result["profile"]:
            raise HydrusError("Profile cannot be empty.")
        for key in ("send_metadata", "positive_prompt_tags", "negative_prompt_tags", "prefix_positive_prompt_tags"):
            if type(result[key]) is not bool:
                raise HydrusError(key + " must be true or false.")
        if type(result["timeout_seconds"]) not in (int, float) or not 5 <= result["timeout_seconds"] <= 300:
            raise HydrusError("Timeout must be between 5 and 300 seconds.")
        result["default_tags"] = clean_tags(result["default_tags"])
        return result

    def draft(self, changes):
        if not isinstance(changes, dict):
            raise HydrusError("Settings must be an object.")
        result = self.load()
        for key in DEFAULTS:
            if key in changes and (key != "access_key" or changes[key]):
                result[key] = changes[key]
        if changes.get("clear_access_key") is True:
            result["access_key"] = ""
        return self.validate(result)

    def save(self, changes):
        with self.lock:
            result = self.draft(changes)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                                 prefix=".hydrus-settings-", delete=False) as stream:
                    temporary = Path(stream.name)
                    json.dump(result, stream, ensure_ascii=False, indent=2)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.chmod(temporary, 0o600)
                os.replace(temporary, self.path)
            except OSError:
                raise HydrusError("Cannot save Hydrus settings; check folder permissions.") from None
            finally:
                if temporary and temporary.exists():
                    temporary.unlink()
            return self.public(result)

    @staticmethod
    def public(settings):
        return {**{k: v for k, v in settings.items() if k != "access_key"},
                "has_access_key": bool(settings["access_key"]), "max_batch_size": MAX_BATCH_SIZE}


def target_identity(settings):
    # Credentials can be rotated without forgetting a library's history.
    return hashlib.sha256((settings["url"] + "\n" + settings["profile"]).encode()).hexdigest()


def resolve_image(root, url):
    # Scanner URLs are raw identifiers, not encoded HTTP URLs. Keep literal %/#.
    if not isinstance(url, str) or not url.startswith("/static_gallery/"):
        raise HydrusError("Image must belong to /static_gallery/.")
    relative = url[len("/static_gallery/"):]
    parts = relative.split("/")
    if (not relative or "\\" in relative or ":" in relative or "\x00" in relative
            or any(part in ("", ".", "..") for part in parts)):
        raise HydrusError("Invalid gallery image path.")
    try:
        base = Path(root).resolve(strict=True)
        path = (base / relative).resolve(strict=True)
        path.relative_to(base)
        if not path.is_file():
            raise HydrusError("Gallery image is not a regular file.")
    except FileNotFoundError:
        raise HydrusError("Gallery image no longer exists; reload the gallery.") from None
    except (OSError, ValueError, RuntimeError):
        raise HydrusError("Image is outside the gallery root or is inaccessible.") from None
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HydrusError("Hydrus export currently supports images only.")
    return path


def fingerprint(stat):
    return (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino)


def empty_item(url, digest=None):
    return {"url": url, "hash": digest, "exported": False, "status": "unknown",
            "current_present": None, "last_exported_at": None, "last_checked_at": None, "metadata_checked_at": None,
            "metadata": None, "error": None, "warnings": []}


class HydrusMemory:
    def __init__(self, directory):
        self.path = Path(directory) / "hydrus_memory.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS file_hashes (
                    path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, hash TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS exports (
                    target TEXT NOT NULL, hash TEXT NOT NULL, record TEXT NOT NULL,
                    PRIMARY KEY (target, hash));
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        try:
            with db:
                yield db
        finally:
            db.close()

    def hash_file(self, path):
        before = fingerprint(path.stat())
        key = json.dumps(before)
        with self.connect() as db:
            row = db.execute("SELECT fingerprint, hash FROM file_hashes WHERE path=?", (str(path),)).fetchone()
        if row and row[0] == key:
            return row[1]
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if before != fingerprint(path.stat()):
            raise HydrusError("Image changed while reading; retry when generation is complete.")
        value = digest.hexdigest()
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO file_hashes VALUES (?, ?, ?)", (str(path), key, value))
        return value

    def get(self, target, digest, url):
        with self.connect() as db:
            row = db.execute("SELECT record FROM exports WHERE target=? AND hash=?", (target, digest)).fetchone()
        item = empty_item(url, digest)
        if row:
            item.update(json.loads(row[0]))
        item["url"] = url
        return item

    def put(self, target, item):
        record = {k: v for k, v in item.items() if k not in ("url", "success")}
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO exports VALUES (?, ?, ?)",
                       (target, item["hash"], json.dumps(record, ensure_ascii=False)))


def image_snapshot(path):
    """Immutable upload snapshot; bounded RAM, exact bytes, original metadata intact."""
    snapshot = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
    try:
        before = fingerprint(path.stat())
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
                snapshot.write(chunk)
        if before != fingerprint(path.stat()):
            raise HydrusError("Image changed while reading; retry when generation is complete.")
        snapshot.seek(0)
        with Image.open(snapshot) as image:
            notes = {key: image.info[key] for key in ("prompt", "workflow", "parameters") if key in image.info}
            note = json.dumps(notes, ensure_ascii=False, indent=2, default=str) if notes else None
            image.verify()
        snapshot.seek(0)
        if note and len(note.encode("utf-8")) > 2 * 1024 * 1024:
            note = None
            warning = "Generation metadata exceeds the 2 MiB note limit; original file metadata is preserved."
        else:
            warning = None
        return snapshot, digest.hexdigest(), note, warning
    except Exception:
        snapshot.close()
        raise


def service_list(payload):
    """Accept current services_v2 and both older API service formats."""
    result = {}

    def add(candidates, type_id=None):
        if isinstance(candidates, dict):
            candidates = [{"service_key": key, **value} for key, value in candidates.items()
                          if isinstance(value, dict)]
        if not isinstance(candidates, list):
            return
        for service in candidates:
            if not isinstance(service, dict):
                continue
            key = service.get("service_key")
            if not isinstance(key, str) or not key:
                continue
            normalized = dict(service)
            if normalized.get("type") is None and type_id is not None:
                normalized["type"] = type_id
            if isinstance(normalized.get("type"), str) and normalized["type"].isdigit():
                normalized["type"] = int(normalized["type"])
            # Prefer the modern fields, but fill any missing fields from older
            # objects that some Hydrus versions return alongside services_v2.
            result[key] = {**normalized, **result.get(key, {})}

    for field in ("services_v2", "services"):
        add(payload.get(field))
    for legacy, type_id in (("local_tags", 5), ("tag_repositories", 0), ("local_files", 2)):
        add(payload.get(legacy), type_id)
    return list(result.values())


class HydrusClient:
    def __init__(self, settings):
        self.settings = settings
        self.session = None

    async def __aenter__(self):
        if not self.settings["access_key"]:
            raise HydrusError("Configure a Hydrus Client API access key first.")
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.settings["timeout_seconds"]),
            headers={"Hydrus-Client-API-Access-Key": self.settings["access_key"], "Accept": "application/json"},
            trust_env=False)
        return self

    async def __aexit__(self, *args):
        if self.session:
            await self.session.close()

    async def request(self, method, endpoint, **kwargs):
        try:
            async with self.session.request(method, self.settings["url"] + endpoint,
                                            allow_redirects=False, **kwargs) as response:
                if response.status != 200:
                    messages = {400: "Hydrus rejected the request; check API settings and permissions.",
                                401: "Hydrus access key is missing or invalid.",
                                403: "Hydrus denied access; check this key's permissions (unrestricted file search is needed for metadata).",
                                419: "Hydrus access key has expired or was revoked.",
                                503: "Hydrus is busy or unavailable; retry later."}
                    if 300 <= response.status < 400:
                        raise HydrusError("Hydrus redirected the request. Set the final API URL; redirects are disabled to protect the key.")
                    raise HydrusError(messages.get(response.status, "Hydrus API returned HTTP " + str(response.status) + "."))
                raw = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    raw.extend(chunk)
                    if len(raw) > 16 * 1024 * 1024:
                        raise HydrusError("Hydrus response is too large; use a smaller selection.")
                if not raw:
                    return {}
                try:
                    payload = json.loads(raw)
                except (ValueError, UnicodeError):
                    raise HydrusError("Hydrus returned invalid JSON; check the API URL.") from None
                if not isinstance(payload, dict):
                    raise HydrusError("Hydrus returned an unexpected response.")
                return payload
        except asyncio.TimeoutError:
            raise HydrusError("Hydrus request timed out. An upload may have completed; refresh status or retry safely.") from None
        except aiohttp.ClientError:
            # Never reflect upstream bodies or connector exceptions; they may contain keys.
            raise HydrusError("Cannot connect to Hydrus. Check its API URL, TLS certificate, and that the client is running.") from None

    async def metadata(self, digest):
        result = await self.request("GET", "/get_files/file_metadata", params={
            "hashes": json.dumps([digest]), "create_new_file_ids": "false",
            "include_notes": "true", "include_services_object": "true"})
        records = result.get("metadata")
        if not isinstance(records, list):
            raise HydrusError("Hydrus returned invalid file metadata.")
        record = next((record for record in records if isinstance(record, dict) and record.get("hash") == digest), None)
        if record and record.get("file_id") is not None:
            return {**record, "services_v2": service_list(result)}
        return None

    async def download(self, digest, thumbnail=False):
        """Download through the server; credentials never enter image URLs."""
        stream = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
        limit = (16 if thumbnail else 256) * 1024 * 1024
        try:
            endpoint = "/get_files/thumbnail" if thumbnail else "/get_files/file"
            async with self.session.get(self.settings["url"] + endpoint,
                    params={"hash": digest}, allow_redirects=False) as response:
                if response.status != 200:
                    raise HydrusError("Cannot fetch this Hydrus image (HTTP %s). Check file access permissions and that it is stored locally." % response.status)
                size = 0
                async for chunk in response.content.iter_chunked(1024 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise HydrusError("Hydrus image exceeds the %s MiB download limit." % (limit // 1024 // 1024))
                    stream.write(chunk)
            stream.seek(0)
            return stream
        except (aiohttp.ClientError, asyncio.TimeoutError):
            stream.close()
            raise HydrusError("Cannot download from Hydrus; check the connection and request timeout.") from None
        except BaseException:
            stream.close()
            raise


class HydrusBridge:
    def __init__(self, get_root, storage_dir=None, client_factory=HydrusClient):
        directory = Path(storage_dir) if storage_dir is not None else Path(__file__).parent
        self.get_root = get_root
        self.settings = HydrusSettings(directory)
        self.memory = HydrusMemory(directory)
        self.client_factory = client_factory
        self.operation_lock = asyncio.Lock()

    @staticmethod
    def urls(data):
        urls = data.get("urls")
        if not isinstance(urls, list) or not 1 <= len(urls) <= MAX_BATCH_SIZE:
            raise HydrusError("Select between 1 and " + str(MAX_BATCH_SIZE) + " images per request.")
        if any(not isinstance(url, str) or len(url) > 4096 for url in urls):
            raise HydrusError("Image URLs must be strings of at most 4096 characters.")
        return list(dict.fromkeys(urls))

    async def cached_item(self, root, target, url):
        path = resolve_image(root, url)
        digest = await asyncio.to_thread(self.memory.hash_file, path)
        return path, await asyncio.to_thread(self.memory.get, target, digest, url)

    async def save_item(self, target, item):
        await asyncio.to_thread(self.memory.put, target, item)

    @staticmethod
    def error_item(url, error):
        item = empty_item(url)
        item.update(status="error", error=str(error) if isinstance(error, HydrusError) else "Cannot read this gallery image.", success=False)
        return item

    async def status(self, data):
        settings = self.settings.load()
        target = target_identity(settings)
        root = self.get_root()
        items = []
        for url in self.urls(data):
            try:
                _, item = await self.cached_item(root, target, url)
            except (HydrusError, OSError) as error:
                item = self.error_item(url, error)
            items.append(item)
        return {"items": items}

    async def refresh_item(self, client, target, item):
        metadata = await client.metadata(item["hash"])
        item.update(error=None, last_checked_at=now(), current_present=False)
        if metadata is None:
            item["status"] = "missing"
        else:
            item["metadata"] = metadata
            item["metadata_checked_at"] = item["last_checked_at"]
            deleted = metadata.get("is_deleted") is True or metadata.get("is_trashed") is True
            local = metadata.get("is_local") is True
            item["status"] = "deleted" if deleted else "present" if local else "missing"
            item["current_present"] = local and not deleted
            if local and not deleted:
                item["exported"] = True
        await self.save_item(target, item)

    async def batch(self, action, data):
        urls = self.urls(data)
        settings = self.settings.load()
        # This choice applies only to this export; the saved service is a default.
        if action == "export" and "tag_service_key" in data:
            settings = self.settings.validate({**settings, "tag_service_key": data["tag_service_key"]})
        tags = clean_tags(settings["default_tags"] + clean_tags(data.get("tags", [])))
        send_metadata = data.get("send_metadata", settings["send_metadata"])
        if type(send_metadata) is not bool:
            raise HydrusError("send_metadata must be true or false.")
        target = target_identity(settings)
        root = self.get_root()
        items = []
        async with self.operation_lock:
            async with self.client_factory(settings) as client:
                for url in urls:
                    item = None
                    try:
                        path, item = await self.cached_item(root, target, url)
                        item.update(error=None, warnings=[])
                        if action == "export":
                            await self.export_item(client, target, path, item, settings, tags, send_metadata)
                        else:
                            await self.refresh_item(client, target, item)
                        item["success"] = True
                    except (HydrusError, OSError, ValueError, Image.DecompressionBombError) as error:
                        if item is None:
                            item = self.error_item(url, error)
                        else:
                            item.update(success=False, error=str(error) if isinstance(error, HydrusError) else "Cannot read this gallery image.")
                            # A failure must not erase a previous successful import or snapshot.
                            await self.save_item(target, item)
                    items.append(item)
        return {"items": items, "summary": {"total": len(items),
                "succeeded": sum(item.get("success") is True for item in items),
                "failed": sum(item.get("success") is False for item in items),
                "warnings": sum(bool(item["warnings"]) for item in items)}}

    async def export_item(self, client, target, path, item, settings, tags, send_metadata):
        stream, digest, note, note_warning = await asyncio.to_thread(image_snapshot, path)
        try:
            # A file may change after the status hash was read. Snapshot identity wins.
            if digest != item["hash"]:
                replacement = await asyncio.to_thread(self.memory.get, target, digest, item["url"])
                item.clear()
                item.update(replacement)
            result = await client.request("POST", "/add_files/add_file", data=stream,
                                          headers={"Content-Type": "application/octet-stream"})
        finally:
            stream.close()
        status = result.get("status")
        if status not in (1, 2):
            item["status"] = "deleted" if status == 3 else "error"
            item["current_present"] = False if status == 3 else item["current_present"]
            raise HydrusError({3: "Hydrus previously deleted this image; restore it in Hydrus if desired.",
                               4: "Hydrus failed to import this image.",
                               7: "Hydrus vetoed this image; check its Client API import options."}.get(status,
                               "Hydrus returned an unknown import status."))
        if result.get("hash") and result["hash"].lower() != digest:
            raise HydrusError("Hydrus returned a different file hash; refresh before retrying.")
        item.update(exported=True, status="imported" if status == 1 else "already_present",
                    current_present=True, last_exported_at=now(), error=None)
        # Commit before optional operations so their failure never loses import memory.
        await self.save_item(target, item)
        if tags:
            if not settings["tag_service_key"]:
                item["warnings"].append("Image imported, but tags were not sent: choose a tag service in Hydrus settings.")
            else:
                try:
                    await client.request("POST", "/add_tags/add_tags", json={"hash": digest,
                        "service_keys_to_tags": {settings["tag_service_key"]: tags},
                        "override_previously_deleted_mappings": False})
                except HydrusError as error:
                    item["warnings"].append("Image imported; tags failed: " + str(error))
        if send_metadata:
            if note_warning:
                item["warnings"].append(note_warning)
            if note:
                try:
                    await client.request("POST", "/add_notes/set_notes", json={"hash": digest,
                        "notes": {"ComfyUI Gallery generation metadata": note},
                        "merge_cleverly": True, "extend_existing_note_if_possible": False, "conflict_resolution": 3})
                except HydrusError as error:
                    item["warnings"].append("Image imported; generation note failed: " + str(error))
        try:
            import_status = item["status"]
            await self.refresh_item(client, target, item)
            if item["status"] == "present":
                item["status"] = import_status
        except HydrusError as error:
            item["warnings"].append("Image imported; metadata refresh failed: " + str(error))
        await self.save_item(target, item)

    async def services(self, data):
        """Discover services independently of testing or saving a connection."""
        async with self.client_factory(self.settings.draft(data)) as client:
            try:
                return {"services": service_list(await client.request("GET", "/get_services"))}
            except HydrusError as error:
                raise HydrusError("Hydrus services (/get_services): " + str(error)) from None

    async def test(self, data):
        settings = self.settings.draft(data)
        services, capabilities, warnings = [], {}, []
        async with self.client_factory(settings) as client:
            permissions = await client.request("GET", "/verify_access_key")
            try:
                services = service_list(await client.request("GET", "/get_services"))
                capabilities["services"] = {"ok": True}
            except HydrusError as error:
                message = "Hydrus services (/get_services): " + str(error)
                capabilities["services"] = {"ok": False, "error": message}
                warnings.append(message)
            try:
                # Access-key validity alone does not prove that a key may search
                # all files, or that the generated system predicates work.
                await self.search_identifiers(client, {}, 1)
                capabilities["search"] = {"ok": True}
            except HydrusError as error:
                message = str(error)
                capabilities["search"] = {"ok": False, "error": message}
                warnings.append("Image search is unavailable. " + message)
        # Only documented permission fields are exposed, never arbitrary upstream keys.
        public_permissions = {key: permissions[key] for key in
                              ("permits_everything", "basic_permissions") if key in permissions}
        if not permissions.get("permits_everything"):
            granted = permissions.get("basic_permissions", [])
            for number, description in ((1, "import images"), (3, "refresh Hydrus metadata")):
                if number not in granted:
                    warnings.append("This key cannot " + description + ".")
            if 2 not in granted:
                warnings.append("This key cannot add tags or provide tag recommendations (optional).")
            if 7 not in granted:
                warnings.append("This key cannot add generation notes (optional).")
            if 4 not in granted:
                warnings.append("This key cannot browse open client pages (Manage Pages permission).")
        return {"ok": True, "services": services, "permissions": public_permissions,
                "capabilities": capabilities, "warnings": warnings}

    @staticmethod
    def validate_hash(value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", value):
            raise HydrusError("A valid SHA-256 image hash is required.")
        return value.lower()

    async def remote_metadata(self, client, identifiers, by_hash=False):
        if not identifiers:
            return []
        result = await client.request("GET", "/get_files/file_metadata", params={
            "hashes" if by_hash else "file_ids": json.dumps(identifiers),
            "include_notes": "true", "create_new_file_ids": "false"})
        records = result.get("metadata")
        if not isinstance(records, list):
            raise HydrusError("Hydrus returned invalid file metadata.")
        services = service_list(result)
        images = [dict(record, services_v2=services) for record in records
                  if isinstance(record, dict) and record.get("file_id") is not None
                  and str(record.get("mime", "")).startswith("image/")
                  and record.get("is_local") is True and not record.get("is_trashed")
                  and re.fullmatch(r"[0-9a-f]{64}", str(record.get("hash", "")))]
        order = {value: n for n, value in enumerate(identifiers)}
        return sorted(images, key=lambda item: order.get(item.get("hash" if by_hash else "file_id"), 0))

    async def search_identifiers(self, client, data, limit):
        tags = clean_tags(data.get("tags", []))
        tags = [tag for tag in tags if not tag.lower().startswith("system:limit")]
        match = data.get("match", "all")
        if match not in ("all", "any"):
            raise HydrusError("Search match must be 'all' or 'any'.")
        if match == "any":
            alternatives = [tag for tag in tags if not tag.startswith("-")
                            and not tag.lower().startswith("system:")]
            tags = [tag for tag in tags if tag.startswith("-") or tag.lower().startswith("system:")]
            # Hydrus nests OR predicates inside its outer AND list. Filters and
            # exclusions must keep applying to every alternative.
            if alternatives:
                tags.append(alternatives if len(alternatives) > 1 else alternatives[0])
        tags.extend([HYDRUS_IMAGE_PREDICATE, "system:limit=" + str(limit)])
        try:
            result = await client.request("GET", "/get_files/search_files", params={
                "tags": json.dumps(tags), "file_sort_type": "2", "file_sort_asc": "false",
                "return_file_ids": "true"})
        except HydrusError as error:
            raise HydrusError("Hydrus image search (/get_files/search_files): " + str(error)) from None
        identifiers = result.get("file_ids")
        if not isinstance(identifiers, list) or any(type(value) is not int for value in identifiers):
            raise HydrusError("Hydrus image search (/get_files/search_files) returned invalid file IDs.")
        return identifiers

    async def browse(self, action, data):
        settings = self.settings.load()
        limit = data.get("limit", 100)
        offset = data.get("offset", 0)
        if type(limit) is not int or not 1 <= limit <= 200 or type(offset) is not int or offset < 0:
            raise HydrusError("Choose a result limit of 1–200 and a non-negative offset.")
        async with self.client_factory(settings) as client:
            if action == "pages":
                result = await client.request("GET", "/manage_pages/get_pages")
                return {"pages": result.get("pages", {})}
            if action == "search":
                identifiers = await self.search_identifiers(client, data, limit)
                return {"items": await self.remote_metadata(client, identifiers[:limit]),
                        "total": len(identifiers), "limit": limit}
            page_key = data.get("page_key")
            if not isinstance(page_key, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", page_key):
                raise HydrusError("Choose a valid open Hydrus page.")
            result = await client.request("GET", "/manage_pages/get_page_info", params={"page_key": page_key, "simple": "false"})
            page = result.get("page_info", {})
            if not isinstance(page, dict):
                raise HydrusError("Hydrus returned invalid page information.")
            media = page.get("media", result.get("media", {}))
            identifiers = media.get("hash_ids", media.get("file_ids"))
            by_hash = identifiers is None
            if by_hash:
                identifiers = media.get("hashes", [])
            if not isinstance(identifiers, list):
                raise HydrusError("This Hydrus version did not return page files.")
            batch = identifiers[offset:offset + limit]
            return {"items": await self.remote_metadata(client, batch, by_hash),
                    "total": len(identifiers), "offset": offset, "limit": limit,
                    "page_name": page.get("name", ""), "page_state": page.get("page_state", 0)}

    async def suggest(self, data):
        query = data.get("query", "")
        service_key = data.get("tag_service_key", "")
        if not isinstance(service_key, str) or len(service_key) > 256 or (service_key and not re.fullmatch(r"[0-9a-fA-F]+", service_key)):
            raise HydrusError("Invalid tag service for recommendations.")
        limit = data.get("limit", 50)
        if not isinstance(query, str) or len(query) > 1024:
            raise HydrusError("Tag recommendation query must be a string of at most 1024 characters.")
        if type(limit) is not int or not 1 <= limit <= 50:
            raise HydrusError("Choose a tag recommendation limit of 1–50.")
        query = query.strip()
        if not query.lstrip("-").strip():
            return {"tags": [], "has_more": False}
        async with self.client_factory(self.settings.load()) as client:
            # File search uses display tags; match its sibling processing here.
            # Hydrus understands a leading '-' and returns canonical tag values.
            payload = await client.request("GET", "/add_tags/search_tags", params={
                "search": query, "tag_display_type": "display",
                **({"tag_service_key": service_key} if service_key else {})})
        records = payload.get("tags")
        if not isinstance(records, list):
            raise HydrusError("Hydrus returned invalid tag recommendations.")
        tags, seen = [], set()
        for record in records:
            if not isinstance(record, dict):
                continue
            value = record.get("value")
            if not isinstance(value, str) or not value.strip() or len(value) > 1024:
                continue
            value = value.strip()
            if value in seen:
                continue
            seen.add(value)
            tag = {"value": value}
            count = record.get("count")
            if type(count) is int and count >= 0:
                tag["count"] = count
            tags.append(tag)
            if len(tags) > limit:
                break
        return {"tags": tags[:limit], "has_more": len(tags) > limit}

    async def import_from_hydrus(self, data, get_input_root):
        digest = self.validate_hash(data.get("hash"))
        if get_input_root is None:
            raise HydrusError("ComfyUI input directory is unavailable.")
        async with self.client_factory(self.settings.load()) as client:
            stream = await client.download(digest)
        try:
            return await asyncio.to_thread(save_input_image, stream, digest, get_input_root())
        finally:
            stream.close()


def save_input_image(stream, digest, input_root):
    """Verify original bytes and save an immutable, reusable ComfyUI input copy."""
    stream.seek(0)
    actual = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        actual.update(chunk)
    if actual.hexdigest() != digest:
        raise HydrusError("Downloaded image hash does not match Hydrus; no input file was saved.")
    stream.seek(0)
    try:
        with Image.open(stream) as image:
            extension = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "GIF": ".gif",
                         "BMP": ".bmp", "TIFF": ".tiff", "AVIF": ".avif"}.get(image.format)
            image.verify()
        if not extension:
            raise HydrusError("This image format is not supported for ComfyUI input.")
    except (OSError, ValueError, Image.DecompressionBombError):
        raise HydrusError("Hydrus did not return a supported image.") from None
    root = Path(input_root).resolve(strict=True)
    directory = root / "hydrus"
    directory.mkdir(exist_ok=True)
    try:
        directory.resolve(strict=True).relative_to(root)
    except ValueError:
        raise HydrusError("Hydrus input folder must stay within ComfyUI's input directory.") from None
    destination = directory / (digest + extension)
    temporary = None
    try:
        # Hash names give stable input selections; never overwrite existing files.
        with destination.open("xb") as output:
            temporary = destination
            stream.seek(0)
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                output.write(chunk)
        temporary = None
    except FileExistsError:
        if destination.is_symlink() or hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
            raise HydrusError("A different file already occupies this Hydrus input name.") from None
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return {"name": destination.name, "subfolder": "hydrus", "type": "input",
            "input_name": "hydrus/" + destination.name,
            "url": "/view?filename=" + destination.name + "&subfolder=hydrus&type=input", "hash": digest}


def inspect_original_download(stream, digest):
    """Verify the original before streaming it, keeping filenames fully local."""
    stream.seek(0)
    actual, size = hashlib.sha256(), 0
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        actual.update(chunk)
        size += len(chunk)
    if actual.hexdigest() != digest:
        raise HydrusError("Downloaded image hash does not match Hydrus; download was cancelled.")
    stream.seek(0)
    extension, mime = ".bin", "application/octet-stream"
    try:
        with Image.open(stream) as image:
            extension = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "GIF": ".gif",
                         "BMP": ".bmp", "TIFF": ".tiff", "AVIF": ".avif", "JPEGXL": ".jxl"}.get(image.format, ".bin")
            if extension != ".bin":
                mime = Image.MIME.get(image.format, "application/octet-stream")
    except (OSError, ValueError, Image.DecompressionBombError):
        # Downloads also work for originals unsupported by the installed Pillow.
        # Their verified bytes remain safe attachments with a .bin extension.
        pass
    stream.seek(0)
    return {"Content-Disposition": 'attachment; filename="' + digest + extension + '"',
            "Content-Type": mime, "Content-Length": str(size),
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def register_hydrus_routes(routes, get_root, storage_dir=None, get_input_root=None):
    bridge = HydrusBridge(get_root, storage_dir)

    async def handle(request, action):
        try:
            # ComfyUI has no separate secret store/session here. Only its own origin
            # may make browser mutations; command-line requests may omit Origin.
            origin = request.headers.get("Origin")
            if request.method != "GET" and (request.headers.get("Sec-Fetch-Site") == "cross-site"
                    or (origin and urlsplit(origin).netloc.lower() != request.host.lower())):
                return web.json_response({"error": "Cross-origin Hydrus requests are not allowed."}, status=403)
            if action == "get_settings":
                result = bridge.settings.public(await asyncio.to_thread(bridge.settings.load))
            elif action == "thumbnail":
                digest = bridge.validate_hash(request.query.get("hash"))
                async with bridge.client_factory(bridge.settings.load()) as client:
                    stream = await client.download(digest, thumbnail=True)
                try:
                    raw = stream.read()
                    stream.seek(0)
                    with Image.open(stream) as thumbnail:
                        mime = Image.MIME.get(thumbnail.format, "image/png")
                    return web.Response(body=raw, content_type=mime, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
                finally:
                    stream.close()
            elif action == "download":
                digest = bridge.validate_hash(request.query.get("hash"))
                async with bridge.client_factory(bridge.settings.load()) as client:
                    stream = await client.download(digest)
                try:
                    headers = await asyncio.to_thread(inspect_original_download, stream, digest)
                    response = web.StreamResponse(headers=headers)
                    await response.prepare(request)
                    while chunk := await asyncio.to_thread(stream.read, 1024 * 1024):
                        await response.write(chunk)
                    await response.write_eof()
                    return response
                finally:
                    stream.close()
            else:
                try:
                    data = await request.json()
                except (ValueError, UnicodeError):
                    raise HydrusError("Request body must be JSON.") from None
                if not isinstance(data, dict):
                    raise HydrusError("Request body must be a JSON object.")
                if action == "save_settings":
                    result = await asyncio.to_thread(bridge.settings.save, data)
                elif action == "test":
                    result = await bridge.test(data)
                elif action == "services":
                    result = await bridge.services(data)
                elif action == "status":
                    result = await bridge.status(data)
                elif action == "suggest":
                    result = await bridge.suggest(data)
                elif action in ("search", "pages", "page"):
                    result = await bridge.browse(action, data)
                elif action == "import":
                    result = await bridge.import_from_hydrus(data, get_input_root)
                else:
                    result = await bridge.batch(action, data)
            return web.json_response(result, headers={"Cache-Control": "no-store"})
        except HydrusError as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)
        except (OSError, sqlite3.Error):
            return web.json_response({"ok": False, "error": "Cannot read or write Hydrus memory; check folder permissions."}, status=500)

    for method, path, action in (("get", "settings", "get_settings"), ("post", "settings", "save_settings"),
                                 ("post", "test", "test"), ("post", "status", "status"),
                                 ("post", "services", "services"),
                                 ("post", "export", "export"), ("post", "refresh", "refresh"),
                                 ("post", "search", "search"), ("post", "pages", "pages"),
                                 ("post", "suggest", "suggest"), ("get", "download", "download"),
                                 ("post", "page", "page"), ("get", "thumbnail", "thumbnail"), ("post", "import", "import")):
        async def endpoint(request, action=action):
            return await handle(request, action)
        getattr(routes, method)("/Gallery/hydrus/" + path)(endpoint)
    return bridge

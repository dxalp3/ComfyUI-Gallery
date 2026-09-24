"""Local-only QA: real gallery bridge + simulated Hydrus; never contacts user's client."""
import asyncio
import hashlib
import importlib.util
import json
import sys
import types
import tempfile
import aiohttp
from pathlib import Path

from aiohttp import web
from PIL import Image, ImageDraw, PngImagePlugin

REPO = Path(__file__).resolve().parents[1]
TEMP = tempfile.TemporaryDirectory(prefix='gallery-browser-qa-')
WORK = Path(TEMP.name)
MEDIA = WORK / 'qa-media'
MEMORY = WORK / 'qa-memory'
MEDIA.mkdir(exist_ok=True)
MEMORY.mkdir(exist_ok=True)
INPUT = WORK / 'qa-input'
INPUT.mkdir(exist_ok=True)
for i, color in enumerate(['#294b65', '#bd8559', '#518978', '#796baa']):
    p = MEDIA / f'study-{i + 1}.png'
    if not p.exists():
        im = Image.new('RGB', (640, 440), color)
        d = ImageDraw.Draw(im)
        d.ellipse((130, 45, 510, 425), fill=['#b9cdd7', '#edcb96', '#adcfb5', '#cbc1e8'][i])
        d.text((30, 25), f'Gallery test image {i + 1}', fill='white')
        info = PngImagePlugin.PngInfo()
        info.add_text('prompt', json.dumps({'1': {'class_type': 'KSampler', 'inputs': {'seed': 42}}}))
        im.save(p, pnginfo=info)

package = types.ModuleType('gallery_qa')
package.__path__ = [str(REPO)]
sys.modules['gallery_qa'] = package
folder_paths = types.ModuleType('folder_paths')
folder_paths.get_output_directory = lambda: str(MEDIA)
folder_paths.get_folder_paths = lambda _: []
sys.modules['folder_paths'] = folder_paths
spec = importlib.util.spec_from_file_location('gallery_qa.hydrus', REPO / 'hydrus.py')
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
thumb_spec = importlib.util.spec_from_file_location('gallery_qa.thumbnails', REPO / 'thumbnails.py')
thumb_module = importlib.util.module_from_spec(thumb_spec)
sys.modules[thumb_spec.name] = thumb_module
thumb_spec.loader.exec_module(thumb_module)

KEY = 'a' * 64
TAG = 'b' * 64
ALT_TAG = 'f' * 64
LOCAL = 'c' * 64
files = {}
originals = {}
upstream_calls = []
upstream = web.Application(client_max_size=32 * 1024 * 1024)

async def hydrus(request):
    upstream_calls.append(request.path)
    if request.headers.get('Hydrus-Client-API-Access-Key') != KEY:
        return web.json_response({'error': 'invalid key'}, status=403)
    if request.path == '/verify_access_key':
        return web.json_response({'permits_everything': True, 'basic_permissions': [0, 1, 2, 3, 4, 5, 6, 7]})
    if request.path == '/api_version':
        return web.json_response({'version': 80, 'hydrus_version': 680})
    if request.path == '/get_services':
        return web.json_response({'services': {TAG: {'name': 'my tags', 'type': 5}, ALT_TAG: {'name': 'generation tags', 'type': 5}, LOCAL: {'name': 'my files', 'type': 2}}})
    if request.path == '/add_files/add_file':
        raw = await request.read()
        sha = hashlib.sha256(raw).hexdigest()
        originals[sha] = raw
        status = 2 if sha in files else 1
        files.setdefault(sha, {'hash': sha, 'file_id': len(files) + 1, 'size': len(raw), 'mime': 'image/png', 'width': 640, 'height': 440,
                               'is_inbox': True, 'is_local': True, 'is_trashed': False, 'is_deleted': False,
                               'known_urls': [], 'notes': {}, 'ratings': {'qa-rating': 0.8},
                               'tags': {TAG: {'name': 'my tags', 'type': 5, 'storage_tags': {'0': []}, 'display_tags': {'0': []}}},
                               'file_services': {'current': {LOCAL: {'name': 'my files', 'type': 2}}, 'deleted': {}}})
        return web.json_response({'status': status, 'hash': sha, 'note': 'QA import'})
    if request.path == '/get_files/file_metadata':
        hashes = json.loads(request.query.get('hashes', '[]'))
        if 'file_ids' in request.query:
            ids = json.loads(request.query['file_ids'])
            hashes = [h for h, record in files.items() if record['file_id'] in ids]
        return web.json_response({'metadata': [files[h] for h in hashes if h in files], 'services': {TAG: {'name': 'my tags', 'type': 5}}})
    if request.path == '/add_tags/add_tags':
        data = await request.json()
        for h in data.get('hashes', [data.get('hash')]):
            for service, tags in data.get('service_keys_to_tags', {}).items():
                if h in files:
                    files[h]['tags'].setdefault(service, {'name': 'generation tags', 'type': 5, 'storage_tags': {'0': []}, 'display_tags': {'0': []}})
                    files[h]['tags'][service]['storage_tags']['0'] = tags
                    files[h]['tags'][service]['display_tags']['0'] = tags
        return web.json_response({})
    if request.path == '/add_notes/set_notes':
        data = await request.json()
        files[data['hash']]['notes'].update(data['notes'])
        return web.json_response({})
    if request.path == '/get_files/search_files':
        tags = json.loads(request.query.get('tags', '[]'))
        if any(isinstance(tag, str) and 'bmp' in tag and 'image/bmp' not in tag for tag in tags):
            return web.json_response({'error': 'Invalid filetype alias'}, status=400)
        return web.json_response({'file_ids': [record['file_id'] for record in files.values()]})
    if request.path == '/add_tags/search_tags':
        return web.json_response({'tags': [{'value': 'character:alice', 'count': 25}, {'value': 'character:alina', 'count': 10}, {'value': 'character:allen', 'count': 8}]})
    if request.path == '/manage_pages/get_pages':
        return web.json_response({'pages': {'name': 'pages', 'page_key': 'd' * 64, 'is_media_page': False, 'pages': [
            {'name': 'Img2img references', 'page_key': 'e' * 64, 'is_media_page': True, 'selected': True}]}})
    if request.path == '/manage_pages/get_page_info':
        return web.json_response({'page_info': {'name': 'Img2img references', 'page_state': 0, 'media': {'hash_ids': [record['file_id'] for record in files.values()]}}})
    if request.path in ('/get_files/file', '/get_files/thumbnail'):
        return web.Response(body=originals[request.query['hash']], content_type='image/png')
    return web.json_response({'error': 'unknown simulated endpoint'}, status=404)

upstream.router.add_route('*', '/{tail:.*}', hydrus)
app = web.Application()
routes = web.RouteTableDef()
module.register_hydrus_routes(routes, lambda: str(MEDIA), storage_dir=MEMORY, get_input_root=lambda: str(INPUT))
thumb_module.register_thumbnail_routes(routes, lambda: str(MEDIA))
from gallery_qa.image_source_api import register_source_routes
from gallery_qa.gallery_app import register_gallery_app_routes
register_source_routes(routes, lambda: MEDIA, lambda: INPUT)
register_gallery_app_routes(routes)
app.add_routes(routes)

async def homepage(request):
    return web.Response(text='''<!doctype html><html><head><title>Gallery Hydrus QA</title><meta charset="utf-8"></head>
<body style="margin:0;background:#20252b"><div class="flex gap-2 mx-2"></div>
<script>window.qaNodes=[];window.qaListeners={};window.qaExtension=null;
window.LiteGraph={createNode:type=>{const n={type,comfyClass:type,title:'Gallery Image Source',widgets:[{name:'sources',value:JSON.stringify({version:1,images:[],layout:'single',columns:2,gap:0,background:'#000000'})}],addWidget(type,name,value,callback,options){const w={type,name,value,callback,options};this.widgets.push(w);return w;},setSize(){},setDirtyCanvas(){}};window.qaExtension?.nodeCreated(n);return n;}};
const graph={_nodes:window.qaNodes,add(node){node.id=window.qaNodes.length+1;window.qaNodes.push(node);},beforeChange(){},afterChange(){}};
window.comfyAPI={app:{app:{graph,canvas:{graph,selected_nodes:{},selectNode(node){this.selected_nodes={[node.id]:node};}},api:{fetchApi:(url,options)=>fetch(url,options),addEventListener:(name,cb)=>window.qaListeners[name]=cb},registerExtension:ext=>{window.qaExtension=ext;ext.init();}}}};</script>
<script type="module" src="/assets/comfy-ui-gallery.js"></script></body></html>'''.replace('/assets/comfy-ui-gallery.js', '/assets-before/comfy-ui-gallery.js' if request.query.get('baseline') else '/assets/comfy-ui-gallery.js'), content_type='text/html')

async def images(request):
    entries = {p.name: {'name': p.name, 'url': '/static_gallery/' + p.name, 'timestamp': 1700000000 + n, 'date': '2023-11-14', 'type': 'image',
                         'metadata': {'fileinfo': {'filename': p.name, 'resolution': '640x440', 'date': '2023-11-14', 'size': '3 KB'},
                                      'prompt': {'92': {'class_type': 'KSampler', 'inputs': {'positive': ['17', 0], 'negative': ['86', 0]}},
                                                 '17': {'class_type': 'CLIPTextEncode', 'inputs': {'text': ['azure sky, mountain', 'autumn forest', 'ocean sunset', 'winter snow'][n]}},
                                                 '86': {'class_type': 'CLIPTextEncode', 'inputs': {'text': ['blurry, watermark', 'bad anatomy', 'low contrast', 'overexposed'][n]}}}}}
               for n, p in enumerate(MEDIA.glob('*.png'))}
    return web.json_response({'folders': {'output': entries}})

async def settings(request):
    return web.json_response({'relativePath': './', 'floatingButton': False, 'darkMode': True, 'showDateDivider': False})

async def noop(request):
    return web.json_response({})

async def state(request):
    return web.json_response({'files': files, 'calls': upstream_calls})

async def input_image(request):
    return web.FileResponse(INPUT / request.query.get('subfolder', '') / Path(request.query['filename']).name)

app.router.add_get('/', homepage)
app.router.add_get('/Gallery/images', images)
app.router.add_route('*', '/Gallery/settings', settings)
app.router.add_route('*', '/Gallery/monitor/{tail:.*}', noop)
app.router.add_get('/qa-state', state)
app.router.add_get('/view', input_image)
app.router.add_static('/assets', REPO / 'web' / 'dist' / 'assets')

app.router.add_static('/static_gallery', MEDIA)

async def main():
    for application, port in [(upstream, 45870), (app, 8191)]:
        runner = web.AppRunner(application)
        await runner.setup()
        await web.TCPSite(runner, '127.0.0.1', port).start()
    async with aiohttp.ClientSession() as session:
        async with session.post('http://127.0.0.1:8191/Gallery/hydrus/settings', json={'url': 'http://127.0.0.1:45870', 'access_key': KEY, 'tag_service_key': TAG}) as response:
            assert response.status == 200, await response.text()
        async with session.post('http://127.0.0.1:8191/Gallery/hydrus/export', json={'urls': ['/static_gallery/study-%d.png' % i for i in range(1, 5)], 'tags': ['source:qa'], 'send_metadata': True}) as response:
            assert response.status == 200, await response.text()
    print('QA server listening on http://127.0.0.1:8191', flush=True)
    await asyncio.Event().wait()

asyncio.run(main())

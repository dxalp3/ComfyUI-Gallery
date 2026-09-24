"""Standalone same-origin Gallery entry point; no credentials in the HTML."""
from pathlib import Path
from aiohttp import web


def register_gallery_app_routes(routes):
    @routes.get('/Gallery/app/')
    @routes.get('/Gallery/app')
    async def gallery_app(request):
        return web.Response(text='''<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ComfyUI Gallery</title>
<style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>
<script type="module" src="/Gallery/app.js"></script></body></html>''', content_type='text/html',
                            headers={'Cache-Control': 'no-cache'})

    @routes.get('/Gallery/app.js')
    async def gallery_script(request):
        return web.FileResponse(Path(__file__).parent / 'web' / 'dist' / 'assets' / 'comfy-ui-gallery.js',
                                headers={'Cache-Control': 'no-cache'})

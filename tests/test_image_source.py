"""Real pixel output, import safety, cache invalidation and HTTP preview tests."""
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from image_source import (GalleryImageSource, ImageSourceError, parse_manifest,
                          plan_composition, render_composition, resolve_input)
from image_source_api import import_local_image, register_source_routes
from gallery_app import register_gallery_app_routes


def manifest(*names, **kwargs):
    return dict(version=1, images=[dict(input_name=name) for name in names],
                layout=kwargs.get('layout', 'single'), columns=2, gap=1, background='#00ff00')


class CompositionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        Image.new('RGBA', (4, 3), (255, 0, 0, 128)).save(self.root / 'red.png')
        Image.new('RGB', (2, 5), 'blue').save(self.root / 'blue.png')

    def render(self, value):
        image = render_composition(plan_composition(value, self.root))
        self.addCleanup(image.close)
        return image

    def test_single_preserves_alpha_and_actual_crop(self):
        value = manifest('red.png', 'blue.png')
        value['images'][0]['crop'] = dict(x=.25, y=0, width=.5, height=1)
        image = self.render(value)
        self.assertEqual(image.size, (2, 3))
        self.assertEqual(image.getpixel((0, 0)), (255, 0, 0, 128))

    def test_stitch_layouts_gap_and_background(self):
        horizontal = self.render(manifest('red.png', 'blue.png', layout='horizontal'))
        self.assertEqual(horizontal.size, (7, 5))
        self.assertEqual(horizontal.getpixel((4, 0)), (0, 255, 0, 255))
        self.assertEqual(horizontal.getpixel((5, 0)), (0, 0, 255, 255))
        self.assertEqual(horizontal.getpixel((0, 4)), (0, 255, 0, 255))
        self.assertEqual(self.render(manifest('red.png', 'blue.png', layout='vertical')).size, (4, 9))
        grid = self.render(manifest('red.png', 'blue.png', 'red.png', layout='grid'))
        self.assertEqual(grid.size, (7, 9))
        self.assertEqual(grid.getpixel((6, 8)), (0, 255, 0, 255))

    def test_exif_orientation_applied_before_crop(self):
        image = Image.new('RGB', (8, 4), 'red')
        exif = Image.Exif(); exif[274] = 6
        image.save(self.root / 'rotated.jpg', exif=exif)
        value = manifest('rotated.jpg')
        value['images'][0]['crop'] = dict(x=0, y=0, width=1, height=.5)
        self.assertEqual(self.render(value).size, (4, 4))

    def test_reject_invalid_manifest_and_escape_paths(self):
        for name in ('../red.png', '/red.png', 'C:/red.png', 'a\\red.png', 'red.png/../red.png'):
            with self.subTest(name=name), self.assertRaises(ImageSourceError):
                resolve_input(self.root, name)
        for changes in (dict(layout='bad'), dict(columns=True), dict(gap=-1), dict(background='red'), dict(images=[]), dict(images=[dict(input_name='red.png')]*33)):
            value = manifest('red.png'); value.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ImageSourceError):
                parse_manifest(value)
        for crop in (dict(x=0, y=0, width=float('nan'), height=1), dict(x=.9, y=0, width=.2, height=1), dict(x=0, y=0, width=0, height=1)):
            value = manifest('red.png'); value['images'][0]['crop'] = crop
            with self.assertRaises(ImageSourceError): parse_manifest(value)

    def test_pixel_budget_checked_before_render_and_change_detection(self):
        value = manifest('red.png', 'blue.png', layout='horizontal')
        with patch('image_source.MAX_PIXELS', 30), self.assertRaises(ImageSourceError):
            plan_composition(value, self.root)
        with patch.object(GalleryImageSource, '_input_root', return_value=self.root):
            text = json.dumps(value)
            previous = GalleryImageSource.IS_CHANGED(text)
            self.assertEqual(GalleryImageSource.VALIDATE_INPUTS(text), True)
            plan = plan_composition(value, self.root)
            Image.new('RGB', (3, 5), 'white').save(self.root / 'blue.png')
            self.assertNotEqual(previous, GalleryImageSource.IS_CHANGED(text))
            with self.assertRaises(ImageSourceError): render_composition(plan)

    def test_local_import_reuses_identical_original_without_overwrite(self):
        input_root = self.root / 'input'; input_root.mkdir()
        first = import_local_image(self.root, input_root, '/static_gallery/red.png')
        second = import_local_image(self.root, input_root, '/static_gallery/red.png')
        self.assertEqual(first, second)
        saved = input_root / first['input_name']
        self.assertEqual(saved.read_bytes(), (self.root / 'red.png').read_bytes())
        saved.write_bytes(b'unrelated existing data')
        with self.assertRaises(ImageSourceError): import_local_image(self.root, input_root, '/static_gallery/red.png')
        self.assertEqual(saved.read_bytes(), b'unrelated existing data')
        self.assertEqual(len(list((input_root / 'gallery_sources').iterdir())), 1)


class SourceRoutesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.input = self.root / 'input'; self.input.mkdir()
        Image.new('RGB', (1600, 800), 'red').save(self.root / 'source.png')
        routes = web.RouteTableDef()
        register_source_routes(routes, lambda: self.root, lambda: self.input)
        register_gallery_app_routes(routes)
        app = web.Application(); app.add_routes(routes)
        self.client = TestClient(TestServer(app)); await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def test_import_preview_and_standalone_entry(self):
        result = await self.client.post('/Gallery/source/local', json={'url': '/static_gallery/source.png'})
        self.assertEqual(result.status, 200)
        source = await result.json()
        thumbnail = await self.client.get('/Gallery/source/thumbnail', params={'url': '/static_gallery/' + source['input_name']})
        self.assertEqual(thumbnail.status, 200)
        with Image.open(BytesIO(await thumbnail.read())) as image: self.assertEqual(image.size, (512, 256))
        result = await self.client.post('/Gallery/source/preview', json={'manifest': manifest(source['input_name'])})
        self.assertEqual(result.status, 200)
        self.assertEqual(result.headers['X-Image-Width'], '1600')
        with Image.open(BytesIO(await result.read())) as image: self.assertEqual(image.size, (1024, 512))
        result = await self.client.get('/Gallery/app')
        self.assertIn('/Gallery/app.js', await result.text())
        result = await self.client.get('/Gallery/app.js')
        self.assertEqual(result.status, 200)

    async def test_invalid_requests_and_cross_origin_rejected(self):
        for body in ([], {'manifest': {}}, {'manifest': '{bad'}):
            result = await self.client.post('/Gallery/source/preview', json=body)
            self.assertEqual(result.status, 400)
        result = await self.client.post('/Gallery/source/local', json={'url': '/static_gallery/source.png'}, headers={'Origin': 'https://other.example'})
        self.assertEqual(result.status, 403)
        result = await self.client.post('/Gallery/source/local', json={'url': '/static_gallery/source.png'}, headers={'Sec-Fetch-Site': 'cross-site'})
        self.assertEqual(result.status, 403)


if __name__ == '__main__': unittest.main()

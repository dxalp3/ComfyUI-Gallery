import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from PIL import Image, PngImagePlugin
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from transfer_metadata import read_metadata, write_metadata
from image_source import parse_manifest


class TransferMetadataTests(unittest.TestCase):
    def test_original_bytes_remain_identical_and_sidecar_is_hash_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'image.png'
            info = PngImagePlugin.PngInfo()
            info.add_text('prompt', json.dumps({'positive': 'standing'}))
            Image.new('RGB', (4, 4)).save(path, pnginfo=info)
            original = path.read_bytes()
            digest = hashlib.sha256(original).hexdigest()
            metadata = read_metadata(path)
            metadata['hydrus'] = {'tags': {'service': {'display_tags': {'0': ['blue hair']}}}}
            write_metadata(path, digest, metadata)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(read_metadata(path), metadata)
            Image.new('RGB', (5, 5)).save(path)
            self.assertEqual(read_metadata(path), {})
            with self.assertRaises(ValueError): write_metadata(path, hashlib.sha256(path.read_bytes()).hexdigest(), {})

    def test_manifest_retains_selected_prompts_and_complete_metadata(self):
        entry = {'input_name': 'image.png', 'metadata': {'positive': 'hair, standing'}, 'prompt': {'positive': 'standing', 'negative': '', 'tags': ['pose']}}
        result = parse_manifest({'version': 1, 'images': [entry]})
        self.assertEqual(result['images'][0], entry)

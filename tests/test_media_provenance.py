import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from image_source_api import save_input_provenance
from image_source import ImageSourceError
from transfer_metadata import read_metadata

class MediaProvenanceTests(unittest.TestCase):
    def test_video_metadata_is_saved_without_changing_media_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            source=Path(root)/'video.webm';content=(Path(__file__).parent/'fixtures/viewer.webm').read_bytes();source.write_bytes(content)
            metadata={'gallery_origin':'hydrus','hydrus':{'hash':hashlib.sha256(content).hexdigest()},'prompt':{'source':1}}
            result=save_input_provenance(root,'video.webm',metadata)
            self.assertEqual(source.read_bytes(),content);self.assertEqual(read_metadata(source),metadata);self.assertEqual(result['metadata'],metadata)
    def test_mismatched_hash_and_path_escape_do_not_write_sidecars(self):
        with tempfile.TemporaryDirectory() as root:
            source=Path(root)/'video.webm';source.write_bytes(b'video')
            with self.assertRaises(ImageSourceError):save_input_provenance(root,'video.webm',{'hydrus':{'hash':'a'*64}})
            self.assertFalse(Path(str(source)+'.gallery.json').exists())
            with self.assertRaises(ImageSourceError):save_input_provenance(root,'../outside.webm',{})
if __name__=='__main__':unittest.main()

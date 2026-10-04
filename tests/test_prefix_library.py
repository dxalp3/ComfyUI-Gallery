import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prefix_library import read, update, GalleryPromptLibrary
from tag_dictionary import format_terms, prompt_tags


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'prompt-library.json'

    def save(self, name, terms):
        return update(self.path, {'action': 'save', 'revision': read(self.path)[1], 'name': name, 'terms': terms})

    def test_same_file_legacy_ids_preserved_and_case_insensitive_update(self):
        legacy = {'version': 2, 'tags': [{'id': 'tag1', 'name': 'Eyes', 'text': 'blue_eyes'}], 'prefixes': [{'id': 'p1', 'name': 'Portrait', 'tags': ['tag1']}]}
        self.path.write_text(json.dumps(legacy))
        self.save('portrait', ['blue_eyes', 'long_hair'])
        value = json.loads(self.path.read_text())
        self.assertEqual(value['prefixes'], [{'id': 'p1', 'name': 'Portrait', 'tags': ['tag1', value['tags'][1]['id']]}])
        self.assertEqual(value['tags'][0]['name'], 'Eyes')
        self.assertEqual(GalleryPromptLibrary().output_prefix('blue eyes'), ('blue eyes',))

    def test_concurrent_edit_is_rejected_without_losing_data(self):
        first = self.save('pose', ['standing'])
        self.save('eyes', ['blue_eyes'])
        with self.assertRaises(FileExistsError):
            update(self.path, {'action': 'save', 'revision': first['revision'], 'name': 'pose', 'terms': ['sitting']})
        self.assertEqual([row['name'] for row in read(self.path)[0]['prefixes']], ['pose', 'eyes'])

    def test_browser_migration_and_delete_preserve_vocabulary(self):
        source = {'version': 1, 'tags': [{'id': 't', 'name': 'Pose', 'text': 'standing'}], 'prefixes': [{'id': 'p', 'name': 'pose', 'tags': ['t']}]}
        result = update(self.path, {'action': 'migrate', 'revision': read(self.path)[1], 'library': source})
        with self.assertRaises(ValueError):
            update(self.path, {'action': 'migrate', 'revision': result['revision'], 'library': source})
        result = update(self.path, {'action': 'delete', 'id': 'p', 'revision': result['revision']})
        self.assertEqual(result['library']['prefixes'], [])
        self.assertEqual(result['library']['tags'], source['tags'])

    def test_user_files_do_not_mix(self):
        self.save('private', ['blue_eyes'])
        other = self.path.parent / 'other' / 'prompt-library.json'
        self.assertEqual(read(other)[0]['prefixes'], [])

    def test_invalid_library_is_not_overwritten(self):
        self.path.write_text('not json')
        with self.assertRaises(ValueError):
            self.save('x', ['standing'])
        self.assertEqual(self.path.read_text(), 'not json')

    def test_danbooru_prompt_spelling_preserves_custom_text_weights_and_exports(self):
        terms = ['blue_eyes', 'long hair', '(hands_up:1.2)', '<lora:my_style:0.7>', 'custom_identifier_xyz']
        self.assertEqual(format_terms(terms), ['blue eyes', 'long hair', '(hands up:1.2)', '<lora:my_style:0.7>', 'custom_identifier_xyz'])
        self.assertEqual(format_terms(['blue eyes', 'long_hair'], False), ['blue_eyes', 'long_hair'])
        self.assertEqual(prompt_tags('blue eyes, long hair'), ['blue_eyes', 'long_hair'])

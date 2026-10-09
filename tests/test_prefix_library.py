import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prefix_library import read, update, GalleryPromptLibrary, GalleryPromptEncode, resolve_dynamic, RESOLVED_KEY
from tag_dictionary import format_terms, prompt_tags, browse_vocabulary, term_aliases


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

    def test_image_pairing_survives_reload_and_unrelated_prefix_updates(self):
        result = update(self.path, {'action': 'save', 'revision': read(self.path)[1], 'name': 'Pose only', 'terms': ['standing'], 'image_keys': ['sha256:example', 'local:./:/output/example.png']})
        pair = result['library']['associations']['sha256:example']
        self.assertEqual(pair['terms'], ['standing'])
        self.save('Hair', ['long_hair'])
        self.assertEqual(read(self.path)[0]['associations']['sha256:example'], pair)
        self.assertEqual(read(self.path)[0]['associations']['local:./:/output/example.png'], pair)

    def test_bad_image_pairing_does_not_write_library(self):
        self.save('Existing', ['standing'])
        before = self.path.read_bytes()
        with self.assertRaises(ValueError):
            update(self.path, {'action': 'save', 'revision': read(self.path)[1], 'name': 'Bad', 'terms': ['sitting'], 'image_keys': [123]})
        self.assertEqual(self.path.read_bytes(), before)

    def test_prefix_edit_refreshes_all_pairs_and_delete_removes_them(self):
        result = update(self.path, {'action': 'save', 'revision': read(self.path)[1], 'name': 'Pose', 'terms': ['old'], 'image_keys': ['sha256:a', 'local:./:a'], 'image_refs': {'sha256:a': {'hash': 'a'}}})
        prefix_id = result['library']['prefixes'][0]['id']
        result = update(self.path, {'action': 'save', 'revision': result['revision'], 'name': 'Pose', 'terms': ['new'], 'negative_terms': ['negative']})
        for item in result['library']['associations'].values():
            self.assertEqual(item['terms'], ['new'])
            self.assertEqual(item['negative_terms'], ['negative'])
        self.assertEqual(result['library']['associations']['sha256:a']['image'], {'hash': 'a'})
        result = update(self.path, {'action': 'delete', 'id': prefix_id, 'revision': result['revision']})
        self.assertEqual(result['library']['prefixes'], [])
        self.assertFalse(result['library']['associations'])
        self.assertTrue(result['library']['tags'])

    def test_encoder_uses_editable_text_and_scheduled_clip_api(self):
        class Clip:
            def tokenize(self, text):
                self.text = text
                return {'tokens': text}
            def encode_from_tokens_scheduled(self, tokens):
                return [['conditioning', {'text': tokens['tokens']}]]
        clip = Clip()
        encoded, text = GalleryPromptEncode().encode(clip, 'manually edited, (blue eyes:1.2)')['result']
        self.assertEqual(clip.text, text)
        self.assertEqual(encoded[0][1]['text'], text)
        self.assertEqual(GalleryPromptEncode.RETURN_TYPES, ('CONDITIONING', 'STRING'))
        with self.assertRaises(ValueError): GalleryPromptEncode().encode(None, '')

    def test_connected_prompt_combines_with_own_text_and_supports_explicit_replace(self):
        class Clip:
            def tokenize(self, value): return value
            def encode_from_tokens_scheduled(self, value): return value
        node = GalleryPromptEncode()
        self.assertEqual(node.encode(Clip(), 'fallback', 'source')['result'], ('fallback, source', 'fallback, source'))
        self.assertEqual(node.encode(Clip(), 'fallback', '')['result'], ('fallback', 'fallback'))
        self.assertEqual(node.encode(Clip(), 'fallback')['ui']['effective_prompt'], ['fallback'])
        self.assertEqual(node.encode(Clip(), 'fallback', 'source', 'before')['result'][1], 'source, fallback')
        self.assertEqual(node.encode(Clip(), 'fallback', '', 'replace')['result'][1], '')

    def test_box_layout_substitutes_the_source_box_where_it_sits(self):
        class Clip:
            def tokenize(self, value): return value
            def encode_from_tokens_scheduled(self, value): return value
        node, marker = GalleryPromptEncode(), '\u27e6source\u27e7'
        # Groups the browser did not resolve are picked here; braces never reach CLIP.
        self.assertIn(node.encode(Clip(), 'a, ' + marker + ', {b|c|}', 'src, tags,', 'boxes')['result'][1], ('a, src, tags, b', 'a, src, tags, c', 'a, src, tags'))
        self.assertEqual(node.encode(Clip(), marker + ', a', 'src', 'boxes')['result'][1], 'src, a')
        self.assertEqual(node.encode(Clip(), 'a, ' + marker, None, 'boxes')['result'][1], 'a')
        self.assertEqual(node.encode(Clip(), 'a', 'ignored', 'boxes')['result'][1], 'a')
        self.assertEqual(node.encode(Clip(), 'a', 'x', 'boxes')['ui']['source_text'], ['x'])
        with self.assertRaises(ValueError): node.encode(Clip(), 'a', 'x', 'sideways')

    def test_unresolved_groups_are_picked_and_recorded_for_the_saved_image(self):
        import random
        class Clip:
            def tokenize(self, value): return value
            def encode_from_tokens_scheduled(self, value): return value
        text, choices = resolve_dynamic('1girl, {blond hair|red hair}, {smile, open mouth|}, {x|{y|z}}', random.Random(3))
        self.assertNotIn('{', text)
        self.assertEqual(len(choices), 4)
        self.assertTrue(all(choice['chosen'] in choice['options'] for choice in choices))
        self.assertEqual(resolve_dynamic('a, \\{literal\\}, (b:1.2)')[0], 'a, \\{literal\\}, (b:1.2)')
        info = {'workflow': {}}
        result = GalleryPromptEncode().encode(Clip(), 'a, \u27e6source\u27e7', '{blond hair|red hair}, b', 'boxes', extra_pnginfo=info, unique_id='7')
        record = info[RESOLVED_KEY]['7']
        self.assertEqual(record['resolved'], result['result'][1])
        self.assertEqual(record['text'], 'a, {blond hair|red hair}, b')
        self.assertIn(record['choices'][0]['chosen'], ('blond hair', 'red hair'))
        # Tags removed from the source box are dropped from the source text when it arrives (escaped like the frontend writes them).
        info = {'workflow': {}}
        marker = '⟦source -["Blue_Eyes","x\\u007by\\u007cz\\u007d"]⟧'
        result = GalleryPromptEncode().encode(Clip(), 'a, ' + marker + ', b', 'red hair, blue eyes, x{y|z}, smile', 'boxes', extra_pnginfo=info, unique_id='8')
        self.assertEqual(result['result'][1], 'a, red hair, smile, b')
        self.assertEqual(info[RESOLVED_KEY]['8']['source_excluded'], ['Blue_Eyes', 'x{y|z}'])
        self.assertEqual(GalleryPromptEncode.IS_CHANGED(text='a, b') , '')
        self.assertNotEqual(GalleryPromptEncode.IS_CHANGED(text='a', source_text='{b|c}'), GalleryPromptEncode.IS_CHANGED(text='a', source_text='{b|c}'))

    def test_images_can_be_paired_and_unpaired_without_changing_prefix_terms(self):
        self.save('Pose', ['standing', 'arms up'])
        library, revision = read(self.path)
        prefix = library['prefixes'][0]
        update(self.path, {'action': 'associate', 'revision': revision, 'prefix_id': prefix['id'], 'image_keys': ['sha256:' + 'a' * 64, 'local:./:/static_gallery/x.png'], 'image_refs': {'sha256:' + 'a' * 64: {'hash': 'a' * 64}}})
        library, revision = read(self.path)
        self.assertEqual(library['associations']['sha256:' + 'a' * 64], {'prefix_id': prefix['id'], 'terms': ['standing', 'arms up'], 'negative_terms': [], 'image': {'hash': 'a' * 64}})
        self.assertEqual(library['prefixes'][0]['tags'], prefix['tags'])
        update(self.path, {'action': 'dissociate', 'revision': revision, 'image_keys': ['sha256:' + 'a' * 64]})
        library, revision = read(self.path)
        self.assertEqual(list(library['associations']), ['local:./:/static_gallery/x.png'])
        with self.assertRaises(ValueError): update(self.path, {'action': 'associate', 'revision': revision, 'prefix_id': 'missing', 'image_keys': ['k']})

    def test_unresolved_alternatives_never_become_danbooru_tags_and_aliases_expand(self):
        self.assertEqual(prompt_tags('1girl, {blond hair|red hair}, blue eyes, {smile, open mouth|}'), ['1girl', 'blue_eyes'])
        blue, custom = term_aliases(['blue eyes', 'my lora'])
        self.assertIn('blue_eyes', blue); self.assertIn('blue eyes', blue)
        self.assertEqual(custom, ['my lora'])

    def test_negative_image_pairing_and_reference_survive_reload(self):
        result = update(self.path, {'action': 'save', 'revision': read(self.path)[1], 'name': 'paired', 'terms': ['standing'], 'negative_terms': ['blurry'], 'image_keys': ['sha256:test'], 'image_refs': {'sha256:test': {'name': 'example.png', 'local_url': '/static_gallery/example.png', 'root': './'}}})
        self.assertEqual(result['library']['prefixes'][0]['negative_terms'], ['blurry'])
        self.save('other', ['sitting'])
        pair = read(self.path)[0]['associations']['sha256:test']
        self.assertEqual(pair['negative_terms'], ['blurry'])
        self.assertEqual(pair['image']['name'], 'example.png')

    def test_wiki_categories_sort_search_and_favorites(self):
        data = browse_vocabulary({'category': 'tag_group:attire', 'sort': 'alphabetical', 'limit': 100})
        names = [row['name'] for row in data['items']]
        self.assertEqual(names, sorted(names))
        self.assertGreater(data['total'], 100)
        self.assertIn('dress', [row['name'] for row in browse_vocabulary({'category': 'tag_group:attire', 'query': 'dress', 'limit': 100})['items']])
        self.assertIn('smile', [row['name'] for row in browse_vocabulary({'category': 'tag_group:face_tags', 'query': 'smile'})['items']])
        self.assertEqual(browse_vocabulary({'favorites': []})['total'], 0)
        self.assertEqual([row['name'] for row in browse_vocabulary({'favorites': ['blue_eyes']})['items']], ['blue_eyes'])
        popular = browse_vocabulary({})['items']
        self.assertEqual([row['count'] for row in popular], sorted([row['count'] for row in popular], reverse=True))

    def test_select_whole_category_is_not_limited_to_visible_page(self):
        whole = browse_vocabulary({'category': 'tag_group:hair_styles', 'selection': True, 'limit': 10000})
        self.assertGreater(whole['total'], 60)
        self.assertEqual(len(whole['items']), whole['total'])
        self.assertEqual(len(browse_vocabulary({'category': 'tag_group:hair_styles', 'limit': 10000})['items']), min(100, whole['total']))

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

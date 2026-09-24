# Validation — Hydrus edition 2.7.1-hydrus.4

## Image Source and unified gallery — 2026-09-24

- Python: **63 passed, 2 skipped** (65 total). Existing Windows symlink privilege skips remain.
- JavaScript: **17 passed** across `local_search.test.cjs` and `image_source.test.cjs`.
- TypeScript compilation and the Vite production build passed. The generated frontend is committed. Existing bundle-size and third-party directive warnings remain.
- Chrome integration passed against the real Gallery bridge and a simulated Hydrus server/ComfyUI graph: local bulk/range/context append; dedicated node creation; numeric crop; horizontal stitch preview dimensions; save/reopen; Local/Hydrus/Both views; Hydrus search, pages and selected context append; local size filtering; and standalone-tab append back to the opening workflow. No browser page errors or stored API keys were observed.
- Export QoL regression covers recommendations, service selection, and optional positive-prompt prefixes.

New Python coverage verifies cropped pixels and dimensions, stitch placement/gaps/background, alpha preservation, EXIF orientation, malformed settings, path traversal, pixel limits, changed-file detection, byte-identical local copies, duplicate reuse, no overwrite of unrelated files, reduced previews and source thumbnails, same-origin checks, and standalone entry routes.

New JavaScript coverage verifies normalized crop geometry, encoded input paths, local quality filters, target selection, preserving existing crops/layout on append, removed-node validation, and the 32-source limit.

These checks use a simulated ComfyUI graph, not an installed ComfyUI session or GPU workflow. Tensor execution depends on ComfyUI's NumPy/PyTorch runtime; actual image composition is verified using Pillow. No real Hydrus library was accessed. Check the node in the installed ComfyUI version after restarting and hard-refreshing.

### Reproduce the new checks

```sh
python -m unittest discover -s tests -p 'test_*.py'
node tests/local_search.test.cjs
node tests/image_source.test.cjs
cd web
pnpm build
```

For browser integration, install Playwright separately (it is not a runtime dependency), start `python tests/gallery_browser_server.py`, then run `node tests/browser_image_source.cjs` and `node tests/browser_export_qol.cjs` in another terminal. The fixture binds localhost ports 8191 and 45870 and stores mock images/settings in a temporary directory. Set `PLAYWRIGHT_MODULE` to a Playwright module path if it is not resolvable normally, and optionally `CHROME_PATH` to a Chrome executable. Stop the fixture server afterwards. The browser test never contacts your Hydrus client.

---

# Earlier validation — Hydrus edition 2.7.1-hydrus.3

Based on PanicTitan/ComfyUI-Gallery commit `74639e68846f64c9f561f3a7745529de76376a97`.

## Checks completed

- Python suite: **55 passed, 2 skipped**, out of 57 tests (`python -m unittest discover -s tests -p "test_*.py"`). Both skips require filesystem symlink privileges unavailable in this Windows environment.
- Local-search and prompt-tag helper suite: **12 passed** (`node tests/local_search.test.cjs`). This includes linked ComfyUI prompts with arbitrary node IDs, Flux/SD3 encoders, conditioning merges and cycles, workflow-only metadata, separate positive/negative searches, prompt-tag phrases, and current/pending Hydrus tags across services.
- **67 automated tests passed in total.**
- TypeScript project compilation and the Vite production build passed. The built frontend is included in `web/dist/assets/comfy-ui-gallery.js`. Vite reports the existing large-bundle warning and a third-party module directive warning.
- Headless Chrome passed the baseline integration, Hydrus browsing QoL, and new export QoL checks against the real bridge with a simulated Hydrus HTTP server. No browser page errors were observed.

## Browser behavior verified

The checks cover settings test/save, automatic service loading, per-export service overrides without changing the saved default, Shift range selection, bulk context-menu export, cached metadata, local prompt/tag filters, Hydrus search, and open-client-page browsing.

Live recommendations work in search, additional export tags, per-image prompt-tag editors, and saved default tags. Export recommendations respect the chosen tag service; **Add all suggestions** adds the displayed tags without duplicates. Positive tags can be exported with or without `positive_prompt:`, while negative tags retain `negative_prompt:`. The saved prefix preference and editable tag previews were exercised.

The Hydrus browser checks also cover select-all suggestions for OR search, arrow/Space/Ctrl+A controls with normal text-input behavior, original and ZIP downloads verified against SHA-256 filenames, bulk input copies, and img2img insertion through a simulated ComfyUI graph interface. API keys were absent from browser local storage.

## Performance measurements

These before/after checks used four visible image cards in headless Chrome against the same test gallery. They measure avoided rebuilding and requests, not frame rate on a user's library.

| Check | Before | After |
| --- | ---: | ---: |
| Existing card elements preserved after metadata updates | 0 of 4 | 4 of 4 |
| Existing card elements preserved after a file event | 0 of 4 | 4 of 4 |
| Files included in status requests after one file changes | 4 | 1 |
| Files included in status requests when reopening the Gallery | 4 | 0 |
| Initial gallery scans | 2 | 1 |

The grid now retains card identity during updates, reuses sorted lists, uses direct selection lookups, and computes bulk context-menu targets when needed. Hydrus status already loaded during the browser session is reused; changed files and explicit refreshes still update it.

### Thumbnail benchmark

A synthetic 4096×4096 random RGB PNG measured **50,378,524 bytes**. Its 512px WebP preview measured **45,970 bytes**, a **99.909% reduction** in transferred image bytes for that fixture. Reading and decoding the original with Pillow took **118 ms**; generating the preview for the first time took **214 ms**. Cached preview retrieval, including path resolution and a file-stat check, averaged **0.217 ms** over 100 calls.

This deliberately noisy image is a stress fixture, not typical artwork. The result demonstrates reduced transfer size and reuse after the first decode; it is not a real-world FPS claim. Actual sizes and timings vary with images and hardware.

Thumbnail tests verify the 512px limit, aspect ratio, transparency, EXIF orientation, first-frame animation handling, unchanged original bytes, memory/entry limits, cache hits and invalidation, root changes, ETag revalidation, concurrent-request reuse, off-thread decoding, and safe failures for invalid paths or unsupported images. The cache is bounded to 32 MiB and 512 entries, with two background decoding workers.

## Backend coverage

Tests cover exact-byte uploads, optional tags and notes, duplicate import outcomes, rejected/deleted/vetoed imports, independent batch failures, retaining import history after optional-operation failures, offline snapshots, rename and content-change identity, target profile isolation, credential masking, path traversal checks, redirect protection, chunked JSON responses, search limits, page response variants, image-only result filtering, input download hash verification, file reuse, overwrite protection, thumbnail proxying, and cross-origin mutation rejection.

Additional coverage includes recommendation validation and service selection, AND/OR grouping with exclusions and system predicates, attachment downloads, service discovery and per-export overrides, saved prompt-tag defaults, and connection testing that probes image search. The search predicate uses Hydrus-supported image aliases, replacing the unsupported bare `bmp` alias that could break search while pages and authentication worked.

## Practical limits

No real user Hydrus database or installed ComfyUI instance was connected during validation. Initial folder scanning and embedded-metadata reads still have a cost, and large originals, storage speed, and network latency can still affect responsiveness. Hydrus metadata remains a snapshot; use explicit refresh controls after changes in the main client.

Enter the API URL and key in **Hydrus settings** after installation. **Manage Pages** is required for the open-pages tab. Direct Load Image creation depends on the ComfyUI frontend exposing its graph/LiteGraph interface; the saved input filename is available as a fallback. The [setup guide](HYDRUS.md) describes these paths.

## GitHub fork migration — 2026-09-18

The Hydrus edition was transferred onto the original Git history in
[dxalp3/ComfyUI-Gallery](https://github.com/dxalp3/ComfyUI-Gallery), with Git-based
installation and update instructions. Application source and the supplied frontend
bundle were preserved from the validated edition.

The migrated checkout passed the Python suite (55 passed, 2 skipped for Windows
symlink privileges), all 12 JavaScript helper tests, and TypeScript project
compilation. Python tests required execution outside the Windows sandbox because
the sandbox blocked access to their temporary fixtures. Browser scenarios and the
production bundle were not rebuilt or rerun for this documentation and repository
migration; their results above refer to the original validation.

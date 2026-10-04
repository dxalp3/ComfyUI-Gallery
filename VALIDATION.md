# Shared prefixes and visible sources — hydrus.11 (2026-10-04)

- Backend: **97 passed, 2 skipped** (99 tests); existing Windows symlink skips.
- JavaScript: **26 passed**. TypeScript and production build pass. Existing Vite
  third-party directive and large-bundle warnings remain.
- Six Chrome suites cover shared prefixes, prompt-aware hybrid search, Image
  Source, unified gallery, export controls, and the 10,000-image workspace.
- New browser coverage creates a prefix from selected image metadata, opens the
  shared manager from an existing `TagPrefixPromptLibrary` node, writes the
  chosen prefix to its STRING widget with spaced/canonical spellings, creates
  another prefix there, searches it by name, then appends an image and verifies
  both serialized source data and a loaded inline node thumbnail before execution.
- Backend tests cover preserving original library IDs, case-insensitive prefix
  updates, rejecting concurrent stale writes, explicit browser migration, user
  isolation, invalid-file preservation, model-text formatting without changing
  custom/LoRA identifiers, and native Hydrus spelling alternatives/exclusions.
- Source tests now assert retention of the native STRING widget type instead of
  changing it to `hidden`. The preview is a nonserialized DOM widget.

The browser uses synthetic images and a simulated ComfyUI graph with DOM widgets,
not a running installed ComfyUI/GPU workflow. The installed node and frontend
versions were inspected read-only. No installed files, real user library or
Hydrus data were changed. The original Prompt Library package is still needed
for workflows using its node class; Gallery adds its own equivalent for new ones.

---

# Background sync and prompt index — hydrus.10 (2026-10-02)

- Backend: **90 passed, 2 skipped** (92 tests). The two existing skips require
  Windows symlink privileges.
- JavaScript: **26 passed**. TypeScript compilation and the production build pass;
  existing Vite bundle-size and third-party directive warnings remain.
- Six Chrome integration suites passed: sync conflict resolution, hybrid prompts,
  export controls, unified gallery, image source, and the 10,000-image workspace.
  The conflict panel was also visually inspected at 1500×1000.
- New tests verify offline queue persistence across bridge restarts, idempotent
  delivery, original service targeting, profile isolation, last-synced note
  baselines, remote edits during conflict resolution, keep-both preservation,
  deleted-file refusal, worker startup/shutdown, and a resumable 251-file index
  with an offline prompt match beyond the previous 200-file cutoff.
- Browser conflict coverage uses real bridge/worker routes against a simulated
  Hydrus server, verifies both note previews and the resulting two remote notes.
  The older export test now uses the current workspace launcher and mandatory
  metadata behavior.

These checks use synthetic files, a simulated Hydrus API and a simulated ComfyUI
workflow. No installed ComfyUI files or real Hydrus library were modified. Actual
Hydrus permissions, remote library size and startup in the user's ComfyUI runtime
remain deployment checks. Full synchronization scope and limits are documented
in [HYDRUS.md](HYDRUS.md#background-synchronization-hydrus10).

Run `python -m unittest discover -s tests -p 'test_*.py'` for backend checks.
For the conflict browser check, start `python tests/gallery_browser_server.py`,
then run `node tests/browser_hydrus_sync.cjs` with Playwright/Chrome configured as
below. `SYNC_SCREENSHOT` optionally specifies a screenshot output path.

---

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

## Sidebar and unified gallery — 2026-10-01 (hydrus.5)

- Python: **66 passed, 2 skipped** (68 tests). Existing Windows symlink skips.
  Added grouped OR forwarding, sort validation, and verified inline-original tests.
- JavaScript helpers: **21 passed**, including mixed-source ordering, missing-hash
  placement, deterministic shuffle, existing prompt filters and Image Source helpers.
- TypeScript compilation and Vite production build passed. The bundled frontend
  is included. Existing dependency-directive and large-bundle warnings remain.
- `tests/browser_unified_gallery.cjs` passed in headless Chrome against the real
  local bridge with simulated Hydrus/ComfyUI: local and remote viewer selection,
  right-click bulk actions, export dialog above viewer, original rendering, OR
  request payload, one mixed grid, mixed-source append, docking/expanding without
  lost selection, client pages, and local prompt-filter synchronization.
- Updated `tests/browser_image_source.cjs` for the consolidated controls. It passed:
  range selection, exact crop/stitch output dimensions, saved editor state, Hydrus
  search and page append, quality filtering, context actions, and standalone-tab
  append back to the same node. Both browser runs reported no page errors.

Browser QA uses the documented custom-sidebar render/destroy callbacks through
its simulated ComfyUI host. A real installed ComfyUI frontend and real Hydrus
library were not available for this run. Advanced Hydrus ordering is verified by
forwarded API parameters, not by real database ordering; supported options vary
by client version. Loaded-gallery sorting is independently tested. Local media
viewers retain the existing model/audio/video renderers; this run's image fixture
does not validate every media codec or 3D format.

## Full-page gallery workspace — 2026-10-01 (hydrus.6)

- TypeScript compilation, Vite production build, and all 21 JavaScript helper
  tests passed. The rebuilt frontend bundle is included; the existing bundle-size
  warning remains.
- `browser_workspace.cjs` passed with 10,000 synthetic local entries: fewer than
  100 cards mounted, grid height above 760px at a 1500×1000 viewport, retained
  scroll and selection across workflow switches, tab-bar replacement, workflow
  load callbacks, responsive sizing, hostile host CSS, light mode, and access
  without a workflow tab bar. No browser page errors were reported.
- Updated unified-gallery and Image Source browser regressions passed against
  the local bridge and simulated ComfyUI/Hydrus host, covering mixed results,
  viewer selection/context actions, OR search, crop/stitch, filters, and append
  from a separate browser tab.
- Backend code is unchanged; the Python results above apply to that code.

The Gallery button is extension-owned and attached beside workflow tabs. It
does not register a saved workflow or modify ComfyUI core files. Actual installed
ComfyUI and Hydrus were not connected for these checks. The tab integration
depends on the frontend tab-bar markup; sidebar and floating launchers provide
access when that container is unavailable. Synthetic-library checks validate
rendering and state retention, not real storage scanning or Hydrus throughput.

## Selection, prompt library and local routing — 2026-10-01 (hydrus.7)

- Python suite: **76 passed, 2 skipped** (78 tests). New coverage verifies preview
  versus apply, real scanner integration, prompt-prefix connections, polarity,
  All/Any routing, first-match order, saved extra roots, destination traversal,
  collisions, new-file deferral, failed-copy preservation, delete root/origin
  checks, and Hydrus trash payloads with no physical-deletion service parameters.
- All **22 JavaScript helper tests**, TypeScript compilation, and the production
  build passed. The updated bundle is included; existing bundle warnings remain.
- `browser_gallery_qol.cjs` passed in headless Chrome: larger selection targets,
  single/double-click selection behavior, viewer selection retention, local delete
  cancel/apply, Hydrus trash confirmation, indexed prompt suggestions, shared
  Prompt Library browser data, folder-rule previews, and actual VP8/WebM decoding
  and viewer controls using an original 352-byte synthetic fixture.
- Unified gallery, Image Source and 10,000-file workspace browser regressions
  passed, including inline OR request payloads, source mixing, crop/stitch,
  selection/scroll retention, light mode and fallback access.

Browser file mutations use intercepted responses; Python endpoint and routing
tests exercise real temporary files and fake Hydrus servers. No installed
ComfyUI folder, actual image library, saved prefix library, or live Hydrus server
was modified. The Prompt Library adapter was checked against the supplied node's
source and its version-2 browser-data format; actual installed user-data API
integration and other video codecs were not exercised. Routing intentionally
does not infer missing prompts or move sidecars.

## Shared search, Hydrus video and Danbooru filtering — 2026-10-01 (hydrus.8)

- Backend: 81 tests, 79 passed and 2 skipped. Added mixed-media filtering,
  verified WebM byte/suffix ranges and invalid-range handling, output download
  reuse/collision protection, downloaded-file tag correspondence, and offline
  Danbooru filtering of quality terms and weighted prompts.
- All 23 JavaScript helper tests pass, including source-specific AND/OR branches,
  exclusions, cached tag matching and normalized weighted prompt phrases.
- TypeScript compilation and production build pass. The compiled bundle is
  included. Existing bundle-size and react-virtualized directive warnings remain.
- Five Chrome suites pass: gallery QoL, unified gallery, Image Source, 10,000-file
  workspace, and the new library-search suite. They cover automatic checkbox
  selection, retained double-click selection, stacked local terms, counted Hydrus
  suggestions, empty-Enter search, popup OR suggestions, mixed-source queries,
  synthetic remote WebM decoding, output-download requests, cached-tag local
  search and Danbooru export preview. The large-grid suite retains over 76% of
  viewport height and verifies responsive/light-theme layouts.

All verification used temporary files and simulated Hydrus services. The installed
ComfyUI and real Hydrus libraries were not modified or tested. Remote playback
was exercised with the tiny synthetic WebM fixture; other codecs and large-video
latency remain environment-dependent. Download integrity/ranges and file writes
are checked by backend tests; browser download actions are intercepted. Dictionary
provenance is recorded in data/. Shared searches match local phrases, not Hydrus
system predicates. Tag memory is a refreshable snapshot, not two-way editing.

## Hybrid search and prompt-aware workflow append — 2026-10-01 (hydrus.9)

- Backend suite: 85 tests, 83 passed and 2 skipped. New tests cover metadata
  AND/OR searches, dictionary lookup, additive scoped tag syncing, hash-bound
  sidecars, unchanged original bytes, sidecar collision protection and source
  manifest metadata retention. Notes are attempted even when an older client
  submits send_metadata=false.
- 26 JavaScript tests pass: explicit prompt targets, replacement/prepend behavior,
  missing-target rejection before source changes, metadata retention, sidecar tags,
  prompt notes, shared dates and hybrid predicates. TypeScript/build pass.
- Six isolated Chrome suites pass, including the new hybrid/prompt suite. It
  verifies mixed results through random API sampling, API-free reshuffling,
  exclusive-source fallback, persistent search, source selection override,
  per-image prefix expansion and filtering, positive/negative target writes,
  source metadata, and shared prefix saving. Existing image-source, unified-grid,
  video/selection, library-search and 10,000-file workspace checks pass.

Tests use a mock Hydrus and temporary files. The installed node was read only;
no live workflow or live Hydrus library was modified. Actual arbitrary third-party
prompt widgets and codec behavior remain environment-dependent. Cross-source
prompt search is bounded to the documented 200-candidate metadata scan. There is
no automatic rewiring of an existing workflow, continuous two-way tag sync, or
bulk migration of the dictionary into Prompt Library storage.

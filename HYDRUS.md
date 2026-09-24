# Hydrus integration

This customized Gallery adds image export to your Hydrus client, persistent export history, and a cached view of the file's Hydrus metadata. Search local files by Hydrus tags or generation prompts, browse the main client's library and open pages, and bring source images into an img2img workflow. ComfyUI sends the original file directly to Hydrus, so the two applications can run on different computers.

Version **2.7.1-hydrus.4** adds Gallery Image Source with cropping and stitching, a separate gallery browser tab, and Local / Hydrus / Both views in the main gallery.

## Install this customized version

Install from [dxalp3/ComfyUI-Gallery](https://github.com/dxalp3/ComfyUI-Gallery), the Hydrus fork of [PanicTitan/ComfyUI-Gallery](https://github.com/PanicTitan/ComfyUI-Gallery).

1. Stop ComfyUI. If a Gallery is already installed, follow the migration steps below first.
2. From `ComfyUI/custom_nodes`, clone the fork:

   ```bash
   git clone https://github.com/dxalp3/ComfyUI-Gallery.git
   ```

3. Install `requirements.txt` using ComfyUI's Python environment. From a standard ComfyUI checkout:

   ```bash
   python -m pip install -r custom_nodes/ComfyUI-Gallery/requirements.txt
   ```

   For Windows portable, run this from the portable installation's root:

   ```powershell
   .\python_embeded\python.exe -m pip install -r .\ComfyUI\custom_nodes\ComfyUI-Gallery\requirements.txt
   ```

4. Start ComfyUI and hard-refresh its browser page.

The repository includes the built frontend in `web/dist/assets`; Node.js is only needed to change and rebuild its source. Keep one active Gallery installation: loading two copies registers duplicate routes and extensions.

### Move from an archive or the original Gallery

With ComfyUI stopped, back up and move the existing Gallery folder outside `custom_nodes`, then clone this fork into the now-vacant `custom_nodes/ComfyUI-Gallery` location. Copy back your `user_settings.json`, `hydrus_settings.json`, and `hydrus_memory.sqlite3` (plus any matching SQLite sidecar files), if present, from the backup. Keep the new clone's source and built frontend. Continue with dependency installation above, then restart ComfyUI. This preserves your saved connection and export history while enabling future Git updates.

### Update a Git installation

Stop ComfyUI and back up your settings and Hydrus history. Inside `custom_nodes/ComfyUI-Gallery`, run:

```bash
git pull --ff-only
```

This updates from the fork configured by the clone command above. Settings and Hydrus history are ignored by Git and remain in place. If `requirements.txt` changed, rerun the dependency installation command. Restart ComfyUI and hard-refresh its browser page.

If Git reports local code changes or diverged history, preserve those changes and resolve them before updating; do not discard them to force the update. An archive installation must use the migration steps above once before `git pull` can work.

## Enable the Hydrus Client API

1. In your main Hydrus client, open **services → edit**, select **Client API**, and assign a port, usually `45869`.
2. Open **services → review → Client API**, create an access key for this Gallery, and copy it.
3. Grant the permissions below. Hydrus must remain open for its API to respond.

| Permission | Used for |
| --- | --- |
| Import and Delete Files | Import image files. |
| Search for and Fetch Files, with access to all files | Look up matching hashes and retrieve metadata. |
| Edit File Tags | Optional tags on export and live search-tag recommendations. |
| Edit File Notes | Optional generation metadata notes on export. |
| Manage Pages | Browse pages open in the main Hydrus client. |

Tag-restricted search keys are unsuitable for the direct hash lookups used here. Setup follows the [official Client API guide](https://hydrusnetwork.github.io/hydrus/client_api.html#enabling-the-api); permission details are in the [Hydrus API reference](https://hydrusnetwork.github.io/hydrus/developer_api.html#access-and-permissions).

## Connection address

Use an address reachable **from the ComfyUI server**:

| Where Hydrus runs | Example API URL |
| --- | --- |
| On the same computer as ComfyUI | `http://127.0.0.1:45869` |
| On another computer on your network | `http://192.168.1.50:45869` |
| Behind your configured HTTPS proxy | `https://hydrus.example.net` |

In a container or remote ComfyUI installation, `127.0.0.1` means that container or remote machine. For a different computer, enable non-local connections in Hydrus and allow the port through that computer's firewall. Use a trusted network, VPN, or properly configured HTTPS for remote access. The original image is uploaded as bytes; shared folders and path mappings are unnecessary.

Hydrus chooses the import destination and applies its file import options. Previously deleted, vetoed, or rejected files are reported as such; the Gallery does not clear Hydrus deletion records. See the [official file import API](https://hydrusnetwork.github.io/hydrus/developer_api.html#post-add_filesadd_file).

## Export and browse metadata

Open the Gallery and choose **Hydrus settings**. Enter the API URL and access key, test the connection, and save the settings. **Test connection** verifies the key, loads services, and runs an actual image-search request. It reports search problems separately, since working page access does not establish that file search works.

Tag services load when settings opens with a saved key. Use **Reload tag services** after entering a new connection or changing services in Hydrus. Choose a **Default tag service** to preselect it in future exports. Every export also has its own **Tag service for this export** selector and **Reload services** button; changing it there leaves the saved default unchanged. A tag service is optional when sending no tags.

The **Client profile** defaults to `main`. Use a different profile when the same address points to a different Hydrus database. **Request timeout** defaults to 30 seconds and can be increased to 300 seconds for a busy client or a slower connection.

### Select images

- Use an image's checkbox or **Ctrl/Cmd-click** to toggle it.
- **Shift-click** selects a range in the current display order.
- **Select all shown** selects images in the current folder and search results. **Clear selection** clears the selection.
- **Ctrl/Cmd-click** a sidebar folder to toggle its files. Selections can span folders; the Hydrus controls use image files from the selection.

Choose **Export to Hydrus** to review the selected images and export options. The dialog shows progress and individual results. You can stop after the current file finishes and retry failed entries.

Right-click an image for export, refresh, and metadata actions. If that image is selected, the export and refresh actions use the selected group; otherwise they act on that image. **Hydrus metadata** always opens the image you clicked.

### Tags, prompt tags, and generation notes

**Send generation metadata as a note by default** only preselects the note option in the export dialog. It does **not** add prompts as tags. The original image retains its embedded metadata regardless of whether notes or tags are enabled.

The note is named **ComfyUI Gallery generation metadata**. It includes embedded `prompt`, `workflow`, and `parameters` entries available to Pillow, commonly in ComfyUI PNGs. It does not reconstruct missing metadata or automatically turn prompts into tags. Conflicting existing notes are preserved with a separate name. Notes over 2 MiB are skipped with a warning. A successful file import is retained even if tags, notes, or the subsequent metadata check fail.

Prompt tags are separate, optional export controls:

- **Add positive-prompt tags** adds positive-prompt phrases as individual tags. Turn **Prefix positive tags with positive_prompt:** off to use plain tags such as `blue sky`, or leave it on for `positive_prompt:blue sky`.
- **Add negative-prompt tags** adds phrases under `negative_prompt:`.
- Commas and newlines separate phrases. For example, `red hair, blue sky` becomes two tags, with or without the positive prefix. A sentence without commas stays one phrase.
- Open **Review and edit prompt tags per image** before exporting to remove, change, or add individual tags. Each image receives its own prompt tags. Changing a prompt-tag checkbox resets these preview edits.
- The two **Suggest … tags by default** settings preselect their respective export options independently. Both start disabled.
- **Prefix positive-prompt tags by default** saves the prefix preference for future exports; each export can override it. It starts enabled to preserve the behavior of earlier versions. Negative tags retain their separate `negative_prompt:` prefix.

Live Hydrus recommendations are available in **Additional tags for this export**, each image's prompt-tag editor, and **Default export tags** in settings. Type to find existing tags, select a recommendation, or press Enter to add your own. **Add all suggestions** adds the displayed recommendations without duplicates. These fields use the tag service selected in their respective export or settings dialog. Up to 50 recommendations appear at once; refine the text to narrow a longer list. If recommendations fail, manual tag entry remains available.

Prompt extraction follows positive and negative conditioning connections in embedded ComfyUI metadata, with saved workflow links and explicit prompt fields as fallbacks. Missing metadata or unsupported custom node layouts may leave the preview empty; add tags manually when needed. Default tags, additional export tags, and enabled prompt tags all use the service chosen for that export. The dialog supports at most 500 tags per image and 1,024 characters per tag.

### Check the Hydrus copy

**Refresh Hydrus status** checks the selected images. Use **Hydrus metadata** to inspect the cached metadata, last check time, and export history. The details include tags by service, ratings, notes, and the raw response where available. Refresh after changing tags, ratings, notes, or file state in Hydrus. **Select without export history** selects displayed images without a recorded import or match; use Refresh first to discover files imported elsewhere.

## Search images on this device

The Gallery header searches every file in the current folder, including cards outside the viewport. Use the field selector to choose **All fields**, **File name**, **Hydrus tags (cached)**, **Positive prompt**, or **Negative prompt**. Matching is case-insensitive and finds the entered phrase within a field; it does not use Hydrus's tag-query syntax.

Prompt searches use the metadata embedded in local files. Positive and negative prompts remain separate: a word such as `blurry` in the positive conditioning is searchable as a positive prompt. Hydrus-tag searches use the last saved metadata snapshot across tag services, including current and pending tags and their display aliases. They remain available while Hydrus is offline.

Use **Refresh folder tags** to fetch current Hydrus metadata for every image in the folder, including images hidden by the current search. This also discovers matching images imported into Hydrus elsewhere. Refresh after editing tags in the main client; the Gallery does not continuously poll those edits.

## Find source images for img2img

Choose **Local**, **Hydrus**, or **Both** at the top of Gallery. Both shows separate local and Hydrus sections with their respective search controls and selections. **Browse Hydrus** also switches directly to the Hydrus section.

Local search covers file names, cached Hydrus tags, and positive/negative prompts. Minimum width/height and format filters further narrow the current folder. Dimension filters exclude files without known image dimensions. Hydrus tag search accepts its `system:` predicates for other qualities.

Hydrus controls:

- **Search Hydrus:** enter tags and press Enter after each, or pick live tag recommendations as you type. Choose **All tags (AND)** or **Any tag (OR)**. In OR mode, any included ordinary tag can match; excluded tags (`-portrait`) and system predicates such as `system:inbox` still apply to every result. Namespaces and wildcards are supported. An empty search returns recent local images. Choose up to 200 results; use more specific tags to narrow a large collection.
- **Select all suggestions for OR** adds the currently displayed recommendations and switches to OR mode. At most 50 recommendations appear at once; refine the text if more exist. Recommendations require both file-search and tag-edit permissions. Manual tag entry remains available if recommendations fail.
- **Open client pages:** loads the main client's current page tree, including nested groups and the active page. Select a media page to see its images in the client's order. Use Previous/Next for large pages, **Reload open pages** after opening/closing tabs in Hydrus, and **Reload page images** after changing its contents. This view requires **Manage Pages** permission.
- Select result checkboxes, Shift-click a range, or use **Select results** for bulk actions. Right-click a result for copy, download, metadata, and img2img actions. Append, copy, and download apply to the selected group when the clicked image belongs to it.

### Download originals

**Download** saves a Hydrus original to your browser's download location. **Download selected** saves one image directly or multiple images as `hydrus-images.zip`. Filenames use the verified SHA-256 hash and detected image extension. These downloads do not create ComfyUI input files.

Single originals are capped at 256 MiB. A bulk ZIP is capped at 128 MiB of original image data to bound browser memory use; choose a smaller group if that limit is reached. Progress and individual failures are reported. **Cancel remaining** stops after the current image, and successful downloads collected so far are still saved.

### Keyboard controls

Use these shortcuts while focus is inside the Hydrus library or its image view:

| Key | Action |
| --- | --- |
| Arrow keys | Move between result cards; browse images in the detail view. |
| Shift + Arrow keys | Extend the result selection. |
| Space | Toggle selection of the focused image. |
| Enter | Open the focused image. |
| Ctrl/Cmd + A | Select all loaded results. |
| `/` | Focus tag search. |
| Ctrl/Cmd + Enter in tag search | Run the search using the entered tags. |
| `D` | Download the focused image. |
| `I` | Use the focused image for img2img. |
| Escape | Close the top image/library view. |
| `?` | Show or hide keyboard help. |

Text inputs and menus keep their normal keyboard controls, including text selection. **Keyboard controls** also opens the shortcut reference. Bulk operations temporarily disable conflicting actions.

### Copy to ComfyUI for img2img

**Copy to input** downloads the original image into `ComfyUI/input/hydrus/<sha256>.<extension>`. Copies preserve the original bytes and embedded metadata. The download is verified against its Hydrus hash, existing copies are reused, and unrelated files are never overwritten. Originals are capped at 256 MiB per image. These local copies remain after restarting ComfyUI.

### Gallery Image Source: append, crop, and stitch

1. Use **Append to Image Source** on a local image's context menu or the selection toolbar. For Hydrus use **Append for img2img**, **Append selected to Image Source**, or the `I` shortcut. Originals are copied to ComfyUI input first; local sources live in `input/gallery_sources`, Hydrus sources in `input/hydrus`.
2. With no source node, the first append creates **Gallery Image Source**. Otherwise choose the destination in **Img2img target**. You can create another node in this selector. A single selected source node is used automatically if no target has been chosen; multiple possible targets require a choice. Bulk append goes to one node.
3. Click **Edit images / crop / stitch** in Gallery or on the node. Select a source, drag a crop rectangle or enter pixel/percentage coordinates. Reset crop and common aspect ratios are available. Reorder or remove sources in the list.
4. Choose Single, horizontal stitch, vertical stitch, or grid. Single uses the first source; stitch modes include every source. Set the gap, grid columns, and background color, then **Save to node**. **Browse / append images** saves your current draft and returns to Gallery.
5. Connect the node's **IMAGE** output to **VAE Encode** or another image input. The node also outputs **MASK**, **width**, and **height**. No generation is queued automatically.

Crops remove pixels. Stitching preserves each crop's original resolution and aligns it to the top-left of its cell without stretching. Source alpha is preserved; MASK is inverted alpha, with opaque background in gaps and unused cells. EXIF orientation is applied before cropping. Animated sources use the first frame. The editor preview is reduced to at most 1024 pixels; node output remains full size. Source-list thumbnails are cached at 512 pixels.

A node accepts up to 32 sources, a 64-megapixel output, and a 32768-pixel maximum side; each input file is limited to 256 MiB. Existing source files are reused by content hash. A saved workflow retains its source list, crop, and layout; retain the corresponding `input/gallery_sources` and `input/hydrus` files when moving or backing up the workflow. The editor changes the workflow only when you save or browse. Appending changes it immediately. Cancel discards unsaved editor changes.

### Open Gallery in another tab

Use **Open in new tab** in Gallery (or the ↗ button beside the non-floating launcher). The separate `/Gallery/app` page supports the same browsing, searches, exports, downloads, and bulk actions. **Img2img target in opening tab** controls the active workflow in the ComfyUI tab that opened it. Keep that tab open; appends and editor commands are sent only to it, even if other ComfyUI tabs are open. The detached page's Edit button opens the node editor in the original tab; browsers may require switching tabs manually.

Opening `/Gallery/app` directly supports browsing and copying to input. To append to a workflow, open it through ComfyUI's **Open in new tab** button. Reopen it that way if the original ComfyUI tab was refreshed or closed. Credentials remain in the server bridge. A separate tab listens for gallery updates without restarting the folder monitor; **Reload local images** is available for manual refresh.

Search and page results show supported images stored locally in Hydrus; videos, deleted files, and remote-only records are excluded. Page membership comes from a snapshot of the main client's UI and can change as downloads or searches finish. The Gallery does not modify or focus Hydrus pages. See the [page API](https://hydrusnetwork.github.io/hydrus/developer_api.html#managing-pages) for Hydrus version details.

## What the Gallery remembers

The bridge identifies each image by a SHA-256 hash of its complete file contents. Copies and renamed or moved files with identical bytes can share their Hydrus history. Editing or re-encoding an image produces a different identity, even if it looks the same.

Export history and the latest Hydrus state are separate: a file may have been exported successfully and later deleted in Hydrus. Cached details are a snapshot with a check time, not continuous two-way synchronization. The Gallery keeps the snapshot across browser and ComfyUI restarts, including while Hydrus is offline. Refresh requests update it from Hydrus.

The data belongs to this Gallery installation on the ComfyUI server. To preserve it when moving or updating the node, back up the local settings and memory files along with the customized code. A separate ComfyUI installation does not automatically share this memory.

Memory is separated by **API URL + Client profile**. Rotating the access key keeps the same history. Changing the address or profile switches to its separate history; switching back retrieves the previous records. If you move the same Hydrus database to a new address, its images can be rediscovered with a refresh.

### Local files and access key

These files live inside `custom_nodes/ComfyUI-Gallery`:

| File | Contents |
| --- | --- |
| `hydrus_settings.json` | Connection settings, including the access key. |
| `hydrus_memory.sqlite3` | File hashes, export history, and cached Hydrus metadata. |
| `user_settings.json` | Existing Gallery preferences. |

The access key is stored as plain text on the ComfyUI server. It is excluded from the public settings response and browser storage. Leave the key field blank to keep the saved key; use **Remove saved API key** to clear it. Protect these local files and keep them out of shared archives. Anyone who can use your ComfyUI instance can use its configured Hydrus bridge, so keep that instance within your intended users.

Stop ComfyUI before copying the SQLite memory for backup. The settings and memory files are excluded from Git and from the supplied clean package.

## Gallery performance

The image grid now loads previews with a maximum edge of 512 pixels instead of decoding every original at full resolution. Previews preserve aspect ratio, transparency, and EXIF orientation; animated images use their first frame in the grid. Opening an image, downloading it, dragging it into a workflow, and exporting to Hydrus continue to use the original. If a preview cannot be generated, the card falls back to the original image.

ComfyUI generates previews in two background workers and keeps a memory cache limited to 32 MiB and 512 entries. Cached previews are reused, replaced files invalidate their entries, and browser revalidation reduces repeat transfers. This cache creates no extra files on disk. The first view of an uncached image still requires reading and decoding its source.

Metadata and file updates preserve existing image cards rather than rebuilding the grid. Sorting is reused until its inputs change, selection uses direct lookups, and bulk context-menu targets are prepared when needed. Gallery startup issues one initial scan. The browser also reuses loaded Hydrus status during the session and requests status for changed files; reopening the Gallery no longer reloads the same status entries. Use the explicit refresh controls to fetch edits made in Hydrus.

These changes reduce repeated work. Initial folder scans, embedded-metadata reads, large originals, slow disks, and network transfers can still affect responsiveness. See [VALIDATION.md](VALIDATION.md) for measured checks and their limits.

## Connection and export problems

| Symptom | What to check |
| --- | --- |
| Connection refused or timed out | Hydrus is open, its API has the expected port, and ComfyUI can reach that address. |
| Access denied | Recopy the access key and check its permissions, including unrestricted file search. |
| Pages load but search fails | Run **Test connection** and read its separate search check. Confirm unrestricted Search for and Fetch Files permission and install this updated bundle; search now uses Hydrus-supported image-type aliases. |
| No tag services appear | Use **Reload tag services** in settings or **Reload services** in export. Check the address/key, and inspect any service-loading error. |
| Tag recommendations fail | Grant both file-search and tag-edit permissions. Manual tag entry can still be used. |
| Imported file, but tags or notes failed | Check the optional permission and chosen tag service, then retry with the required export options. |
| Previously deleted or vetoed | Review the file and import options in Hydrus. |
| Metadata differs from Hydrus | Refresh the cached status and inspect its last check time. |
| File export timed out | The file may already have arrived. Refresh its status before retrying. |
| A symlinked image cannot be exported | Select its actual folder as the Gallery root; export is limited to files inside the active root. |

The integration exports images. Other Gallery media types, including 3D models, remain available in the Gallery but are excluded from Hydrus selection.

## Development

The React source is in `web/src`. Use the pinned pnpm version from `web/package.json`. Rebuild from `web` with `pnpm install --frozen-lockfile` followed by `pnpm build`, then restart ComfyUI and reload its browser page. The custom node loads `web/dist/assets` through `WEB_DIRECTORY`.

Run backend and thumbnail tests with `python -m unittest discover -s tests -p "test_*.py"` using an environment with the node's Python dependencies installed. Tests use temporary files and a simulated Hydrus server. Run local-search and prompt-tag helper tests with `node tests/local_search.test.cjs` after installing the frontend dependencies. The customized source starts from upstream commit `74639e68846f64c9f561f3a7745529de76376a97`.

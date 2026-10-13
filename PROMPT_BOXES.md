# Gallery Prompt Encode: prompt boxes

The **Gallery Prompt Encode (Library)** node shows its prompt as boxes of tags instead of a text field.
Every edit is compiled into one prompt string, so the node still works as a normal CLIP text encoder.

## Boxes and chips

- **Tag chips**: comma-separated tags become individual chips. `(tag:1.2)` is a weighted chip, `(tag)` and `[tag]` keep their brackets.
- **Grouped chips** carry a coloured header naming their kind; inside, `|` separates options and `,` separates tags:
  - **Alternatives** `{a|b|c}`: exactly one of them.
  - **Optional alternatives** `{a|b|c|}`: one of them, or nothing.
  - **Optional group** `{a, b, c|}`: all of them together, or none. With a single tag (`{a|}`, `{(a, b)|}`) the header just says **Optional**.
- **Boxes** group chips. A box is named after the prefix it came from, otherwise `#1`, `#2`, ... Double-click the name to rename it.
  Boxes can be collapsed, switched off (they stay in the node but are left out of the prompt), reordered and deleted.
- **Source box**: the text connected to `source_text` (for example a Gallery Image Source prompt) is its own box,
  shown as separate tags. It can be moved, collapsed and switched off, but not deleted. Where it sits is where the source text goes.
  A source tag can be **left out** with its ×: it moves to the box's "Left out" row (click it there to put it back). The source itself,
  and the image lineage it came from, are unchanged; only this prompt drops the tag.

## Batch blacklist

Open **Batch blacklist** below a tag box, or in Gallery settings. Search the individual tags already present in the box and tick the ones to exclude, or enter names separated by commas or newlines, then click **Save batch blacklist**. Save an empty list to clear it. The list is saved immediately in this browser, shared across encoder/gallery editors and browser tabs, and survives reloads.

Select all, Ctrl/Cmd+A, Shift-click ranges, Ctrl/Cmd-click and selection mode all skip matching individual tags. Saving blacklist changes excludes those tags from any current batch action. Matching ignores case, spaces versus underscores, brackets and weights, and uses whole tag names rather than substrings. Groups are inspected recursively: protected tags remain in their original group while other tags can be removed, disabled or reformatted.

This controls batch selection, not generation filtering: it does not delete tags, alter source images, or prevent deliberate single-chip editing. Whole-box format remains an explicit operation on the entire box.

## Batch selection and box format

- **Select chips** turns ordinary clicks into selection toggles. Ctrl/Cmd-click also toggles individual chips; Shift-click selects a range from the last selection anchor.
- **Select all** picks the box's chips. Ctrl/Cmd+A does the same when the box or its empty add input has focus; a nonempty text input keeps normal text-selection behavior.
- The selection toolbar converts selected chips to tags, alternatives, optional alternatives, an optional group, or individually optional tags. It also enables, disables, removes, or clears the selection. Backspace in an empty add input removes the selection; Escape clears it.
- **Box format** controls the entire box, including future additions, without changing its underlying chips:

  | Format | Example for a, b, c |
  |---|---|
  | Comma-separated tags | `a, b, c` |
  | Alternatives | `{a|b|c}` |
  | Optional alternatives | `{a|b|c|}` |
  | Optional group | `{a, b, c|}` |
  | Optional tags (each) | `{a|}, {b|}, {c|}` |

  Switching back to comma-separated tags restores the original chips. Disabled chips do not enter the compiled prompt. Encoder workflows store the box format; gallery prefixes save the resulting syntax and reopen it as grouped chips. Both surfaces offer the same batch controls.

## Editing

- Click unused space in a tag box to focus its input (a collapsed box expands). With an empty input,
  Backspace removes the selected chip, or the last chip when none is selected. Holding Backspace does not
  remove a whole list. Double-click a chip to remove it; the existing × buttons remain available.
- Drag chips between boxes to move them. Dragging to a separate encoder or gallery term editor copies the
  chip with its grouping, brackets and weight. Source and image-prompt chips can also be dragged as copies.
- Drop onto **Source** to add to its paired saved prefix, on the connected positive or negative side.
  If multiple prefixes contribute, choose the destination in **Source prefix drop target** first.
  You can also type into **Add tags to source prefix**. These additions save immediately to the shared
  library; failures appear in the source box. Removing a source chip still only excludes it from this encoder.
- The gallery's **Use for prefix** window displays draggable chips using saved prompt templates where
  available, preserving alternatives and optional groups. Image search and Hydrus export continue to use
  the actual resolved prompt. Images without saved templates cannot recover their original grouping.
- Type into a box's input to add tags (Enter adds everything typed; a comma ends a tag unless a bracket is still open).
  Suggestions come from your saved prefixes and tags and from the Danbooru dictionary. Picking a prefix adds its terms.
- Prompt syntax can be typed directly. Suggestions keep working after `{`, `(` and `|`, and **closing the brackets adds the chip**
  without Enter: `{red hair|}`, `{(red hair, blue eyes)|}`, `(red hair:1.2)`. A preview above the input shows what will be added.
- **Keywords** (upper case only, so a tag like "salt and pepper hair" stays a tag) relate the tags of one chip:

  | Typed | Becomes |
  |---|---|
  | `a OPT` | `{a\|}` — a or nothing |
  | `a OR b` | `{a\|b}` |
  | `a OR b OPT` | `{a\|b\|}` |
  | `a AND b` | `a, b` |
  | `a AND b OPT` | `{a, b\|}` — both or neither |
  | `a AND b OR c` | `{a, b\|c}` (AND binds tighter) |

  Each comma-separated part is read on its own: `a OPT, b OPT` is `{a|}, {b|}`. Keywords inside brackets are left as typed.
- **Add as** next to the input: Tags, Alternatives, Optional alternatives, Optional group, or **Optional tags (each)**, which makes
  every typed tag optional on its own (`{a|}, {b|}`; also a palette insertion format). In the grouped modes, commas and picked
  suggestions collect tags into a draft chip; Enter adds it.
- Grouped chips are edited in place: the kind menu in the coloured header switches between Alternatives, Optional
  alternatives, Optional group and **Optional** (every tag optional on its own — a chip with several tags splits into
  one `{a|}` chip per tag), × on a part removes it, + adds parts (with suggestions; `a | b` or `a OR b` adds several options).
  Clicking a chip opens its remaining settings (weight, on/off, split, move). Plain tags get the same kinds in that editor.
  Switching kinds keeps the tags: a chip never turns into one comma-separated option.
- **Exclusive tags** (experimental gallery setting, with an editable list of tag sets):
  - *Turn off*: adding or switching on a single tag turns off the single tags that exclude it (long hair turns off
    short hair, 1girl turns off 2girls), with a note under the boxes. Palette picks behave the same.
  - *Never together*: conflicting tags can all be added. Optional ones (`{long hair|}`, `{short hair|}`) are sent as one
    group, `{long hair|short hair|}`, so each run uses at most one; the boxes keep them as separate chips. Tags that are
    always used cannot be resolved and are pointed out under the boxes.
  Danbooru's wiki groups only list related tags, not exclusive ones, so the sets are a list of their own
  (`data/exclusive-tags.json`, edited copy per ComfyUI user).
- Shift/Ctrl/Cmd-click several chips, then use **Convert selection** to change their grouping.
- The input at the bottom creates a new box.
- Click a chip to edit its text, weight, brackets, "or nothing" and on/off state.
- **Drag** a chip to reorder it or to move it into another box (drop on a chip to land before or after it, on a box to land at the end).
  Drag a box by its grip (⠿) to reorder boxes. The ▲ ▼ ◀ ▶ buttons do the same from the keyboard.
- "Prompt sent to the encoder" at the bottom shows exactly what is encoded, with the source text filled in when it is known.

## Prefix terms

The prefix editor (and "Use for prefix") edits a prefix's terms with the same chips and typing helpers, so a prefix
can carry structure, e.g. a LoRA prefix `activator tag, {tag1|}, {(tag2, tag3)|}, (tag4:0.5)`. Each chip is one
saved term; commas inside a group never split it. When a prefix is searched, its terms are read as conditions: plain
tags are required (weights ignored), `{a|b}` needs one of its options, optional parts are not required — next to
the paired images and their lineage.

## Library appends

Everything appended from the prompt library (or from image-prompt appends) arrives as its own box:
named after the prefix when prefixes were used, otherwise `#n`. "Append after" puts the box last, "Prepend before" puts it first.

## How it is stored

- The boxes are saved on the node (`properties.prompt_boxes`) and travel with the workflow.
- The hidden `text` widget holds the compiled prompt, with `⟦source⟧` marking the source box. Left-out source tags ride in the
  marker as a JSON list, `⟦source -["tag a","tag b"]⟧` (braces, pipes and slashes JSON-escaped so ComfyUI's dynamic prompts leave them alone).
  ComfyUI resolves `{a|b|c}` dynamic prompts in it when the workflow is queued.
- `source_mode` is set to `boxes`; the backend then replaces the marker with the connected `source_text`
  minus the left-out tags (no marker, or a disabled source box, means the source text is not used). The run record
  (`gallery_prompts` in the saved image) lists them as `source_excluded`.
- A source image that is paired with a prefix is stamped with that prefix (`gallery_prefix`) when it is appended to a
  Gallery Image Source, so images generated from it count toward the prefix's lineage in the image search.
- Workflows made before the box editor open with their text in box `#1`, and the old before/after/replace setting becomes the source box position.

## Additional group controls

Collapse **Tag groups** independently of the box to reach controls below while leaving its entry field writable. Fresh terms use an existing empty group box before creating another one. Enter `-tag` in a box or group input to remove that tag (matching case, underscores, brackets and weights); source-prefix entry applies the same removal to its paired saved prefix.

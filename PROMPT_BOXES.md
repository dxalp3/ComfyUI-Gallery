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

## Editing

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
- **Exclusive tags** (experimental gallery setting): adding or switching on a single tag turns off the single tags that
  exclude it (long hair turns off short hair, 1girl turns off 2girls), with a note under the boxes. The sets are a small
  curated list (`TagConflicts.ts`); Danbooru's wiki groups only list related tags, not exclusive ones.
- Shift/Ctrl-click several chips to combine them into one grouped chip.
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

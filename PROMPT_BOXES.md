# Gallery Prompt Encode: prompt boxes

The **Gallery Prompt Encode (Library)** node shows its prompt as boxes of tags instead of a text field.
Every edit is compiled into one prompt string, so the node still works as a normal CLIP text encoder.

## Boxes and chips

- **Tag chips**: comma-separated tags become individual chips. `(tag:1.2)` is a weighted chip, `(tag)` and `[tag]` keep their brackets.
- **Alternatives**: `{a|b|c}` is one chip meaning "a or b or c". `{a|b|c|}` adds "or nothing" (optional). `{a, b, c|}` keeps several tags together as one optional unit.
- **Boxes** group chips. A box is named after the prefix it came from, otherwise `#1`, `#2`, ... Double-click the name to rename it.
  Boxes can be collapsed, switched off (they stay in the node but are left out of the prompt), reordered and deleted.
- **Source box**: the text connected to `source_text` (for example a Gallery Image Source prompt) is its own box,
  shown as separate read-only tags. It can be moved, collapsed and switched off, but not deleted. Where it sits is where the source text goes.

## Editing

- Type into a box's input to add tags (Enter adds everything typed; a comma ends a tag unless a bracket is still open).
  Suggestions come from your saved prefixes and tags and from the Danbooru dictionary. Picking a prefix adds its terms.
- The input at the bottom creates a new box.
- Click a chip to edit its text, weight, brackets, "or nothing" and on/off state.
- **Drag** a chip to reorder it or to move it into another box (drop on a chip to land before or after it, on a box to land at the end).
  Drag a box by its grip (⠿) to reorder boxes. The ▲ ▼ ◀ ▶ buttons do the same from the keyboard.
- "Prompt sent to the encoder" at the bottom shows exactly what is encoded, with the source text filled in when it is known.

## Library appends

Everything appended from the prompt library (or from image-prompt appends) arrives as its own box:
named after the prefix when prefixes were used, otherwise `#n`. "Append after" puts the box last, "Prepend before" puts it first.

## How it is stored

- The boxes are saved on the node (`properties.prompt_boxes`) and travel with the workflow.
- The hidden `text` widget holds the compiled prompt, with `⟦source⟧` marking the source box.
  ComfyUI resolves `{a|b|c}` dynamic prompts in it when the workflow is queued.
- `source_mode` is set to `boxes`; the backend then replaces the marker with the connected `source_text`
  (no marker, or a disabled source box, means the source text is not used).
- Workflows made before the box editor open with their text in box `#1`, and the old before/after/replace setting becomes the source box position.

`solid-colours.webm` is an original synthetic QA fixture: two 160×120 solid blue
and green VP8 frames, 500 ms each, in a WebM container. The frames were encoded
with Pillow's lossy WebP encoder and their VP8 chunks muxed into a minimal WebM.
It contains no user media or external assets. The browser test serves it from
an intercepted local URL to verify decoding and video controls.

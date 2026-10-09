/**
 * Hide a widget that must keep its value and serialization (the encoder's `text`, the image source's `sources`)
 * behind our own editor. Newer ComfyUI frontends draw DOM widgets (multiline text) themselves and look at
 * `options.hidden`; older ones honour `hidden` and the size; the element is hidden too in case neither runs.
 */
export function hideWidget(widget: any) {
    if (!widget) return;
    widget.hidden = true;
    widget.options ||= {};
    widget.options.hidden = true;
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    for (const element of [widget.inputEl, widget.element]) if (element?.style) element.style.display = 'none';
}

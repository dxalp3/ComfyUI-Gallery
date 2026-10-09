import { imageOrigin, stampOrigin, type ImageSourceImage } from './ImageSourceGeometry';

export const SOURCE_HISTORY_LIMIT = 128;
export const SOURCE_STRIP_LIMIT = 5;
export type HistoryTab = 'all' | 'imported' | 'generated';

/** Oldest first, unique by input path. Selection/crop edits do not reorder history. */
export function mergeSourceHistory(previous: unknown, images: ImageSourceImage[]): ImageSourceImage[] {
    const entries = new Map<string, ImageSourceImage>();
    for (const image of [...(Array.isArray(previous) ? previous : []), ...images]) {
        if (!image || typeof image.input_name !== 'string' || !image.input_name) continue;
        entries.set(image.input_name, stampOrigin(image));
    }
    return [...entries.values()].slice(-SOURCE_HISTORY_LIMIT);
}

export function filterSourceHistory(images: ImageSourceImage[], tab: HistoryTab, query: string, newest: boolean) {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = images.filter(image =>
        (tab === 'all' || (imageOrigin(image) === 'gallery' ? 'generated' : 'imported') === tab) &&
        (!needle || `${image.title || ''} ${image.input_name}`.toLocaleLowerCase().includes(needle)));
    return newest ? filtered.reverse() : filtered;
}

export function sourceStripRange(count: number, focused: number) {
    const start = Math.max(0, Math.min(focused - Math.floor(SOURCE_STRIP_LIMIT / 2), count - SOURCE_STRIP_LIMIT));
    return { start, end: Math.min(count, start + SOURCE_STRIP_LIMIT) };
}

export type PickerRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export function sourcePickerPlacement(anchor: PickerRect, viewport: { width: number; height: number }) {
    const margin = 8, gap = 7;
    const width = Math.min(Math.max(320, Math.min(420, anchor.width)), viewport.width - margin * 2);
    const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
    const above = Math.max(0, anchor.top - gap - margin);
    const side = below >= 300 || below >= above ? 'below' : 'above';
    const maxHeight = Math.min(460, side === 'below' ? below : above);
    const left = Math.max(margin, Math.min(anchor.left, viewport.width - width - margin));
    return { left, width, maxHeight, side,
        top: side === 'below' ? anchor.bottom + gap : undefined,
        bottom: side === 'above' ? viewport.height - anchor.top + gap : undefined,
        arrow: Math.max(16, Math.min(width - 16, anchor.left + anchor.width / 2 - left)) };
}

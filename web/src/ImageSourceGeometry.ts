export type ImageSourceCrop = { x: number; y: number; width: number; height: number };
export type ImageSourceImage = { input_name: string; title?: string; crop?: ImageSourceCrop };
export type ImageSourceManifest = {
    version: 1;
    images: ImageSourceImage[];
    layout: 'single' | 'horizontal' | 'vertical' | 'grid';
    columns: number;
    gap: number;
    background: string;
};

export function emptyImageSourceManifest(): ImageSourceManifest {
    return { version: 1, images: [], layout: 'single', columns: 2, gap: 0, background: '#000000' };
}

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const bounded = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Keep all four crop edges inside the source, including after numeric edits. */
export function clampCrop(crop?: ImageSourceCrop, dimensions?: { width: number; height: number }): ImageSourceCrop {
    const minWidth = dimensions?.width ? 1 / dimensions.width : 0.000001;
    const minHeight = dimensions?.height ? 1 / dimensions.height : 0.000001;
    const x = bounded(finite(crop?.x ?? 0, 0), 0, 1 - minWidth);
    const y = bounded(finite(crop?.y ?? 0, 0), 0, 1 - minHeight);
    return {
        x, y,
        width: bounded(finite(crop?.width ?? 1, 1), minWidth, 1 - x),
        height: bounded(finite(crop?.height ?? 1, 1), minHeight, 1 - y),
    };
}

/** Pointer drags work in either direction, and may finish outside the image. */
export function cropFromPoints(start: { x: number; y: number }, end: { x: number; y: number }, dimensions?: { width: number; height: number }): ImageSourceCrop {
    const ax = bounded(start.x, 0, 1), ay = bounded(start.y, 0, 1);
    const bx = bounded(end.x, 0, 1), by = bounded(end.y, 0, 1);
    return clampCrop({ x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(ax - bx), height: Math.abs(ay - by) }, dimensions);
}

export function sourceImageUrl(inputName: string): string {
    const normalized = inputName.replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    const query = new URLSearchParams({ filename: normalized.slice(slash + 1), subfolder: slash < 0 ? '' : normalized.slice(0, slash), type: 'input' });
    return `/view?${query}`;
}

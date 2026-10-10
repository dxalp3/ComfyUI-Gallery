export type ImageSourceCrop = { x: number; y: number; width: number; height: number };
export type ImageSourceImage = { input_name: string; title?: string; crop?: ImageSourceCrop; metadata?: Record<string, any>; prompt?: { positive: string; negative: string; tags: string[] } };
export type ImageOrigin = 'gallery' | 'hydrus' | 'external';
export const ORIGIN_STYLE = {
    gallery: { label: 'Gallery', color: '#4096ff' },
    hydrus: { label: 'Hydrus', color: '#b37feb' },
    external: { label: 'External', color: '#ff7a45' },
};
export function imageOrigin(image: ImageSourceImage): ImageOrigin {
    const explicit = image.metadata?.gallery_origin;
    // Older input imports stamped Hydrus copies as gallery files after moving them to gallery_sources.
    if (!image.metadata?.gallery_url && (image.metadata?.hydrus || image.input_name.replace(/\\/g, '/').startsWith('hydrus/'))) return 'hydrus';
    if (explicit === 'gallery' || explicit === 'hydrus' || explicit === 'external') return explicit;
    const name = image.input_name.replace(/\\/g, '/');
    if (name.startsWith('hydrus/') || image.metadata?.hydrus) return 'hydrus';
    return name.startsWith('gallery_sources/') ? 'gallery' : 'external';
}
export function stampOrigin(image: ImageSourceImage, origin = imageOrigin(image)): ImageSourceImage {
    return { ...image, metadata: { ...image.metadata, gallery_origin: origin } };
}
export type ImageSourceManifest = {
    version: 1;
    active_index?: number;
    /** Selected inputs for the separate batch IMAGE output; omitted means all. */
    batch_indices?: number[];
    images: ImageSourceImage[];
    layout: 'single' | 'horizontal' | 'vertical' | 'grid';
    columns: number;
    gap: number;
    background: string;
};

export function emptyImageSourceManifest(): ImageSourceManifest {
    return { version: 1, images: [], layout: 'single', columns: 2, gap: 0, background: '#000000' };
}

/** Preserve the selected image when an earlier entry is removed. */
export function removeSourceImage(manifest: ImageSourceManifest, index: number): ImageSourceManifest {
    if (index < 0 || index >= manifest.images.length) return manifest;
    const images = manifest.images.filter((_, at) => at !== index);
    const active = manifest.active_index || 0;
    const batch = manifest.batch_indices?.filter(at => at !== index).map(at => at > index ? at - 1 : at);
    return { ...manifest, images, batch_indices: batch?.length ? batch : undefined, active_index: Math.max(0, Math.min(active - (index < active ? 1 : 0), images.length - 1)) };
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

export type PromptApply = { positive?: string; negative?: string; mode: 'replace' | 'before' | 'after' };
export function mergePrompt(old: string, added: string, mode: PromptApply['mode']) {
    if (!added.trim()) return old;
    return mode === 'replace' ? added : (mode === 'before' ? [added, old] : [old, added]).filter(Boolean).join(', ');
}

export function sourcePrompt(manifest: ImageSourceManifest, side: 'positive' | 'negative'): string {
    const images = manifest.layout === 'single' ? manifest.images.slice(manifest.active_index || 0, (manifest.active_index || 0) + 1) : manifest.images;
    return images.map(image => image.prompt?.[side] || '').filter(Boolean).join(', ');
}

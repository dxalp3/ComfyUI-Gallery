import type { PrefixImage, PrefixLibrary } from './PrefixLibrary';

/** Every image paired with a prefix (library associations are keyed by Hydrus hash or local path). */
export function collectPrefixImages(library: PrefixLibrary, prefixId: string): PrefixImage[] {
    const images = new Map<string, PrefixImage>();
    for (const [key, item] of Object.entries(library.associations || {})) {
        if (item.prefix_id !== prefixId) continue;
        let image = item.image;
        if (!image && key.startsWith('sha256:')) image = { hash: key.slice(7) };
        if (!image && key.startsWith('local:')) { const at = key.lastIndexOf(':/static_gallery/'); if (at > 0) image = { root: key.slice(6, at), local_url: key.slice(at + 1) }; }
        if (!image) continue;
        const id = image.hash || (image.root || '') + image.local_url;
        const known = images.get(id);
        images.set(id, { ...known, ...image, keys: [...(known?.keys || []), key] });
    }
    return [...images.values()];
}


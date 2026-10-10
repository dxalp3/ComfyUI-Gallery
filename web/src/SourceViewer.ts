import { imageOrigin, sourceImageUrl, type ImageSourceImage } from './ImageSourceGeometry';
import type { FileDetails } from './types';
import type { GalleryEntry } from './GalleryOrder';

export async function recoverStoredSourceMetadata(images: ImageSourceImage[], read: (names: string[]) => Promise<Record<string, Record<string, any>>>) {
    const metadata = await read([...new Set(images.map(image => image.input_name))]);
    return images.map(image => {
        const saved = metadata[image.input_name];
        if (!saved) return image;
        // Workflow edits to prompts/prefixes take precedence; saved provenance repairs legacy imports.
        return { ...image, metadata: { ...saved, ...image.metadata,
            ...(saved.hydrus ? { hydrus: saved.hydrus } : {}),
            ...(saved.gallery_url && !image.metadata?.gallery_url ? { gallery_url: saved.gallery_url } : {}) } };
    });
}

/** A known original remains a gallery asset even when the current folder/index omits it. */
export function sourceViewerEntry(image: ImageSourceImage, files: FileDetails[], localEntry: (file: FileDetails) => GalleryEntry): GalleryEntry {
    const original: string | undefined = image.metadata?.gallery_url;
    const file = original && files.find(file => file.url === original);
    if (file) return localEntry(file);
    if (original?.startsWith('/static_gallery/') && imageOrigin(image) === 'gallery') return localEntry({
        name: image.title || decodeURIComponent(original.split('/').pop()!), url: original, timestamp: 0, date: '', type: 'image',
        metadata: image.metadata as FileDetails['metadata'],
    });
    const url = sourceImageUrl(image.input_name);
    const cached = image.metadata?.hydrus;
    const hash = cached?.hash || (imageOrigin(image) === 'hydrus' ? /([a-f0-9]{64})/i.exec(image.input_name)?.[1] : undefined);
    if (typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash)) {
        const extension = image.input_name.split('.').pop()?.toLowerCase();
        const remote = { file_id: 0, width: 0, height: 0, mime: extension === 'jpg' ? 'image/jpeg' : 'image/' + (extension || 'png'), ...cached, hash: hash.toLowerCase() };
        return { id: 'hydrus:' + remote.hash, source: 'hydrus', name: image.title || 'Hydrus ' + remote.hash.slice(0,12), hash: remote.hash, mime: remote.mime, remote, previewUrl: url };
    }
    return { id: 'local:' + url, source: 'node', name: image.title || image.input_name,
        local: { name: image.title || image.input_name, url, timestamp: 0, date: '', type: 'image', metadata: image.metadata as FileDetails['metadata'] || { fileinfo: { filename: '', resolution: '', date: '', size: '' } } } };
}

/** Old workflows lack original URLs. Verify candidate names against the copied image's content hash. */
export async function recoverSourceOriginals(images: ImageSourceImage[], files: FileDetails[], hashes: (urls: string[]) => Promise<Record<string, string>>) {
    const missing = images.filter(image => imageOrigin(image) === 'gallery' && !image.metadata?.gallery_url && /[a-f0-9]{64}/i.test(image.input_name));
    if (!missing.length) return images;
    const candidates = files.filter(file => missing.some(image => file.name === image.title));
    const values = candidates.length ? await hashes([...new Set(candidates.map(file => file.url))]) : {};
    // Names can change after import. Scan remaining indexed assets only when the fast lookup misses.
    const wanted = missing.map(image => /([a-f0-9]{64})/i.exec(image.input_name)![1].toLowerCase());
    if (wanted.some(hash => !Object.values(values).some(value => value.toLowerCase() === hash))) {
        const remaining = files.filter(file => file.type === 'image' && !candidates.includes(file));
        if (remaining.length) Object.assign(values, await hashes([...new Set(remaining.map(file => file.url))]));
    }
    return images.map(image => {
        if (!missing.includes(image)) return image;
        const hash = /([a-f0-9]{64})/i.exec(image.input_name)![1].toLowerCase();
        const match = files.find(file => values[file.url]?.toLowerCase() === hash);
        return match ? { ...image, metadata: { ...image.metadata, gallery_url: match.url } } : image;
    });
}

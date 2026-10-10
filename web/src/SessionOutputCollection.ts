import type { FileDetails } from './types';
export type OutputImage = { filename: string; subfolder?: string; type?: string };
export function collectSessionOutputs(previous: FileDetails[], output: unknown, now = Date.now()): FileDetails[] {
    const images = (output as { images?: OutputImage[] })?.images;
    if (!Array.isArray(images)) return previous;
    const entries = new Map([...previous].reverse().map(file => [file.url, file]));
    for (const image of images) {
        if (!image || typeof image.filename !== 'string' || !image.filename || (image.type && !['output','temp'].includes(image.type))) continue;
        const path = [...(image.subfolder || '').replace(/\\/g, '/').split('/').filter(Boolean), image.filename];
        if (path.some(part => part === '..' || part === '.')) continue;
        const url = image.type === 'temp'
            ? '/view?' + new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: 'temp' }).toString()
            : '/static_gallery/' + path.map(encodeURIComponent).join('/');
        entries.delete(url);
        entries.set(url, { name: image.filename, url, timestamp: now / 1000, date: new Date(now).toISOString(), type: 'image',
            metadata: { fileinfo: { filename: image.filename, resolution: '', date: new Date(now).toISOString(), size: '' } } });
    }
    return [...entries.values()].reverse();
}

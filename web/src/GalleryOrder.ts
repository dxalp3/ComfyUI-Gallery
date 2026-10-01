import type { FileDetails } from './types';
import type { RemoteImage } from './HydrusBrowser';
export type GalleryEntry = { id: string; source: string; name: string; date?: number; mime?: string; hash?: string; local?: FileDetails; remote?: RemoteImage };
export type GalleryOrder = 'date' | 'name' | 'mime' | 'hash' | 'random' | 'result';
function randomKey(id: string, seed: number) {
    let value = seed | 0;
    for (const char of id) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    value ^= value >>> 16; value = Math.imul(value, 0x45d9f3b); value ^= value >>> 16;
    return value >>> 0;
}
export function orderGallery(entries: GalleryEntry[], order: GalleryOrder, ascending: boolean, seed: number): GalleryEntry[] {
    if (order === 'result') return entries;
    return [...entries].sort((a, b) => {
        if (order === 'random') return randomKey(a.id, seed) - randomKey(b.id, seed) || a.id.localeCompare(b.id);
        const av = a[order], bv = b[order];
        const missingA = av === undefined || av === '' || (order === 'date' && !av);
        const missingB = bv === undefined || bv === '' || (order === 'date' && !bv);
        if (missingA !== missingB) return missingA ? 1 : -1;
        const compare = order === 'date' ? Number(av || 0) - Number(bv || 0) : String(av || '').localeCompare(String(bv || ''));
        return (ascending ? compare : -compare) || a.id.localeCompare(b.id);
    });
}

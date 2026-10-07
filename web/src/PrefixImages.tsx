import type { PrefixImage, PrefixLibrary } from './PrefixLibrary';
import { collectPrefixImages } from './PrefixAssociations';
import { useHydrus } from './HydrusContext';
import { BASE_PATH } from './ComfyAppApi';

export { collectPrefixImages } from './PrefixAssociations';

/** The image(s) a new prefix is being created from. One image has a hash key and a path key; merge them. */
export function seedImages(refs?: Record<string, PrefixImage>): PrefixImage[] {
    const merged = new Map<string, PrefixImage>();
    for (const ref of Object.values(refs || {})) {
        const key = ref.name || ref.hash || ref.local_url || '';
        merged.set(key, { ...merged.get(key), ...ref });
    }
    return [...merged.values()];
}

export function PrefixImageGrid({ images, onRemove }: { images: PrefixImage[]; onRemove?: (image: PrefixImage) => void }) {
    const hydrus = useHydrus();
    const target = encodeURIComponent(`${hydrus.settings?.url}|${hydrus.settings?.profile}`);
    return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 230, overflowY: 'auto' }}>
        {images.map((image, index) => {
            const local = image.local_url?.startsWith('/') && !image.local_url.startsWith('//') ? image.local_url : undefined;
            const hash = /^[a-f0-9]{64}$/i.test(image.hash || '') ? image.hash : undefined;
            const original = local ? BASE_PATH + local : hash ? `${BASE_PATH}/Gallery/hydrus/original?hash=${hash}&target=${target}` : undefined;
            const thumbnail = local ? `${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(local)}&root=${encodeURIComponent(image.root || './')}` : `${BASE_PATH}/Gallery/hydrus/thumbnail?hash=${hash}&target=${target}`;
            return original && <div key={(image.hash || image.local_url || '') + index} style={{ width: 110, position: 'relative' }}>
                <a href={original} target="_blank" rel="noreferrer" title="Open associated original image" style={{ color: 'inherit' }}><img loading="lazy" src={thumbnail} alt={'Image: ' + (image.name || local || hash)} style={{ width: 110, height: 90, objectFit: 'contain' }} /><div style={{ overflowWrap: 'anywhere', fontSize: 11 }}>{image.name || 'Associated image'}</div></a>
                {onRemove && <button type="button" aria-label={'Unpair ' + (image.name || 'image')} title="Unpair this image from the prefix" onClick={() => onRemove(image)} style={{ position: 'absolute', top: 2, right: 2, border: 0, borderRadius: 10, background: '#000a', color: '#fff', cursor: 'pointer', width: 20, height: 20, lineHeight: '18px', padding: 0 }}>×</button>}
            </div>;
        })}
    </div>;
}

export function PrefixImages({ library, prefixId, defaultOpen = false, onRemove }: { library: PrefixLibrary; prefixId: string; defaultOpen?: boolean; onRemove?: (image: PrefixImage) => void }) {
    const images = collectPrefixImages(library, prefixId);
    if (!images.length) return null;
    return <details open={defaultOpen} style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer' }}>Associated images ({images.length})</summary><PrefixImageGrid images={images} onRemove={onRemove} /></details>;
}

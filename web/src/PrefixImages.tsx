import type { PrefixImage, PrefixLibrary } from './PrefixLibrary';
import { useHydrus } from './HydrusContext';
import { BASE_PATH } from './ComfyAppApi';

export function PrefixImages({ library, prefixId }: { library: PrefixLibrary; prefixId: string }) {
    const hydrus = useHydrus();
    const images = new Map<string, PrefixImage>();
    for (const [key, item] of Object.entries(library.associations || {})) {
        if (item.prefix_id !== prefixId) continue;
        let image = item.image;
        if (!image && key.startsWith('sha256:')) image = { hash: key.slice(7) };
        if (!image && key.startsWith('local:')) { const at = key.lastIndexOf(':/static_gallery/'); if (at > 0) image = { root: key.slice(6, at), local_url: key.slice(at + 1) }; }
        if (image) images.set(image.hash || (image.root || '') + image.local_url, image);
    }
    if (!images.size) return null;
    const target = encodeURIComponent(`${hydrus.settings?.url}|${hydrus.settings?.profile}`);
    return <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer' }}>Associated images ({images.size})</summary><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 230, overflowY: 'auto' }}>
        {[...images.entries()].map(([key, image]) => {
            const local = image.local_url?.startsWith('/') && !image.local_url.startsWith('//') ? image.local_url : undefined;
            const hash = /^[a-f0-9]{64}$/i.test(image.hash || '') ? image.hash : undefined;
            const original = local ? BASE_PATH + local : hash ? `${BASE_PATH}/Gallery/hydrus/original?hash=${hash}&target=${target}` : undefined;
            const thumbnail = local ? `${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(local)}&root=${encodeURIComponent(image.root || './')}` : `${BASE_PATH}/Gallery/hydrus/thumbnail?hash=${hash}&target=${target}`;
            return original && <a key={key} href={original} target="_blank" rel="noreferrer" title="Open associated original image" style={{ width: 110, color: 'inherit' }}><img loading="lazy" src={thumbnail} alt={'Associated image: ' + (image.name || local || hash)} style={{ width: 110, height: 90, objectFit: 'contain' }} /><div style={{ overflowWrap: 'anywhere', fontSize: 11 }}>{image.name || 'Associated image'}</div></a>;
        })}
    </div></details>;
}

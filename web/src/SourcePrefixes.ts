import type { ImageSourceImage } from './ImageSourceGeometry';
import type { PrefixLibrary } from './PrefixLibrary';
import { splitTop } from './PromptBoxes';

const key = (text: string) => text.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
/** Replace only the paired prefix's contribution, retaining unrelated prompt edits. */
export function refreshSourcePrefix(image: ImageSourceImage, library: PrefixLibrary, url?: string): ImageSourceImage {
    const old = image.metadata?.gallery_prefix;
    const hash = /([a-f0-9]{64})/i.exec(image.input_name)?.[1]?.toLowerCase();
    url ||= image.metadata?.gallery_url;
    const pair = Object.entries(library.associations || {}).find(([id, item]) =>
        (hash && (id === 'sha256:' + hash || item.image?.hash?.toLowerCase() === hash)) || (url && id.startsWith('local:') && id.endsWith(':' + url)))?.[1];
    const prefix = library.prefixes.find(item => item.id === (old?.id || pair?.prefix_id));
    url ||= pair?.image?.local_url;
    if (!prefix) {
        if (!old) return image;
        const metadata = { ...image.metadata }; delete metadata.gallery_prefix;
        return { ...image, metadata }; // Deletion unpairs; existing workflow text remains editable.
    }
    const terms = (values: string[]) => values.flatMap(text => text.split(/\n+/).flatMap(line => splitTop(line, ','))).map(text => text.trim()).filter(Boolean);
    const positive = terms(prefix.tags.map(id => library.tags.find(tag => tag.id === id)?.text || ''));
    const negative = terms(prefix.negative_terms || []);
    const update = (side: 'positive' | 'negative', next: string[]) => {
        const current = image.prompt?.[side] || '';
        const previous: string[] = Array.isArray(old?.[side]) ? old[side] : [];
        const enabled = old?.[side + '_enabled'] ?? (!old || !!current || previous.length === 0);
        if (!enabled) return current;
        const previousKeys = new Set(terms(previous).map(key));
        const kept = splitTop(current, ',').map(s => s.trim()).filter(s => s && !previousKeys.has(key(s)));
        return [...new Map([...kept, ...next].map(s => [key(s), s])).values()].join(', ');
    };
    return { ...image, metadata: { ...image.metadata, ...(url ? { gallery_url: url } : {}), gallery_prefix: { ...old, id: prefix.id, paired: true, positive, negative } },
        prompt: { positive: update('positive', positive), negative: update('negative', negative), tags: image.prompt?.tags || [] } };
}

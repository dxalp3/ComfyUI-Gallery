/**
 * "Find images" for a prefix: the images paired with it, plus every image generated from one of those
 * (through Gallery Image Source), whatever prompt the generation used. Generations of generations count too.
 *
 * Links between images are by SHA-256: Gallery Image Source copies its inputs as `<sha256>.<ext>`, Hydrus
 * identifies files by the same hash, and local gallery files are hashed by the backend on demand. Images
 * appended through "Append images and prompts" also carry the prefix id itself, which links them directly.
 */
import type { FileDetails } from './types';
import type { PrefixLibrary } from './PrefixLibrary';
import { collectPrefixImages } from './PrefixAssociations';
import { metadataSources } from './PromptResolution';
import { extractHydrusTags, extractLocalPrompts } from './LocalImageSearch';
import { stripUnresolved } from './PromptResolution';
import { splitTop } from './PromptBoxes';

const HASH = /([a-f0-9]{64})/i;
function object(value: unknown): Record<string, any> {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export type SourceLinks = { hashes: string[]; prefixIds: string[] };

/** The images a generation was made from: every Gallery Image Source in its prompt (or workflow). */
export function sourceLinks(metadata: unknown): SourceLinks {
    const sources = metadataSources(metadata);
    const manifests: Record<string, any>[] = [];
    for (const node of Object.values(object(sources.prompt))) {
        if (node && typeof node === 'object' && (node as any).class_type === 'GalleryImageSource') manifests.push(object((node as any).inputs?.sources));
    }
    if (!manifests.length) {
        const workflow = object(sources.workflow);
        for (const node of Array.isArray(workflow.nodes) ? workflow.nodes : []) if (node?.type === 'GalleryImageSource') manifests.push(object(node.widgets_values?.[0]));
    }
    const hashes = new Set<string>(), prefixIds = new Set<string>();
    for (const manifest of manifests) {
        const images: any[] = Array.isArray(manifest.images) ? manifest.images : [];
        const used = manifest.layout === 'single' ? images.slice(manifest.active_index || 0, (manifest.active_index || 0) + 1) : images;
        for (const image of used) {
            const match = HASH.exec(String(image?.input_name || ''));
            if (match) hashes.add(match[1].toLowerCase());
            const prefix = object(image?.metadata).gallery_prefix;
            if (typeof prefix?.id === 'string') prefixIds.add(prefix.id);
        }
    }
    return { hashes: [...hashes], prefixIds: [...prefixIds] };
}

export type LineageResult = {
    /** Local images paired with the prefix. */
    paired: FileDetails[];
    /** Local images generated from a paired image (or from such a generation), with their generation depth. */
    generated: { file: FileDetails; depth: number }[];
    /** Paired images that exist only in Hydrus. */
    remotePaired: number;
};

const linkCache = new WeakMap<object, SourceLinks>();
const linksOf = (file: FileDetails) => {
    const metadata = file.metadata as unknown;
    if (metadata && typeof metadata === 'object') {
        let links = linkCache.get(metadata);
        if (!links) { links = sourceLinks(metadata); linkCache.set(metadata, links); }
        return links;
    }
    return sourceLinks(metadata);
};

export type HashLookup = (urls: string[]) => Promise<Record<string, string>>;

/** Hashes for local files: the ones Hydrus exports already know, the rest from the backend. */
export function hashLookup(fetchHashes: HashLookup, knownHashes: Record<string, string | undefined> = {}): HashLookup {
    const cache: Record<string, string> = {};
    return async urls => {
        const result: Record<string, string> = {};
        const missing: string[] = [];
        for (const url of urls) {
            const hash = cache[url] || knownHashes[url];
            if (hash) result[url] = hash.toLowerCase(); else missing.push(url);
        }
        if (missing.length) for (const [url, hash] of Object.entries(await fetchHashes(missing))) { cache[url] = hash.toLowerCase(); result[url] = cache[url]; }
        return result;
    };
}

export type LineageNode = { depth: number; parents: string[] };
export type LineageTree = {
    /** url → generation depth and the hashes of the images it was made from directly */
    nodes: Map<string, LineageNode>;
    /** hash → local url, for the seeds and every generated image */
    hashToUrl: Map<string, string>;
    /** generated images that were themselves used as a source */
    usedAsSource: Set<string>;
};

/**
 * Every local image generated (directly or through further generations) from one of `seedHashes`,
 * or from an image appended under one of `seedPrefixIds`, with the images each was made from.
 */
export async function lineageTree(files: FileDetails[], seedHashes: Iterable<string>, seedPrefixIds: Iterable<string>, hashOf: HashLookup, exclude: Set<string> = new Set(), maxDepth = 6, seedUrls: Record<string, string> = {}): Promise<LineageTree> {
    const prefixIds = new Set(seedPrefixIds);
    const known = new Set([...seedHashes].map(hash => hash.toLowerCase()));
    const hashToUrl = new Map(Object.entries(seedUrls).map(([url, hash]) => [hash.toLowerCase(), url] as [string, string]));
    const candidates = files.filter(file => file.type === 'image' && !exclude.has(file.url) && (linksOf(file).hashes.length > 0 || linksOf(file).prefixIds.length > 0));
    const nodes = new Map<string, LineageNode>();
    let frontier = new Set(known);
    for (let depth = 1; depth <= maxDepth; depth++) {
        const found: string[] = [];
        for (const file of candidates) {
            if (nodes.has(file.url)) continue;
            const links = linksOf(file);
            const parents = links.hashes.filter(hash => frontier.has(hash));
            if (parents.length || (depth === 1 && links.prefixIds.some(id => prefixIds.has(id)))) { nodes.set(file.url, { depth, parents }); found.push(file.url); }
        }
        if (!found.length || depth === maxDepth) break;
        const hashes = await hashOf(found);
        Object.entries(hashes).forEach(([url, hash]) => hashToUrl.set(hash, url));
        frontier = new Set(Object.values(hashes).filter(hash => !known.has(hash)));
        if (!frontier.size) break;
        frontier.forEach(hash => known.add(hash));
    }
    const usedAsSource = new Set<string>();
    for (const node of nodes.values()) for (const hash of node.parents) { const url = hashToUrl.get(hash); if (url && nodes.has(url)) usedAsSource.add(url); }
    return { nodes, hashToUrl, usedAsSource };
}

/** url → generation depth (see lineageTree). */
export async function descendantsOf(files: FileDetails[], seedHashes: Iterable<string>, seedPrefixIds: Iterable<string>, hashOf: HashLookup, exclude: Set<string> = new Set(), maxDepth = 4): Promise<Map<string, number>> {
    const tree = await lineageTree(files, seedHashes, seedPrefixIds, hashOf, exclude, maxDepth);
    return new Map([...tree.nodes].map(([url, node]) => [url, node.depth]));
}

/** Ancestors of an image, nearest first: the input images it was made from, their inputs, and so on. The last level is the original. */
export function ancestorLevels(metadata: unknown, maxDepth = 6): { input_name: string; hash?: string; title?: string; depth: number; original: boolean }[] {
    const result: { input_name: string; hash?: string; title?: string; depth: number; original: boolean }[] = [];
    let level: unknown[] = [metadata];
    for (let depth = 1; depth <= maxDepth && level.length; depth++) {
        const next: unknown[] = [];
        for (const item of level) for (const input of madeFrom(item)) {
            const parents = input.metadata ? madeFrom(input.metadata) : [];
            result.push({ input_name: input.input_name, hash: input.hash, title: input.title, depth, original: !parents.length });
            if (input.metadata) next.push(input.metadata);
        }
        level = next;
    }
    return result;
}

/** The local images paired with a prefix, and the hashes of all its paired images (local or Hydrus-only). */
export async function pairedImages(files: FileDetails[], library: PrefixLibrary, prefixId: string, hashOf: HashLookup, knownHashes: Record<string, string | undefined> = {}) {
    const byUrl = new Map(files.filter(file => file.type === 'image').map(file => [file.url, file]));
    const paired = collectPrefixImages(library, prefixId);
    const urls = new Set(paired.flatMap(image => image.local_url && byUrl.has(image.local_url) ? [image.local_url] : []));
    const hashes = new Set<string>(paired.flatMap(image => image.hash ? [image.hash.toLowerCase()] : []));
    Object.values(await hashOf([...urls])).forEach(hash => hashes.add(hash));
    // A paired Hydrus image whose local copy is in the gallery (same hash) is shown as the local copy.
    for (const [url, hash] of Object.entries(knownHashes)) if (hash && hashes.has(hash.toLowerCase()) && byUrl.has(url)) urls.add(url);
    const localHashes = new Set(Object.values(await hashOf([...urls])));
    const remoteOnly = paired.filter(image => image.hash && !localHashes.has(image.hash.toLowerCase()) && !(image.local_url && byUrl.has(image.local_url))).length;
    return { urls, hashes, remoteOnly };
}

/**
 * @param knownHashes hashes already known for local files (Hydrus exports record them), so only the rest are hashed.
 */
export async function findLineage(files: FileDetails[], library: PrefixLibrary, prefixId: string, fetchHashes: HashLookup, knownHashes: Record<string, string | undefined> = {}, maxDepth = 4): Promise<LineageResult> {
    const images = files.filter(file => file.type === 'image');
    const byUrl = new Map(images.map(file => [file.url, file]));
    const hashOf = hashLookup(fetchHashes, knownHashes);
    const paired = await pairedImages(images, library, prefixId, hashOf, knownHashes);
    const generated = await descendantsOf(images, paired.hashes, [prefixId], hashOf, paired.urls, maxDepth);
    return {
        paired: [...paired.urls].map(url => byUrl.get(url)!).filter(Boolean),
        generated: [...generated].map(([url, depth]) => ({ file: byUrl.get(url)!, depth })).sort((a, b) => a.depth - b.depth || (b.file.timestamp || 0) - (a.file.timestamp || 0)),
        remotePaired: paired.remoteOnly,
    };
}

/** The input images a generation was made from (the copies Gallery Image Source keeps in the input folder). */
export function madeFrom(metadata: unknown): { input_name: string; hash?: string; title?: string; metadata?: unknown }[] {
    const sources = metadataSources(metadata);
    const result: { input_name: string; hash?: string; title?: string; metadata?: unknown }[] = [];
    const add = (manifest: Record<string, any>) => {
        const images: any[] = Array.isArray(manifest.images) ? manifest.images : [];
        const used = manifest.layout === 'single' ? images.slice(manifest.active_index || 0, (manifest.active_index || 0) + 1) : images;
        for (const image of used) if (typeof image?.input_name === 'string') result.push({ input_name: image.input_name, hash: HASH.exec(image.input_name)?.[1]?.toLowerCase(), title: typeof image.title === 'string' ? image.title : undefined, metadata: image.metadata });
    };
    for (const node of Object.values(object(sources.prompt))) if ((node as any)?.class_type === 'GalleryImageSource') add(object((node as any).inputs?.sources));
    if (!result.length) { const workflow = object(sources.workflow); for (const node of Array.isArray(workflow.nodes) ? workflow.nodes : []) if (node?.type === 'GalleryImageSource') add(object(node.widgets_values?.[0])); }
    return result;
}

/** Everything an image descends from: the source hashes and prefix ids of its inputs, their inputs, and so on (input copies keep their metadata). */
export function ancestry(metadata: unknown, maxDepth = 6): { hashes: Set<string>; prefixIds: Set<string> } {
    const hashes = new Set<string>(), prefixIds = new Set<string>();
    let level: unknown[] = [metadata];
    for (let depth = 0; depth < maxDepth && level.length; depth++) {
        const next: unknown[] = [];
        for (const item of level) {
            sourceLinks(item).prefixIds.forEach(id => prefixIds.add(id));
            for (const input of madeFrom(item)) { if (input.hash) hashes.add(input.hash); if (input.metadata) next.push(input.metadata); }
        }
        level = next;
    }
    return { hashes, prefixIds };
}

/**
 * The prefixes an image belongs to: paired with it, paired with any image it descends from,
 * or the prefix one of its sources was appended under.
 * @param pairedHashes hash → prefix ids of every paired image (see pairedHashIndex)
 */
export function imagePrefixIds(library: PrefixLibrary, keys: string[], metadata: unknown, pairedHashes: Map<string, Set<string>> = new Map()): string[] {
    const ids = new Set<string>();
    for (const key of keys) { const id = library.associations?.[key]?.prefix_id; if (id) ids.add(id); }
    const { hashes, prefixIds } = ancestry(metadata);
    prefixIds.forEach(id => ids.add(id));
    hashes.forEach(hash => pairedHashes.get(hash)?.forEach(id => ids.add(id)));
    return [...ids].filter(id => library.prefixes.some(prefix => prefix.id === id));
}

/** hash → prefix ids, for every paired image (local paired images are hashed). */
export async function pairedHashIndex(library: PrefixLibrary, hashOf: HashLookup): Promise<Map<string, Set<string>>> {
    const index = new Map<string, Set<string>>();
    const add = (hash: string, id: string) => { const key = hash.toLowerCase(); if (!index.has(key)) index.set(key, new Set()); index.get(key)!.add(id); };
    const locals: [string, string][] = [];
    for (const [key, item] of Object.entries(library.associations || {})) {
        if (key.startsWith('sha256:')) add(key.slice(7), item.prefix_id);
        if (item.image?.hash) add(item.image.hash, item.prefix_id);
        const at = key.startsWith('local:') ? key.lastIndexOf(':/static_gallery/') : -1;
        if (at > 0) locals.push([key.slice(at + 1), item.prefix_id]);
    }
    const hashes = await hashOf(locals.map(([url]) => url));
    for (const [url, id] of locals) if (hashes[url]) add(hashes[url], id);
    return index;
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/_/g, ' ').replace(/\\([()])/g, '$1')
    .replace(/^\((.*):[-+]?\d+(?:\.\d+)?\)$/, '$1').replace(/^[([](.*)[)\]]$/, '$1').trim();

/** Every tag an image carries: its resolved positive prompt and its Hydrus tags (with and without namespace). */
export function imageTagSet(file: FileDetails, hydrusTags: string[] = []): Set<string> {
    const prompts = extractLocalPrompts(file.metadata);
    const tags = new Set<string>();
    for (const phrase of splitTop(stripUnresolved(prompts.positive).replace(/\n/g, ','), ',')) { const value = normalize(phrase); if (value) tags.add(value); }
    for (const tag of [...hydrusTags, ...extractHydrusTags(file.metadata)]) {
        const value = normalize(tag);
        tags.add(value);
        const bare = value.replace(/^[a-z_ ]+:/, '');
        if (bare !== value) tags.add(bare.trim());
    }
    return tags;
}

/**
 * Strict mode: the image must carry every prefix tag, in any accepted spelling (aliases from the
 * Danbooru dictionary, spaces or underscores; Hydrus siblings arrive already resolved as display tags).
 * Terms that are themselves {a|b} groups are optional by nature and are not required.
 */
export function hasAllTerms(tags: Set<string>, aliasGroups: string[][]): boolean {
    return aliasGroups.every(group => !group.length || group.some(spelling => tags.has(normalize(spelling))));
}

export function requiredTerms(terms: string[]): string[] {
    return terms.flatMap(term => term.includes('{') ? [] : splitTop(term, ',')).map(term => term.trim()).filter(Boolean);
}

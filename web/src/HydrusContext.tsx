import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useGalleryContext } from './GalleryContext';
import { hydrusRequest } from './HydrusApi';
import type { HydrusBatch, HydrusItem, HydrusSettings } from './HydrusApi';
import type { FileDetails } from './types';
import { extractHydrusTags } from './LocalImageSearch';

interface HydrusContextValue {
    settings?: HydrusSettings;
    settingsError: string;
    items: Record<string, HydrusItem>;
    imageFiles: Record<string, FileDetails>;
    settingsOpen: boolean;
    setSettingsOpen: (open: boolean) => void;
    exportUrls: string[];
    setExportUrls: (urls: string[]) => void;
    detailsUrl?: string;
    setDetailsUrl: (url?: string) => void;
    requestExport: (urls: string[]) => void;
    refresh: (urls: string[]) => Promise<HydrusItem[]>;
    mergeItems: (items: HydrusItem[]) => void;
    settingsSaved: (settings: HydrusSettings) => void;
}

const HydrusContext = createContext<HydrusContextValue | undefined>(undefined);

export function HydrusProvider({ children }: { children: ReactNode }) {
    const { data, unfilteredFolderImages, setLocalHydrusTags, open, settings: gallerySettings } = useGalleryContext();
    const [settings, setSettings] = useState<HydrusSettings>();
    const [settingsError, setSettingsError] = useState('');
    const [items, setItems] = useState<Record<string, HydrusItem>>({});
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [exportUrls, setExportUrls] = useState<string[]>([]);
    const [detailsUrl, setDetailsUrl] = useState<string>();
    const [revision, setRevision] = useState(0);
    const targetVersion = useRef(0);
    const connectionTarget = useRef<string | undefined>(undefined);
    const loadedStamps = useRef(new Map<string, string>());
    const statusRead = useRef<Promise<void>>(Promise.resolve());
    const imageFiles = useMemo(() => Object.fromEntries(Object.values(data?.folders || {})
        .flatMap(folder => Object.values(folder)).filter(file => file.type === 'image').map(file => [file.url, file])), [data]);
    const imageFilesRef = useRef(imageFiles);
    imageFilesRef.current = imageFiles;
    const folderImages = useMemo(() => unfilteredFolderImages.filter(file => file.type === 'image'), [unfilteredFolderImages]);
    const mergeItems = useCallback((next: HydrusItem[]) => {
        setItems(previous => {
            const result = { ...previous };
            for (const item of next) result[item.url] = item;
            return result;
        });
        // Update only this batch, retaining the existing tag index when its values
        // did not change. A status badge update should not refilter the whole folder.
        const nextTags = next.map(item => [item.url, extractHydrusTags(item.metadata)] as const);
        setLocalHydrusTags(previous => {
            let result = previous;
            for (const [url, tags] of nextTags) {
                const old = previous[url] || [];
                if (old.length === tags.length && old.every((tag, index) => tag === tags[index])) continue;
                if (result === previous) result = { ...previous };
                result[url] = tags;
            }
            return result;
        });
    }, [setLocalHydrusTags]);

    useEffect(() => {
        setItems({}); setLocalHydrusTags({}); loadedStamps.current.clear(); targetVersion.current += 1;
    }, [gallerySettings.relativePath, setLocalHydrusTags]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        hydrusRequest<HydrusSettings>('settings').then(value => {
            if (!cancelled) {
                const nextTarget = `${value.url}|${value.profile}`;
                // Another browser can change the saved client while this gallery
                // is closed. Session caching must never cross that target change.
                if (connectionTarget.current !== undefined && connectionTarget.current !== nextTarget) {
                    targetVersion.current++; loadedStamps.current.clear(); setItems({}); setLocalHydrusTags({});
                    setRevision(previous => previous + 1);
                }
                connectionTarget.current = nextTarget;
                setSettings(value); setSettingsError('');
            }
        }).catch(error => { if (!cancelled) setSettingsError(String(error.message || error)); });
        return () => { cancelled = true; };
    }, [open, setLocalHydrusTags]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const version = targetVersion.current;
        const precedingRead = statusRead.current;
        statusRead.current = (async () => {
            try {
                // Finish the current batch before scheduling a new folder/update.
                // Rapid generation events therefore do not duplicate in-flight work.
                await precedingRead;
                if (cancelled || version !== targetVersion.current) return;
                const stamp = (file: FileDetails) => `${file.timestamp}|${file.metadata?.fileinfo?.size || ''}`;
                const pending = folderImages.map(file => ({ url: file.url, stamp: stamp(file) }))
                    .filter(file => loadedStamps.current.get(file.url) !== file.stamp);
                for (let start = 0; start < pending.length; start += 200) {
                    if (cancelled) return;
                    const batch = pending.slice(start, start + 200);
                    const response = await hydrusRequest<HydrusBatch>('status', { urls: batch.map(file => file.url) });
                    if (version !== targetVersion.current) return;
                    // Completed work remains useful even if the user changed folders.
                    const expected = new Map(batch.map(file => [file.url, file.stamp]));
                    const current = response.items.filter(item => {
                        const file = imageFilesRef.current[item.url];
                        return file && stamp(file) === expected.get(item.url);
                    });
                    mergeItems(current);
                    const valid = new Set(current.filter(item => !item.error).map(item => item.url));
                    for (const file of batch) if (valid.has(file.url)) loadedStamps.current.set(file.url, file.stamp);
                }
            } catch (error) {
                if (!cancelled) setSettingsError(error instanceof Error ? error.message : String(error));
            }
        })();
        return () => { cancelled = true; };
    }, [open, folderImages, revision, mergeItems, gallerySettings.relativePath]);

    const refresh = useCallback(async (urls: string[]) => {
        const version = targetVersion.current;
        const result: HydrusItem[] = [];
        const unique = Array.from(new Set(urls)).filter(url => imageFilesRef.current[url]);
        for (let start = 0; start < unique.length; start += 200) {
            const response = await hydrusRequest<HydrusBatch>('refresh', { urls: unique.slice(start, start + 200) });
            if (version !== targetVersion.current) return result;
            mergeItems(response.items);
            result.push(...response.items);
        }
        return result;
    }, [mergeItems]);

    const requestExport = useCallback((urls: string[]) => setExportUrls(Array.from(new Set(urls)).filter(url => imageFilesRef.current[url])), []);
    const settingsSaved = useCallback((next: HydrusSettings) => {
        connectionTarget.current = `${next.url}|${next.profile}`;
        targetVersion.current += 1;
        setSettings(next);
        setSettingsError('');
        setItems({});
        setLocalHydrusTags({}); loadedStamps.current.clear();
        setRevision(value => value + 1);
    }, [setLocalHydrusTags]);

    const value = useMemo(() => ({ settings, settingsError, items, imageFiles, settingsOpen, setSettingsOpen,
        exportUrls, setExportUrls, detailsUrl, setDetailsUrl, requestExport, refresh, mergeItems, settingsSaved }),
        [settings, settingsError, items, imageFiles, settingsOpen, exportUrls, detailsUrl, requestExport, refresh, mergeItems, settingsSaved]);
    return <HydrusContext.Provider value={value}>
        {children}
    </HydrusContext.Provider>;
}

export function useHydrus() {
    const context = useContext(HydrusContext);
    if (!context) throw new Error('useHydrus requires HydrusProvider');
    return context;
}

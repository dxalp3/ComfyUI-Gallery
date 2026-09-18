import React, { createContext, useContext, useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import useSize from 'ahooks/lib/useSize';
import useRequest from 'ahooks/lib/useRequest/src/useRequest';
import useAsyncEffect from 'ahooks/lib/useAsyncEffect';
import { useEventListener, useLocalStorageState } from 'ahooks';
import type { FileDetails, FilesTree } from './types';
import type { AutoCompleteProps } from 'antd/es/auto-complete';
import { ComfyAppApi, BASE_PATH, OPEN_BUTTON_ID } from './ComfyAppApi';
import { selectRange } from './HydrusApi';
import { extractLocalPrompts, matchesLocalImage } from './LocalImageSearch';
import type { LocalSearchField, LocalPrompts } from './LocalImageSearch';

function getImages(): Promise<FilesTree> {
    return new Promise(async (resolve, reject) => {
        try {
            let settings = DEFAULT_SETTINGS;
            try {
                const raw = localStorage.getItem('comfy-ui-gallery-settings');
                if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
            } catch { }

            let request = await ComfyAppApi.fetchImages(settings.relativePath);
            let json: FilesTree = await request.json();
            resolve(json);
        } catch (error) {
            reject(error);
        }
    });
}

export interface SettingsState {
    relativePath: string;
    buttonBoxQuery: string;
    buttonLabel: string;
    showDateDivider: boolean;
    floatingButton: boolean;
    autoPlayVideos: boolean;
    hideOpenButton: boolean;
    darkMode: boolean;
    galleryShortcut: boolean;
    expandAllFolders: boolean;
    disableLogs: boolean;
    usePollingObserver: boolean;
    scanExtensions: string[];
    imageThumbFit: 'width' | 'height';
    videoThumbFit: 'width' | 'height';
    deduplicateSymlinks: boolean;
}

export const DEFAULT_SETTINGS: SettingsState = {
    relativePath: './',
    buttonBoxQuery: 'div.flex.gap-2.mx-2',
    buttonLabel: 'Open Gallery',
    showDateDivider: true,
    floatingButton: true,
    autoPlayVideos: true,
    hideOpenButton: false,
    darkMode: false,
    galleryShortcut: true,
    expandAllFolders: true,
    disableLogs: false,
    usePollingObserver: false,
    scanExtensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'gif', 'webm', 'mov', 'wav', 'mp3', 'm4a', 'flac', 'obj', 'glb', 'gltf', 'fbx', 'stl', 'usd', 'usdz'],
    imageThumbFit: 'width',
    videoThumbFit: 'height',
    deduplicateSymlinks: true,
};
export const STORAGE_KEY = 'comfy-ui-gallery-settings';

export interface GalleryContextType {
    currentFolder: string;
    setCurrentFolder: Dispatch<SetStateAction<string>>;
    searchFileName: string;
    setSearchFileName: Dispatch<SetStateAction<string>>;
    localSearchField: LocalSearchField;
    setLocalSearchField: Dispatch<SetStateAction<LocalSearchField>>;
    setLocalHydrusTags: Dispatch<SetStateAction<Record<string, string[]>>>;
    unfilteredFolderImages: FileDetails[];
    showDateDivider: boolean;
    setShowDateDivider: Dispatch<SetStateAction<boolean>>;
    showSettings: boolean;
    setShowSettings: Dispatch<SetStateAction<boolean>>;
    showRawMetadata: boolean;
    setShowRawMetadata: Dispatch<SetStateAction<boolean>>;
    sortMethod: 'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓';
    setSortMethod: Dispatch<SetStateAction<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>>;
    imageInfoName: string | undefined;
    setImageInfoName: Dispatch<SetStateAction<string | undefined>>;
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    previewingVideo: string | undefined;
    setPreviewingVideo: Dispatch<SetStateAction<string | undefined>>;
    size: ReturnType<typeof useSize>;
    imagesBoxSize: ReturnType<typeof useSize>;
    data: FilesTree | undefined;
    error: any;
    loading: boolean;
    runAsync: () => Promise<any>;
    mutate: (data?: FilesTree | ((oldData?: FilesTree | undefined) => FilesTree | undefined) | undefined) => void;
    gridSize: { width: number; height: number; columnCount: number; rowCount: number };
    setGridSize: Dispatch<SetStateAction<{ width: number; height: number; columnCount: number; rowCount: number }>>;
    autoSizer: { width: number; height: number };
    setAutoSizer: Dispatch<SetStateAction<{ width: number; height: number }>>;
    imagesDetailsList: FileDetails[];
    imagesUrlsLists: string[];
    imagesAutoCompleteNames: NonNullable<AutoCompleteProps['options']>;
    autoCompleteOptions: NonNullable<AutoCompleteProps['options']>;
    setAutoCompleteOptions: React.Dispatch<React.SetStateAction<NonNullable<AutoCompleteProps['options']>>>;
    settings: SettingsState;
    setSettings: (v: SettingsState) => void;
    selectedImages: string[];
    setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>;
    selectImage: (url: string, range?: boolean) => void;
    siderCollapsed: boolean;
    setSiderCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

const GalleryContext = createContext<GalleryContextType | undefined>(undefined);

// Cards only subscribe to the small subset they use. Opening a dialog, resizing
// the sidebar, or typing in search must not repaint every mounted media element.
interface GalleryCardContextType {
    settings: Pick<SettingsState, 'imageThumbFit' | 'videoThumbFit' | 'autoPlayVideos' | 'relativePath'>;
    selectedImages: string[];
    selectedImageSet: ReadonlySet<string>;
    selectImage: GalleryContextType['selectImage'];
    setPreviewingVideo: GalleryContextType['setPreviewingVideo'];
}
const GalleryCardContext = createContext<GalleryCardContextType | undefined>(undefined);

export function GalleryProvider({ children }: { children: React.ReactNode }) {
    const [currentFolder, setCurrentFolder] = useState("output");
    const [searchFileName, setSearchFileName] = useState("");
    const [localSearchField, setLocalSearchField] = useState<LocalSearchField>('all');
    const [localHydrusTags, setLocalHydrusTags] = useState<Record<string, string[]>>({});
    const promptSearchCache = useRef(new WeakMap<object, LocalPrompts>());
    const [showDateDivider, setShowDateDivider] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [showRawMetadata, setShowRawMetadata] = useState(false);
    const [sortMethod, setSortMethod] = useState<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>("Newest");
    const [imageInfoName, setImageInfoName] = useState<string | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [previewingVideo, setPreviewingVideo] = useState<string | undefined>(undefined);
    const [selectedImages, setSelectedImages] = useState<string[]>([]);
    const selectionAnchor = useRef<string | undefined>(undefined);
    const [siderCollapsed, setSiderCollapsed] = useState(true);
    const size = useSize(document.querySelector('body'));
    const imagesBoxSize = useSize(document.querySelector('#imagesBox'));
    const { data, error, loading, runAsync, mutate, refresh, refreshAsync } = useRequest(getImages, { manual: true });
    const [gridSize, setGridSize] = useState({ width: 1000, height: 600, columnCount: 1, rowCount: 1 });
    const [autoSizer, setAutoSizer] = useState({ width: 1000, height: 600 });
    const [autoCompleteOptions, setAutoCompleteOptions] = useState<NonNullable<AutoCompleteProps['options']>>([]);
    const [settingsState, setSettings] = useLocalStorageState<SettingsState>(STORAGE_KEY, {
        defaultValue: DEFAULT_SETTINGS,
        listenStorageChange: true,
    });
    const [settingsLoaded, setSettingsLoaded] = useState(false);

    useEffect(() => {
        if (data && data.folders) {
            const keys = Object.keys(data.folders);
            if (keys.length > 0 && !data.folders[currentFolder]) {
                setCurrentFolder(keys.sort()[0]);
            }
        }
    }, [data, currentFolder]);

    useAsyncEffect(async () => {
        // Fetch saved server settings and merge with defaults
        try {
            const serverSettings = await ComfyAppApi.fetchSettings();
            if (serverSettings && Object.keys(serverSettings).length > 0) {
                // Merge server settings into defaults, but only override when value is not null/undefined
                const merged: any = { ...DEFAULT_SETTINGS };
                Object.keys(serverSettings).forEach((k) => {
                    const v = (serverSettings as any)[k];
                    if (v !== null && v !== undefined) merged[k] = v;
                });
                setSettings(merged as SettingsState);
            }
        } catch (e) { }

        setSettingsLoaded(true);

        ComfyAppApi.onFileChange((event) => {
            console.log("file_change:", event.detail);
            updateImages(event.detail);
        });

        ComfyAppApi.onUpdate((event) => {
            console.log("update:", event.detail);
            updateImages(event.detail); // Pass the whole object, not event.detail.folders
        });

        ComfyAppApi.onClear((event) => {
            mutate({ folders: {} });
        });
    }, []);

    // Watch for changes to settingsState.relativePath, disableLogs, usePollingObserver and update monitoring and data
    // Start monitoring when settings change
    const saveSettings = useCallback((newSettings: SettingsState) => {
        setSettings(newSettings);
        ComfyAppApi.saveSettings(newSettings);
    }, [setSettings]);

    useEffect(() => {
        if (settingsLoaded && settingsState?.relativePath) {
            setCurrentFolder("");
            ComfyAppApi.startMonitoring(
                settingsState.relativePath,
                settingsState.disableLogs,
                settingsState.usePollingObserver,
                settingsState.scanExtensions,
                settingsState.deduplicateSymlinks
            );
            void runAsync().catch(() => {});
        }
    }, [settingsLoaded, settingsState?.relativePath, settingsState?.disableLogs, settingsState?.usePollingObserver, JSON.stringify(settingsState?.scanExtensions), settingsState?.deduplicateSymlinks]);

    // Keep the complete folder available to Hydrus status lookup even when a search hides its files.
    const currentFolderFiles = data?.folders?.[currentFolder];
    const unfilteredFolderImages = useMemo<FileDetails[]>(() => Object.values(currentFolderFiles ?? {}), [currentFolderFiles]);
    const searchNeedsPrompts = !!searchFileName.trim() && ['all', 'positive', 'negative'].includes(localSearchField);
    const localPrompts = useMemo(() => {
        const result = new Map<string, LocalPrompts>();
        if (!searchNeedsPrompts) return result;
        for (const file of unfilteredFolderImages) {
            const metadata = file.metadata;
            const cacheable = metadata && typeof metadata === 'object';
            let prompts = cacheable ? promptSearchCache.current.get(metadata) : undefined;
            if (!prompts) {
                prompts = extractLocalPrompts(metadata);
                if (cacheable) promptSearchCache.current.set(metadata, prompts);
            }
            result.set(file.url, prompts);
        }
        return result;
    }, [unfilteredFolderImages, searchNeedsPrompts]);

    // Sorting depends on folder contents and the chosen order, not on search
    // keystrokes, selection, column count, or arriving Hydrus metadata batches.
    const sortedFolderImages = useMemo(() => {
        const list = [...unfilteredFolderImages];
        if (sortMethod === 'Name ↑') return list.sort((a, b) => a.name.localeCompare(b.name));
        if (sortMethod === 'Name ↓') return list.sort((a, b) => b.name.localeCompare(a.name));
        return list.sort((a, b) => sortMethod === 'Newest' ? (b.timestamp || 0) - (a.timestamp || 0) : (a.timestamp || 0) - (b.timestamp || 0));
    }, [unfilteredFolderImages, sortMethod]);
    const searchedHydrusTags = searchFileName.trim() && ['all', 'hydrus'].includes(localSearchField) ? localHydrusTags : undefined;
    const filteredFolderImages = useMemo(() => searchFileName.trim()
        ? sortedFolderImages.filter(file => matchesLocalImage(file, searchFileName, localSearchField, searchedHydrusTags?.[file.url], localPrompts.get(file.url)))
        : sortedFolderImages,
    [sortedFolderImages, searchFileName, localSearchField, searchedHydrusTags, localPrompts]);

    // Search the complete folder before adding layout dividers or applying virtualized rendering.
    const imagesDetailsList = useMemo(() => {
        const list = filteredFolderImages;
        if (sortMethod !== 'Name ↑' && sortMethod !== 'Name ↓') {
            if (!(settingsState?.showDateDivider ?? showDateDivider)) return list;
            const grouped: { [date: string]: FileDetails[] } = {};
            list.forEach(item => {
                const date = item.timestamp ? new Date(item.timestamp * 1000).toISOString().slice(0, 10) : 'Unknown';
                if (!grouped[date]) grouped[date] = [];
                grouped[date].push(item);
            });
            const result: FileDetails[] = [];
            Object.entries(grouped).forEach(([date, items]) => {
                const colCount = Math.max(1, gridSize.columnCount || 1);
                for (let i = 0; i < colCount; i++) {
                    result.push({ name: date, type: 'divider' } as FileDetails);
                }
                result.push(...items);
                const remainder = items.length % colCount;
                if (remainder !== 0 && colCount > 1) {
                    for (let i = 0; i < colCount - remainder; i++) {
                        result.push({ type: 'empty-space' } as FileDetails);
                    }
                }
            });
            return result;
        }
        return list;
    }, [filteredFolderImages, sortMethod, gridSize.columnCount, showDateDivider, settingsState?.showDateDivider]);

    // Memoized list of image URLs for preview
    const imagesUrlsLists = useMemo(() =>
        filteredFolderImages.map(image => `${BASE_PATH}${image.url}`),
        [filteredFolderImages]
    );

    // Memoized autocomplete options for image names
    const imagesAutoCompleteNames = useMemo<NonNullable<AutoCompleteProps['options']>>(() =>
        filteredFolderImages.filter(image => typeof image.name === 'string').map(image => ({ value: image.name, label: image.name })),
    [filteredFolderImages]);

    // Update images in the gallery data (data: FilesTree)
    function updateImages(changes: any) {
        if (!changes || !changes.folders) {
            console.warn("No valid changes data received.");
            return;
        }
        mutate((oldData: FilesTree | undefined) => {
            if (!oldData || !oldData.folders) return oldData;
            // Preserve unchanged folder/file identities so memoized cards and
            // searches are reusable, while never mutating previous state.
            const folders = { ...oldData.folders };
            let changed = false;
            for (const folderName in changes.folders) {
                const folderChanges = changes.folders[folderName];
                if (!folderChanges) continue;
                const folder = { ...(folders[folderName] || {}) };
                folders[folderName] = folder;
                if (folders[folderName]) {
                    for (const filename in folderChanges) {
                        const fileChange = folderChanges[filename];
                        switch (fileChange.action) {
                            case 'create':
                                folder[filename] = { ...fileChange };
                                changed = true;
                                break;
                            case 'update':
                                if (folder[filename]) {
                                    folder[filename] = { ...folder[filename], ...fileChange };
                                    changed = true;
                                }
                                break;
                            case 'remove':
                                if (folder[filename]) {
                                    delete folder[filename];
                                    changed = true;
                                }
                                break;
                            default:
                                console.warn(`Unknown action: ${fileChange.action}`);
                        }
                    }
                    if (!Object.keys(folder).length) delete folders[folderName];
                } else {
                    console.warn(`Change for non-existent folder: ${folderName}`);
                    return oldData;
                }
            }
            if (changed) {
                return { ...oldData, folders };
            }
            return oldData;
        });
    }

    // Selection survives menus, dialogs and folder navigation. Clear it explicitly in the toolbar.
    const shownUrls = useMemo(() => filteredFolderImages.map(item => item.url), [filteredFolderImages]);
    const selectImage = useCallback((url: string, range = false) => {
        const anchor = selectionAnchor.current;
        setSelectedImages(previous => range ? selectRange(url, anchor, shownUrls, previous) :
            previous.includes(url) ? previous.filter(value => value !== url) : [...previous, url]);
        if (!range || !selectionAnchor.current) selectionAnchor.current = url;
    }, [shownUrls]);

    useEventListener('keydown', (event) => {
        if (settingsState?.galleryShortcut && event.code == "KeyG" && event.ctrlKey) {
            try {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                document.getElementById(OPEN_BUTTON_ID)?.click();
            } catch { }
        }
    });

    const mergedSettings = useMemo(() => ({
        ...DEFAULT_SETTINGS,
        ...(settingsState || {})
    }), [settingsState]);

    const cardSettings = useMemo(() => ({ imageThumbFit: mergedSettings.imageThumbFit, relativePath: mergedSettings.relativePath,
        videoThumbFit: mergedSettings.videoThumbFit, autoPlayVideos: mergedSettings.autoPlayVideos }),
    [mergedSettings.imageThumbFit, mergedSettings.videoThumbFit, mergedSettings.autoPlayVideos, mergedSettings.relativePath]);
    const selectedImageSet = useMemo(() => new Set(selectedImages), [selectedImages]);
    const cardContext = useMemo(() => ({ settings: cardSettings, selectedImages, selectedImageSet, selectImage, setPreviewingVideo }),
    [cardSettings, selectedImages, selectedImageSet, selectImage]);

    const value = useMemo(() => ({
        currentFolder, setCurrentFolder,
        searchFileName, setSearchFileName,
        localSearchField, setLocalSearchField, setLocalHydrusTags, unfilteredFolderImages,
        showDateDivider, setShowDateDivider,
        showSettings, setShowSettings,
        showRawMetadata, setShowRawMetadata,
        sortMethod, setSortMethod,
        imageInfoName, setImageInfoName,
        open, setOpen,
        previewingVideo, setPreviewingVideo,
        size, imagesBoxSize,
        data, error, loading, runAsync, mutate,
        gridSize, setGridSize,
        autoSizer, setAutoSizer,
        imagesDetailsList,
        imagesUrlsLists,
        imagesAutoCompleteNames,
        autoCompleteOptions,
        setAutoCompleteOptions,
        settings: mergedSettings,
        setSettings: saveSettings,
        selectedImages,
        setSelectedImages,
        selectImage,
        siderCollapsed,
        setSiderCollapsed,
    }), [
        currentFolder,
        searchFileName,
        localSearchField,
        unfilteredFolderImages,
        showDateDivider,
        showSettings,
        showRawMetadata,
        sortMethod,
        imageInfoName,
        open,
        previewingVideo,
        size,
        imagesBoxSize,
        data,
        error,
        loading,
        runAsync,
        mutate,
        gridSize,
        autoSizer,
        imagesDetailsList,
        imagesUrlsLists,
        imagesAutoCompleteNames,
        autoCompleteOptions,
        mergedSettings,
        saveSettings,
        selectImage,
        selectedImages,
        setSelectedImages,
        siderCollapsed,
        setSiderCollapsed,
    ]);

    return <GalleryContext.Provider
        value={value}
    >
        <GalleryCardContext.Provider value={cardContext}>{children}</GalleryCardContext.Provider>
    </GalleryContext.Provider>;
}

export function useGalleryCardContext() {
    const context = useContext(GalleryCardContext);
    if (!context) throw new Error('useGalleryCardContext requires GalleryProvider');
    return context;
}

export function useGalleryContext() {
    const ctx = useContext(GalleryContext);
    if (!ctx) throw new Error('useGalleryContext must be used within a GalleryProvider');
    return ctx;
}

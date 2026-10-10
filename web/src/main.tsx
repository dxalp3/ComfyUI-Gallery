import { mountGalleryAssetPane } from './GalleryAssetPane';
import { useGalleryTheme, interactionStyles } from './GalleryTheme';
import { installPrefixWidgets } from './PrefixLibrary';
import { installWorkspaceTab, closeWorkspace } from './GalleryWorkspace';
import { getComfyApp } from './ComfyAppApi';
import { exclusiveTagsEnabled } from './TagConflicts';
import { installLoadImageDrop, installSourceWidgets, registerSourceConstructor } from './ImageSourceBridge';
import { createRoot } from 'react-dom/client'
import Gallery from './Gallery.tsx'
import App from 'antd/es/app/App';
import { DEFAULT_SETTINGS, STORAGE_KEY, type SettingsState } from './GalleryContext.tsx';
import { ComfyAppApi, OPEN_BUTTON_ID, STANDALONE } from './ComfyAppApi.ts';
import { ConfigProvider } from 'antd';
import { useLocalStorageState } from 'ahooks';
import { ModelThumbnailProvider } from './GlobalModelRenderer';

if (STANDALONE) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    createRoot(root).render(<Main />);
} else ComfyAppApi.registerExtension({
    name: "Gallery",
    async setup() {
        installWorkspaceTab();
        installLoadImageDrop();
        exclusiveTagsEnabled(); // loads the exclusive tag list when the setting is on
        getComfyApp()?.extensionManager?.registerSidebarTab?.({
            id: 'comfy-gallery', icon: 'pi pi-images', title: 'Gallery', tooltip: 'Local and Hydrus gallery', type: 'custom',
            render: mountGalleryAssetPane,
        });
    },
    async init() {
        const box = document.createElement('div');
        document.body.appendChild(box);
        createRoot(box).render(<Main />);
    },
    beforeRegisterNodeDef(nodeType: any, nodeData: any) { if (nodeData.name === 'GalleryImageSource') registerSourceConstructor(nodeType); },
    afterConfigureGraph() { closeWorkspace(); },
    async nodeCreated(node: any) {
        installSourceWidgets(node);
        installPrefixWidgets(node);
        try {
            if (node.comfyClass === "GalleryNode") {
                node.addWidget("button", "Open Gallery", null, () => {
                    try {
                        let settings = DEFAULT_SETTINGS;
                        try {
                            const raw = localStorage.getItem('comfy-ui-gallery-settings');
                            if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
                        } catch { }
                        if (settings.galleryShortcut) {
                            document.getElementById(OPEN_BUTTON_ID)?.click();
                        }
                    } catch (error) {

                    }
                });
            }
        } catch (error) {

        }
    },
});

function Main() {
    const [settingsState] = useLocalStorageState<SettingsState>(STORAGE_KEY, {
        defaultValue: DEFAULT_SETTINGS,
        listenStorageChange: true,
    });

    const galleryTheme = useGalleryTheme(settingsState?.themeMode || (settingsState?.darkMode ? 'dark' : 'light'));
    return (<>
        <style>{interactionStyles}</style>
        <ConfigProvider
            theme={galleryTheme}
        >
            <App>
                <ModelThumbnailProvider>
                    <Gallery />
                </ModelThumbnailProvider>
            </App>
        </ConfigProvider>
    </>);
}
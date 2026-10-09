import { installPrefixWidgets } from './PrefixLibrary';
import { installWorkspaceTab, openWorkspace, closeWorkspace } from './GalleryWorkspace';
import { getComfyApp } from './ComfyAppApi';
import { exclusiveTagsEnabled } from './TagConflicts';
import { installLoadImageDrop, installSourceWidgets, registerSourceConstructor } from './ImageSourceBridge';
import { createRoot } from 'react-dom/client'
import Gallery from './Gallery.tsx'
import App from 'antd/es/app/App';
import { DEFAULT_SETTINGS, STORAGE_KEY, type SettingsState } from './GalleryContext.tsx';
import { ComfyAppApi, OPEN_BUTTON_ID, STANDALONE, BASE_Z_INDEX } from './ComfyAppApi.ts';
import { ConfigProvider, theme } from 'antd';
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
            render: (element: HTMLElement) => {
                element.replaceChildren();
                const panel = document.createElement('div');
                panel.style.cssText = 'padding:20px;color:#e8edf4;background:#171c24;font:14px system-ui;';
                const title = document.createElement('h3'); title.textContent = 'Gallery workspace'; title.style.cssText = 'margin:0 0 12px;color:inherit;font-size:17px;';
                const description = document.createElement('p'); description.textContent = 'Browse local and Hydrus images in the full-width Gallery tab.';
                const button = document.createElement('button'); button.textContent = 'Open Gallery workspace'; button.onclick = openWorkspace;
                button.style.cssText = 'padding:10px 14px;border:1px solid #6588ad;border-radius:6px;color:#fff;background:#27496a;cursor:pointer;font:inherit;';
                panel.append(title, description, button); element.append(panel);
            },
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
    const [settingsState, setSettings] = useLocalStorageState<SettingsState>(STORAGE_KEY, {
        defaultValue: DEFAULT_SETTINGS,
        listenStorageChange: true,
    });

    return (<>
        <ConfigProvider
            theme={{
                token: { zIndexPopupBase: BASE_Z_INDEX + 100 },
                algorithm: (settingsState?.darkMode ?? DEFAULT_SETTINGS.darkMode) ? theme.darkAlgorithm : undefined,
            }}
        >
            <App>
                <ModelThumbnailProvider>
                    <Gallery />
                </ModelThumbnailProvider>
            </App>
        </ConfigProvider>
    </>);
}
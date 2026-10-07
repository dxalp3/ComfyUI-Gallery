import { HydrusSyncPanel } from './HydrusSyncPanel';
import { LIBRARY_SEARCH_EVENT, PROMPTS_WINDOW_EVENT, LocalPromptSearch } from './LocalPromptLibrary';
import { ImageSearchPanel } from './TagSearchPanel';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dropdown, Input, Modal, Segmented, Select, Space, message, theme } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, SettingOutlined, FilterOutlined, AppstoreOutlined, BookOutlined, TagsOutlined } from '@ant-design/icons';
import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GallerySidebar from './GallerySidebar';
import { HydrusToolbar } from './HydrusToolbar';
import GallerySettingsModal from './GallerySettingsModal';
import { BASE_Z_INDEX, STANDALONE } from './ComfyAppApi';
import { HydrusSettingsModal } from './HydrusSettingsModal';
import { HydrusExportModal } from './HydrusExportModal';
import { HydrusDetailsModal } from './HydrusDetailsModal';
import { SourcePrefixPanel } from './ImageInfo';
import { HydrusBrowser } from './HydrusBrowser';
import { useHydrus } from './HydrusContext';
import { ImageSourceTarget } from './ImageSourceHost';
import { openGalleryTab } from './ImageSourceBridge';
import { GALLERY_OPEN, GALLERY_CLOSE, setWorkspaceActive, workspaceTop } from './GalleryWorkspace';
import { galleryStyles } from './GalleryStyles';

const GalleryModal = () => {
    const gallery = useGalleryContext();
    const { open, setOpen, showSettings, runAsync, setShowSettings } = gallery;
    const { setSettingsOpen } = useHydrus();
    const [source, setSource] = useState('local');
    const [tools, setTools] = useState(false);
    const [targetOpen, setTargetOpen] = useState(false);
    const [searchMode, setSearchMode] = useState('local');
    const [viewRevision, setViewRevision] = useState(0);
    const changeSource = (value: string) => { setSource(value); setSearchMode(value); setViewRevision(n => n + 1); };
    const [top, setTop] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const { token } = theme.useToken();
    const visible = STANDALONE || open;
    useEffect(() => { if (showSettings) setTools(false); }, [showSettings]);
    useEffect(() => {
        const show = () => setOpen(true), hide = () => setOpen(false);
        window.addEventListener(GALLERY_OPEN, show); window.addEventListener(GALLERY_CLOSE, hide);
        return () => { window.removeEventListener(GALLERY_OPEN, show); window.removeEventListener(GALLERY_CLOSE, hide); };
    }, [setOpen]);
    useEffect(() => {
        setWorkspaceActive(visible);
        if (!visible || STANDALONE) return;
        const update = () => setTop(workspaceTop());
        const observer = new ResizeObserver(update);
        const bar = document.querySelector('.workflow-tabs-container');
        if (bar) observer.observe(bar);
        window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
        window.addEventListener('comfy-gallery:layout', update);
        update();
        return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); window.removeEventListener('comfy-gallery:layout', update); setWorkspaceActive(false); };
    }, [visible]);
    useEffect(() => { if (visible) root.current?.focus({ preventScroll: true }); }, [visible]);
    const variables = {
        '--cg-bg': token.colorBgContainer, '--cg-panel': token.colorFillQuaternary,
        '--cg-text': token.colorText, '--cg-muted': token.colorTextSecondary, '--cg-border': token.colorBorderSecondary,
        '--cg-control': token.colorBgElevated, '--cg-accent': token.colorPrimary,
    } as React.CSSProperties;
    return <>
        {createPortal(<div ref={root} id="comfy-gallery-workspace" className="cg-workspace" role="region" aria-label="Gallery workspace" tabIndex={-1}
            style={{ ...variables, display: visible ? 'flex' : 'none', position: 'fixed', top: STANDALONE ? 0 : top, left: 0, right: 0, bottom: 0, zIndex: 1000 }}>
            <style>{galleryStyles}</style>
            <header className="cg-header">
                <div className="cg-brand"><AppstoreOutlined /><strong>Gallery</strong></div>
                <Segmented aria-label="Gallery sources" value={source} onChange={changeSource} options={[{ value: 'local', label: 'Local' }, { value: 'hydrus', label: 'Hydrus' }, { value: 'both', label: 'Both' }]} />
                <div className="cg-spacer" />
                <Button icon={<TagsOutlined />} title="Prompts & prefixes: palette, append to workflow, prefix editor" onClick={() => window.dispatchEvent(new Event(PROMPTS_WINDOW_EVENT))}>Prompts & prefixes</Button>
                <Button icon={<BookOutlined />} title="Library search: saved prefixes and every prompt phrase" onClick={() => window.dispatchEvent(new Event(LIBRARY_SEARCH_EVENT))}>Library search</Button>
                <HydrusSyncPanel visible={visible} />
                <Button icon={<ReloadOutlined />} title="Reload local images" aria-label="Reload local images" loading={gallery.loading} onClick={() => { void runAsync().catch(error => message.error(String(error))); }} />
                <Dropdown trigger={['click']} menu={{ items: [{ key: 'gallery', label: 'Gallery settings' }, { key: 'hydrus', label: 'Connection settings' }, { key: 'browser', label: 'Open in new browser tab' }], onClick: ({ key }) => { if (key === 'gallery') setShowSettings(true); if (key === 'hydrus') setSettingsOpen(true); if (key === 'browser') { try { openGalleryTab(); } catch (error) { message.error(String(error)); } } } }}><Button aria-label="Settings" icon={<SettingOutlined />}>Settings</Button></Dropdown>
                {!STANDALONE && <Button aria-label="Workflow" icon={<ArrowLeftOutlined />} onClick={() => setOpen(false)}>Workflow</Button>}
            </header>
            <div className="cg-filters">
                {searchMode === 'local' && <>
                    {gallery.settings.extraFolders?.length > 0 && <Select aria-label="Local library root" value={gallery.settings.relativePath} style={{ width: 190 }} onChange={relativePath => { void gallery.setSettings({ ...gallery.settings, relativePath }).catch(error => message.error(String(error))); }} options={[...new Set(['./', gallery.settings.relativePath, ...gallery.settings.extraFolders])].map(value => ({ value, label: value === './' ? 'ComfyUI output' : value }))} />}
                    <Select aria-label="Local folder" value={gallery.currentFolder} onChange={value => { gallery.setCurrentFolder(value); gallery.setLibrarySearch(null); changeSource('local'); }} style={{ width: 180 }} options={Object.keys(gallery.data?.folders || {}).map(value => ({ value, label: value || 'Root folder' }))} />
                    <LocalPromptSearch onLocalSearch={() => { changeSource('local'); gallery.setLibrarySearch(null); }} />
                    <Button aria-label="Filters & tools" icon={<FilterOutlined />} onClick={() => setTools(true)}>Filters & tools</Button>
                </>}

                {searchMode !== 'local' && <LocalPromptSearch managerOnly onLocalSearch={() => changeSource('local')} />}
                <div className="cg-spacer" />
                <Button type={targetOpen ? 'primary' : 'default'} onClick={() => setTargetOpen(value => !value)}>Image Source</Button>
            </div>
            {targetOpen && <div className="cg-target"><ImageSourceTarget /></div>}
            <HydrusBrowser onSourceChange={setSource} source={source} open={visible} searchMode={searchMode} viewRevision={viewRevision} />
        </div>, document.body)}
        <Modal title="Local filters and tools" open={tools && visible} onCancel={() => setTools(false)} footer={null} width={1000} zIndex={BASE_Z_INDEX + 20}>
            <GalleryHeader /><HydrusToolbar onBrowseHydrus={() => { changeSource('hydrus'); setTools(false); }} /><GallerySidebar />
        </Modal>
        {showSettings && <GallerySettingsModal />}
        <HydrusSettingsModal /><HydrusExportModal /><HydrusDetailsModal /><SourcePrefixPanel /><ImageSearchPanel />
    </>;
};
export default GalleryModal;

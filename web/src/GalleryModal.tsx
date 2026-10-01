import { LocalPromptSearch } from './LocalPromptLibrary';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dropdown, Input, Modal, Segmented, Select, Space, message, theme } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, SettingOutlined, FilterOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GallerySidebar from './GallerySidebar';
import { HydrusToolbar } from './HydrusToolbar';
import GallerySettingsModal from './GallerySettingsModal';
import { BASE_Z_INDEX, STANDALONE } from './ComfyAppApi';
import { HydrusSettingsModal } from './HydrusSettingsModal';
import { HydrusExportModal } from './HydrusExportModal';
import { HydrusDetailsModal } from './HydrusDetailsModal';
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
    const [searchOpen, setSearchOpen] = useState(false);
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
                <Segmented aria-label="Gallery sources" value={source} onChange={value => { setSource(value); if (value !== 'local') setSearchOpen(true); }} options={[{ value: 'local', label: 'Local' }, { value: 'hydrus', label: 'Hydrus' }, { value: 'both', label: 'Both' }]} />
                <div className="cg-spacer" />
                <Button icon={<ReloadOutlined />} title="Reload local images" aria-label="Reload local images" loading={gallery.loading} onClick={() => { void runAsync().catch(error => message.error(String(error))); }} />
                <Dropdown trigger={['click']} menu={{ items: [{ key: 'gallery', label: 'Gallery settings' }, { key: 'hydrus', label: 'Connection settings' }, { key: 'browser', label: 'Open in new browser tab' }], onClick: ({ key }) => { if (key === 'gallery') setShowSettings(true); if (key === 'hydrus') setSettingsOpen(true); if (key === 'browser') { try { openGalleryTab(); } catch (error) { message.error(String(error)); } } } }}><Button aria-label="Settings" icon={<SettingOutlined />}>Settings</Button></Dropdown>
                {!STANDALONE && <Button aria-label="Workflow" icon={<ArrowLeftOutlined />} onClick={() => setOpen(false)}>Workflow</Button>}
            </header>
            <div className="cg-filters">
                {source !== 'hydrus' && <>
                    {gallery.settings.extraFolders?.length > 0 && <Select aria-label="Local library root" value={gallery.settings.relativePath} style={{ width: 190 }} onChange={relativePath => { void gallery.setSettings({ ...gallery.settings, relativePath }).catch(error => message.error(String(error))); }} options={[...new Set(['./', gallery.settings.relativePath, ...gallery.settings.extraFolders])].map(value => ({ value, label: value === './' ? 'ComfyUI output' : value }))} />}
                    <Select aria-label="Local folder" value={gallery.currentFolder} onChange={gallery.setCurrentFolder} style={{ width: 180 }} options={Object.keys(gallery.data?.folders || {}).map(value => ({ value, label: value || 'Root folder' }))} />
                    <LocalPromptSearch />
                    <Button aria-label="Filters & tools" icon={<FilterOutlined />} onClick={() => setTools(true)}>Filters & tools</Button>
                </>}
                {source !== 'local' && <Button type={searchOpen ? 'primary' : 'default'} onClick={() => setSearchOpen(value => !value)}>{searchOpen ? 'Hide Hydrus search' : 'Search Hydrus'}</Button>}
                <div className="cg-spacer" />
                <Button type={targetOpen ? 'primary' : 'default'} onClick={() => setTargetOpen(value => !value)}>Image Source</Button>
            </div>
            {targetOpen && <div className="cg-target"><ImageSourceTarget /></div>}
            <HydrusBrowser source={source} open={visible} searchOpen={searchOpen} onSearchComplete={() => setSearchOpen(false)} />
        </div>, document.body)}
        <Modal title="Local filters and tools" open={tools && visible} onCancel={() => setTools(false)} footer={null} width={1000} zIndex={BASE_Z_INDEX + 20}>
            <GalleryHeader /><HydrusToolbar onBrowseHydrus={() => { setSource('hydrus'); setSearchOpen(true); setTools(false); }} /><GallerySidebar />
        </Modal>
        {showSettings && <GallerySettingsModal />}
        <HydrusSettingsModal /><HydrusExportModal /><HydrusDetailsModal />
    </>;
};
export default GalleryModal;

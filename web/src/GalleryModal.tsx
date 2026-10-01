import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Collapse, Input, Modal, Segmented, Select, Space, Typography, message, theme } from 'antd';
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
import { useGallerySidebarHost } from './GallerySidebarHost';

const GalleryModal = () => {
    const gallery = useGalleryContext();
    const { open, setOpen, size, showSettings, runAsync, setShowSettings } = gallery;
    const { setSettingsOpen } = useHydrus();
    const [source, setSource] = useState('local');
    const sidebar = useGallerySidebarHost();
    const [expanded, setExpanded] = useState(false);
    const [surface] = useState(() => document.createElement('div'));
    const localHost = useRef<HTMLDivElement>(null);
    const { token } = theme.useToken();
    const visible = STANDALONE || open || !!sidebar;
    const wasDocked = useRef(false);
    useEffect(() => {
        if (sidebar) { setOpen(true); wasDocked.current = true; }
        else { setExpanded(false); if (wasDocked.current) { setOpen(false); wasDocked.current = false; } }
    }, [sidebar, setOpen]);
    // Move the existing portal container so docking preserves searches and selection.
    useEffect(() => {
        const target = sidebar && !expanded ? sidebar : localHost.current;
        if (target && surface.parentElement !== target) target.appendChild(surface);
    });
    useEffect(() => () => surface.remove(), [surface]);
    const body = <div style={{ padding: sidebar && !expanded ? 12 : 0 }}>
        <Space wrap style={{ marginBottom: 12 }}>
            <Segmented aria-label="Gallery sources" value={source} onChange={setSource} options={[{ value: 'local', label: 'Local' }, { value: 'hydrus', label: 'Hydrus' }, { value: 'both', label: 'Both' }]} />
            {sidebar && <Button onClick={() => setExpanded(value => !value)}>{expanded ? 'Dock in sidebar' : 'Expand gallery'}</Button>}
            {!STANDALONE && <Button onClick={() => { try { openGalleryTab(); } catch (error) { message.error(String(error)); } }}>Open in new tab</Button>}
            <Button onClick={() => { void runAsync().catch(error => message.error(String(error))); }}>Reload local images</Button>
            <Button onClick={() => setShowSettings(true)}>Gallery settings</Button>
            <Button onClick={() => setSettingsOpen(true)}>Connection settings</Button>
        </Space>
        {visible && <ImageSourceTarget />}
        {source !== 'hydrus' && <>
            <Space wrap style={{ marginBottom: 12 }}>
                <Select aria-label="Local folder" value={gallery.currentFolder} onChange={gallery.setCurrentFolder} style={{ minWidth: 150 }} options={Object.keys(gallery.data?.folders || {}).map(value => ({ value, label: value || 'Root folder' }))} />
                <Input aria-label="Filter local files" placeholder="Filter local files / prompts / tags" value={gallery.searchFileName} onChange={event => gallery.setSearchFileName(event.target.value)} style={{ width: 250 }} allowClear />
                <Select aria-label="Local search field" value={gallery.localSearchField} onChange={gallery.setLocalSearchField} options={['all', 'name', 'positive', 'negative', 'hydrus'].map(value => ({ value, label: value }))} />
            </Space>
            <Collapse size="small" style={{ marginBottom: 12 }} items={[{ key: 'local', label: 'Local tools and filters', children: <><GalleryHeader /><HydrusToolbar onBrowseHydrus={() => setSource('hydrus')} /><GallerySidebar /></> }]} />
        </>}
        <HydrusBrowser embedded source={source} open={visible} onClose={() => setSource('local')} />
    </div>;
    return <>
        {STANDALONE ? <main style={{ padding: 20, minHeight: '100vh', boxSizing: 'border-box', background: token.colorBgContainer, color: token.colorText }}><Typography.Title level={3}>Gallery</Typography.Title><div ref={localHost} /></main> :
            <Modal forceRender zIndex={BASE_Z_INDEX} title="Gallery" centered open={open && (!sidebar || expanded)} onCancel={() => { if (sidebar) setExpanded(false); else setOpen(false); }} width={size?.width} footer={null} styles={{ body: { maxHeight: '84vh', overflowY: 'auto' } }}><div ref={localHost} /></Modal>}
        {createPortal(body, surface)}
        {showSettings && <GallerySettingsModal />}
        <HydrusSettingsModal /><HydrusExportModal /><HydrusDetailsModal />
    </>;
};
export default GalleryModal;

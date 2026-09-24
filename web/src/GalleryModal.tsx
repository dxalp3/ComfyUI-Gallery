import { useState } from 'react';
import { Button, Layout, Modal, Segmented, Space, Typography, message, theme } from 'antd';
import Sider from 'antd/es/layout/Sider';
import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GallerySidebar from './GallerySidebar';
import GalleryImageGrid from './GalleryImageGrid';
import GallerySettingsModal from './GallerySettingsModal';
import { BASE_Z_INDEX, STANDALONE } from './ComfyAppApi';
import { HydrusToolbar } from './HydrusToolbar';
import { HydrusSettingsModal } from './HydrusSettingsModal';
import { HydrusExportModal } from './HydrusExportModal';
import { HydrusDetailsModal } from './HydrusDetailsModal';
import { HydrusBrowser } from './HydrusBrowser';
import { useHydrus } from './HydrusContext';
import { ImageSourceTarget } from './ImageSourceHost';
import { openGalleryTab } from './ImageSourceBridge';

const GalleryModal = () => {
    const { open, setOpen, size, showSettings, siderCollapsed, runAsync, setShowSettings } = useGalleryContext();
    const { setSettingsOpen } = useHydrus();
    const [source, setSource] = useState('local');
    const { token } = theme.useToken();
    const visible = STANDALONE || open;
    const body = <>
        <Space wrap style={{ marginBottom: 12 }}>
            <Segmented aria-label="Gallery sources" value={source} onChange={setSource} options={[{ value: 'local', label: 'Local' }, { value: 'hydrus', label: 'Hydrus' }, { value: 'both', label: 'Both' }]} />
            {!STANDALONE && <Button onClick={() => { try { openGalleryTab(); } catch (error) { message.error(String(error)); } }}>Open in new tab</Button>}
            <Button onClick={() => { void runAsync().catch(error => message.error(String(error))); }}>Reload local images</Button>
            <Button onClick={() => setShowSettings(true)}>Gallery settings</Button>
            <Button onClick={() => setSettingsOpen(true)}>Connection settings</Button>
        </Space>
        {visible && <div><ImageSourceTarget /></div>}
        {source !== 'hydrus' && <section aria-label="Local gallery">
            {source === 'both' && <Typography.Title level={4}>Local images</Typography.Title>}
            <GalleryHeader />
            <HydrusToolbar onBrowseHydrus={() => setSource('hydrus')} />
            <Layout style={{ borderRadius: 8, overflow: 'hidden', width: '100%', height: source === 'both' ? '45vh' : '65vh' }}>
                <Sider collapsed={siderCollapsed} collapsedWidth={0} width="20%" style={{ overflow: 'auto', background: 'transparent' }}><GallerySidebar /></Sider>
                <GalleryImageGrid />
            </Layout>
        </section>}
        <div style={{ display: source === 'local' ? 'none' : undefined, marginTop: source === 'both' ? 20 : 0 }}>
            {source === 'both' && <Typography.Title level={4}>Hydrus images</Typography.Title>}
            <HydrusBrowser embedded open={visible && source !== 'local'} onClose={() => setSource('local')} />
        </div>
    </>;
    return <>
        {STANDALONE ? <main style={{ padding: 20, minHeight: '100vh', boxSizing: 'border-box', background: token.colorBgContainer, color: token.colorText }}><Typography.Title level={3}>Gallery</Typography.Title>{body}</main> :
            <Modal zIndex={BASE_Z_INDEX} title="Gallery" centered open={open} onCancel={() => setOpen(false)} width={size?.width} footer={null} styles={{ body: { maxHeight: '84vh', overflowY: 'auto' } }}>{body}</Modal>}
        {showSettings && <GallerySettingsModal />}
        <HydrusSettingsModal /><HydrusExportModal /><HydrusDetailsModal />
    </>;
};
export default GalleryModal;

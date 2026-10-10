import { useSessionOutputs } from './SessionOutputs';
import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dropdown, Empty, Input, Select, Segmented, theme, message } from 'antd';
import { useGalleryContext } from './GalleryContext';
import { BASE_PATH } from './ComfyAppApi';
import { ASSET_ACTION_EVENT, openWorkspace } from './GalleryWorkspace';
import { LIBRARY_SEARCH_EVENT, PROMPTS_WINDOW_EVENT } from './LocalPromptLibrary';
import { openImageSearch } from './TagSearchPanel';
import { ImageSourceTarget } from './ImageSourceHost';

let host: HTMLElement | null = null;
const listeners = new Set<() => void>();
export function mountGalleryAssetPane(element: HTMLElement) { element.style.height = '100%'; host = element; listeners.forEach(listener => listener()); }
export function GalleryAssetPane() {
    const element = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => host);
    const gallery = useGalleryContext(), { token } = theme.useToken();
    const session = useSessionOutputs();
    const [scope, setScope] = useState('session');
    const [query, setQuery] = useState(''), [folder, setFolder] = useState('*'), [limit, setLimit] = useState(100), [target, setTarget] = useState(false);
    if (!element) return null;
    const indexed = Object.entries(gallery.data?.folders || {}).filter(([name]) => folder === '*' || name === folder).flatMap(([, files]) => Object.values(files))
        .filter(file => file.type === 'image' && file.name.toLowerCase().includes(query.toLowerCase())).sort((a,b) => b.timestamp - a.timestamp);
    const files = (scope === 'session' ? session.map(file => indexed.find(item => item.url === file.url) || file).filter(file => file.name.toLowerCase().includes(query.toLowerCase())) : indexed);
    const action = (url: string, key: string) => window.dispatchEvent(new CustomEvent(ASSET_ACTION_EVENT, { detail: { url, key, urls: files.map(file => file.url) } }));
    return createPortal(<section className="cg-asset-pane" aria-label="Gallery assets" style={{ background:token.colorBgContainer,color:token.colorText,
        '--cg-border':token.colorBorder,'--cg-control':token.colorBgElevated,'--cg-text':token.colorText,'--cg-accent':token.colorPrimary,'--cg-panel':token.colorFillSecondary } as React.CSSProperties}>
        <header><strong>Gallery</strong><Button size="small" onClick={openWorkspace}>Workspace ↗</Button><Button size="small" aria-label="Gallery settings" onClick={() => gallery.setShowSettings(true)}>⚙</Button></header>
        <div className="cg-asset-tools">
            <Button size="small" onClick={() => window.dispatchEvent(new Event(PROMPTS_WINDOW_EVENT))}>Prompts & prefixes</Button>
            <Button size="small" onClick={() => window.dispatchEvent(new Event(LIBRARY_SEARCH_EVENT))}>Library</Button>
            <Button size="small" onClick={() => openImageSearch({chips:[]})}>Search images</Button>
            <Button size="small" onClick={() => setTarget(value => !value)}>Image Source</Button>
            <Button size="small" loading={gallery.loading} onClick={() => void gallery.runAsync().catch(error => message.error(String(error)))}>Refresh</Button>
        </div>
        {target && <div style={{ maxHeight:180,overflow:'auto' }}><ImageSourceTarget /></div>}
        <Segmented aria-label="Asset scope" value={scope} onChange={value => { setScope(value); setLimit(100); }} options={[{value:'session',label:'Session outputs'},{value:'gallery',label:'Gallery assets'}]} />
        {scope === 'gallery' && <Select aria-label="Asset folder" value={folder} onChange={value => { setFolder(value); setLimit(100); }} options={[{value:'*',label:'All local folders'},...Object.keys(gallery.data?.folders || {}).map(value => ({value,label:value || 'Root folder'}))]} />}
        <Input.Search aria-label="Find gallery assets" placeholder="Find assets…" value={query} allowClear onChange={event => { setQuery(event.target.value); setLimit(100); }} />
        <small style={{ color:token.colorTextSecondary }}>{files.length} images · Click to view · Right-click for actions</small>
        <div className="cg-asset-scroll"><div className="cg-asset-grid">{files.slice(0,limit).map(file => <Dropdown key={file.url} trigger={['contextMenu']} menu={{items:file.url.startsWith('/view?') ? [{key:'view',label:'Open in viewer'},{key:'download',label:'Download preview'}] : [
            {key:'view',label:'Open in viewer'},{key:'source',label:'Append image and prompts…'},{key:'prefix',label:'Use for prefix…'}, {key:'info',label:'Metadata'}, {key:'imagesearch',label:'Find related images…'}
        ],onClick:({key}) => action(file.url,key)}}><button className="cg-asset-card" onClick={() => action(file.url,'view')} aria-label={'View '+file.name}>
            <img loading="lazy" src={file.url.startsWith('/view?') ? BASE_PATH + file.url : `${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(file.url)}&root=${encodeURIComponent(gallery.settings.relativePath)}&v=${file.timestamp}`} alt=""/><span title={file.name}>{file.name}</span>
        </button></Dropdown>)}</div>{!files.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={scope === 'session' && !session.length ? 'Images generated in this browser session appear here.' : gallery.loading ? 'Loading assets…' : 'No matching images'} />}
        {files.length > limit && <Button block onClick={() => setLimit(value => value + 100)}>Load more</Button>}</div>
    </section>,element);
}

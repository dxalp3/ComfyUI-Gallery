import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Collapse, List, Modal, Progress, Select, Space, Tag, Typography } from 'antd';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { useHydrus } from './HydrusContext';
import { hydrusRequest } from './HydrusApi';
import type { HydrusBatch, HydrusItem, HydrusService } from './HydrusApi';
import { promptTags } from './PromptTags';
import { extractLocalPrompts } from './LocalImageSearch';
import { HydrusTagSelect } from './HydrusTagSelect';

export function HydrusExportModal() {
    const { exportUrls, setExportUrls, settings, setSettingsOpen, imageFiles, mergeItems } = useHydrus();
    const [tags, setTags] = useState<string[]>([]);
    const [sendMetadata, setSendMetadata] = useState(false);
    const [positiveTags, setPositiveTags] = useState(false);
    const [negativeTags, setNegativeTags] = useState(false);
    const [prefixPositive, setPrefixPositive] = useState(true);
    const [editedPromptTags, setEditedPromptTags] = useState<Record<string, string[]>>({});
    const [serviceKey, setServiceKey] = useState('');
    const [services, setServices] = useState<HydrusService[]>([]);
    const [servicesError, setServicesError] = useState('');
    const [loadingServices, setLoadingServices] = useState(false);
    const serviceRequest = useRef(0);
    const [results, setResults] = useState<Record<string, HydrusItem>>({});
    const [running, setRunning] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [activeUrl, setActiveUrl] = useState('');
    const stop = useRef(false);
    const busy = useRef(false);
    const urlsKey = JSON.stringify(exportUrls);
    useEffect(() => {
        setTags([]); setResults({}); setStopping(false); stop.current = false;
        setSendMetadata(settings?.send_metadata || false);
        setPositiveTags(settings?.positive_prompt_tags || false);
        setNegativeTags(settings?.negative_prompt_tags || false);
        setPrefixPositive(settings?.prefix_positive_prompt_tags ?? true);
        setServiceKey(settings?.tag_service_key || '');
        setEditedPromptTags({});
    }, [urlsKey]);
    useEffect(() => () => { stop.current = true; }, []);

    const loadServices = async () => {
        const version = ++serviceRequest.current;
        setLoadingServices(true); setServicesError('');
        try {
            const result = await hydrusRequest<{ services: HydrusService[] }>('services', {});
            if (version === serviceRequest.current) setServices(result.services);
        }
        catch (reason) { if (version === serviceRequest.current) setServicesError(reason instanceof Error ? reason.message : String(reason)); }
        finally { if (version === serviceRequest.current) setLoadingServices(false); }
    };
    useEffect(() => {
        setServices([]);
        setLoadingServices(false);
        ++serviceRequest.current;
        if (exportUrls.length && settings?.has_access_key) void loadServices();
        return () => { ++serviceRequest.current; };
    }, [urlsKey, settings?.url, settings?.profile, settings?.has_access_key]);

    const proposedTags = useMemo(() => Object.fromEntries(exportUrls.map(url => {
        if (!positiveTags && !negativeTags) return [url, []];
        const prompts = extractLocalPrompts(imageFiles[url]?.metadata);
        return [url, [...(positiveTags ? promptTags(prompts.positive, prefixPositive ? 'positive_prompt' : '') : []),
            ...(negativeTags ? promptTags(prompts.negative, 'negative_prompt') : [])]];
    })), [urlsKey, imageFiles, positiveTags, negativeTags, prefixPositive]);
    const imageTags = (url: string): string[] => editedPromptTags[url] ?? proposedTags[url] ?? [];
    const serviceOptions = services.filter(service => [0, 5].includes(service.type)).map(service => ({ value: service.service_key, label: service.name }));
    if (serviceKey && !serviceOptions.some(option => option.value === serviceKey)) serviceOptions.push({ value: serviceKey, label: `Saved service (${serviceKey.slice(0, 12)}…)` });

    const run = async (urls: string[]) => {
        if (busy.current) return;
        busy.current = true;
        stop.current = false; setStopping(false); setRunning(true);
        // Clear only this attempt, retaining the completed portion of a bulk operation.
        setResults(previous => Object.fromEntries(Object.entries(previous).filter(([url]) => !urls.includes(url))));
        try {
            for (const url of urls) {
                if (stop.current) break;
                setActiveUrl(url);
                let item: HydrusItem;
                try {
                    const response = await hydrusRequest<HydrusBatch>('export', { urls: [url], tags: [...tags, ...imageTags(url)], tag_service_key: serviceKey, send_metadata: sendMetadata });
                    item = response.items.find(entry => entry.url === url) || { url, success: false, error: 'No result returned for this image.' };
                    mergeItems([item]);
                } catch (error) {
                    item = { url, success: false, error: error instanceof Error ? error.message : String(error) };
                }
                setResults(previous => ({ ...previous, [url]: item }));
            }
        } finally { setActiveUrl(''); setRunning(false); busy.current = false; }
    };
    const completed = Object.keys(results).length;
    const failed = exportUrls.filter(url => results[url] && (results[url].success === false || !!results[url].error));
    const pending = exportUrls.filter(url => !results[url]);
    const hasTags = tags.length > 0 || !!settings?.default_tags?.length || exportUrls.some(url => imageTags(url).length > 0);
    const invalidTags = exportUrls.some(url => {
        const values = [...(settings?.default_tags || []), ...tags, ...imageTags(url)];
        return values.length > 500 || values.some(tag => tag.length > 1024);
    });
    const ready = !!settings?.has_access_key && (!hasTags || !!serviceKey) && !invalidTags;

    return <Modal title={`Export to Hydrus · ${exportUrls.length} image${exportUrls.length === 1 ? '' : 's'}`}
        open={exportUrls.length > 0} zIndex={BASE_Z_INDEX + 20} width={680}
        styles={{ body: { maxHeight: '65vh', overflowY: 'auto', paddingRight: 8 } }}
        onCancel={() => { if (!running) setExportUrls([]); }} maskClosable={!running} closable={!running}
        keyboard={!running}
        footer={<Space wrap>
            {running ? <Button onClick={() => { stop.current = true; setStopping(true); }} disabled={stopping} danger>
                {stopping ? 'Stopping after current image…' : 'Cancel remaining'}</Button> : <>
                <Button onClick={() => setExportUrls([])}>{completed ? 'Done' : 'Cancel'}</Button>
                {failed.length > 0 && <Button disabled={!ready} onClick={() => run(failed)}>Retry failed ({failed.length})</Button>}
                {pending.length > 0 && <Button type="primary" disabled={!ready} onClick={() => run(pending)}>
                    {completed ? 'Export remaining' : 'Export'} ({pending.length})</Button>}
            </>}
        </Space>}>
        <Typography.Paragraph>Original image files are imported without conversion. Hydrus recognises duplicates by their file hash. Exporting again can add tags and update the optional Gallery note.</Typography.Paragraph>
        {!settings?.has_access_key && <Alert type="warning" showIcon message="Set up your Hydrus connection first" action={<Button onClick={() => setSettingsOpen(true)}>Open settings</Button>} style={{ marginBottom: 16 }} />}
        <Typography.Text strong>Tag service for this export</Typography.Text>
        <Space.Compact style={{ width: '100%', margin: '6px 0' }}>
            <Select aria-label="Export tag service" value={serviceKey || undefined} onChange={value => setServiceKey(value || '')} allowClear showSearch optionFilterProp="label" loading={loadingServices} disabled={running} options={serviceOptions} placeholder="Choose a tag service" style={{ flex: 1 }} />
            <Button disabled={running} loading={loadingServices} onClick={loadServices}>Reload services</Button>
        </Space.Compact>
        <Typography.Paragraph type="secondary">Starts with your saved default. Changing it here applies only to this export.</Typography.Paragraph>
        {servicesError && <Alert type="warning" showIcon message={servicesError} style={{ marginBottom: 12 }} />}
        <Typography.Text strong>Default tags</Typography.Text>
        <div style={{ margin: '6px 0 16px' }}>{settings?.default_tags?.length ? settings.default_tags.map(tag => <Tag key={tag}>{tag}</Tag>) : <Typography.Text type="secondary">None</Typography.Text>}</div>
        <Typography.Text strong>Additional tags for this export</Typography.Text>
        <HydrusTagSelect label="Additional Hydrus tags" value={tags} onChange={setTags} disabled={running} active={exportUrls.length > 0}
            serviceKey={serviceKey} style={{ width: '100%', margin: '6px 0 16px' }} />
        {hasTags && !serviceKey && <Alert type="warning" showIcon message="Choose a tag service above to send tags." style={{ marginBottom: 12 }} />}
        <Space direction="vertical" style={{ marginBottom: 8 }}>
            <Checkbox checked={positiveTags} disabled={running} onChange={event => { setPositiveTags(event.target.checked); setEditedPromptTags({}); }}>Add positive-prompt tags</Checkbox>
            {positiveTags && <Checkbox checked={prefixPositive} disabled={running} onChange={event => { setPrefixPositive(event.target.checked); setEditedPromptTags({}); }} style={{ marginLeft: 24 }}>Prefix positive tags with positive_prompt:</Checkbox>}
            <Checkbox checked={negativeTags} disabled={running} onChange={event => { setNegativeTags(event.target.checked); setEditedPromptTags({}); }}>Add negative-prompt tags</Checkbox>
        </Space>
        <Typography.Paragraph type="secondary">Split on commas and newlines. Positive tags can be plain (blue sky) or prefixed (positive_prompt:blue sky); negative tags use negative_prompt:. Review each image below. Changing these options resets the preview edits.</Typography.Paragraph>
        {(positiveTags || negativeTags) && <Collapse style={{ marginBottom: 16 }} items={[{ key: 'preview', label: 'Review and edit prompt tags per image', children: exportUrls.map(url => <div key={url} style={{ marginBottom: 12 }}>
            <Typography.Text>{imageFiles[url]?.name || url}</Typography.Text>
            <HydrusTagSelect label={`Prompt tags for ${imageFiles[url]?.name || url}`} value={imageTags(url)} onChange={values => setEditedPromptTags(previous => ({ ...previous, [url]: values }))} disabled={running} active={exportUrls.length > 0} serviceKey={serviceKey} style={{ width: '100%' }} placeholder="Type to find or add tags" />
        </div>) }]} />}
        {invalidTags && <Alert type="warning" message="Shorten the tag preview: at most 500 tags per image and 1,024 characters per tag are supported." style={{ marginBottom: 12 }} />}
        <Checkbox checked={sendMetadata} disabled={running} onChange={event => setSendMetadata(event.target.checked)}>Send generation metadata as a Hydrus note</Checkbox>
        <Typography.Paragraph type="secondary" style={{ margin: '6px 0 16px' }}>Includes available prompt, workflow and parameters; requires notes permission. Existing embedded metadata stays in the original image either way.</Typography.Paragraph>
        {(running || completed > 0) && <div aria-live="polite">
            <Progress percent={Math.round(completed / exportUrls.length * 100)} status={running ? 'active' : failed.length ? 'exception' : undefined} />
            <Typography.Paragraph>{completed} of {exportUrls.length} processed · {completed - failed.length} succeeded · {failed.length} failed{pending.length > 0 && !running ? ` · ${pending.length} remaining` : ''}</Typography.Paragraph>
        </div>}
        <List size="small" style={{ maxHeight: 300, overflowY: 'auto' }} dataSource={exportUrls} renderItem={url => {
            const result = results[url];
            const failure = result?.success === false || !!result?.error;
            return <List.Item><div style={{ minWidth: 0, width: '100%' }}>
                <Space><Tag color={url === activeUrl ? 'processing' : result ? failure ? 'red' : 'green' : 'default'}>
                    {url === activeUrl ? 'Exporting' : result ? failure ? 'Failed' : 'Exported' : 'Waiting'}</Tag>
                    <Typography.Text ellipsis style={{ maxWidth: 410 }} title={url}>{imageFiles[url]?.name || url}</Typography.Text></Space>
                {result?.error && <div><Typography.Text type="danger">{result.error}</Typography.Text></div>}
                {result?.warnings?.map((warning, index) => <div key={index}><Typography.Text type="warning">{warning}</Typography.Text></div>)}
            </div></List.Item>;
        }} />
        {stopping && <Alert type="info" message="The current import finishes safely. Images still waiting will remain available to export later." style={{ marginTop: 12 }} />}
    </Modal>;
}

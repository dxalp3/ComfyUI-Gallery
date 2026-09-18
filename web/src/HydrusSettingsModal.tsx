import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Typography } from 'antd';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { useHydrus } from './HydrusContext';
import { hydrusRequest } from './HydrusApi';
import type { HydrusSettings, HydrusTest, HydrusService } from './HydrusApi';
import { HydrusTagSelect } from './HydrusTagSelect';

export function HydrusSettingsModal() {
    const { settings, settingsOpen, setSettingsOpen, settingsSaved } = useHydrus();
    const [form] = Form.useForm();
    const [busy, setBusy] = useState<'test' | 'save'>();
    const [error, setError] = useState('');
    const [test, setTest] = useState<HydrusTest>();
    const [services, setServices] = useState<HydrusService[]>([]);
    const [loadingServices, setLoadingServices] = useState(false);
    const [servicesError, setServicesError] = useState('');
    const serviceRequest = useRef(0);

    useEffect(() => {
        const version = ++serviceRequest.current;
        setLoadingServices(false);
        if (!settingsOpen) return;
        form.setFieldsValue({ url: 'http://127.0.0.1:45869', profile: 'main', timeout_seconds: 30,
            tag_service_key: '', default_tags: [], send_metadata: false, prefix_positive_prompt_tags: true, ...settings, access_key: '', clear_access_key: false });
        setError('');
        setTest(undefined);
        setServices([]);
        setServicesError('');
        if (!settings?.has_access_key) return;
        let cancelled = false;
        setLoadingServices(true);
        hydrusRequest<{ services: HydrusService[] }>('services', {}).then(result => {
            if (!cancelled && version === serviceRequest.current) setServices(result.services);
        }).catch(reason => { if (!cancelled && version === serviceRequest.current) setServicesError(reason.message); })
            .finally(() => { if (!cancelled && version === serviceRequest.current) setLoadingServices(false); });
        return () => { cancelled = true; };
    }, [settingsOpen, settings, form]);

    const loadServices = async () => {
        const version = ++serviceRequest.current;
        setLoadingServices(true); setServicesError('');
        try {
            const result = await hydrusRequest<{ services: HydrusService[] }>('services', form.getFieldsValue());
            if (version === serviceRequest.current) setServices(result.services);
        } catch (reason) { if (version === serviceRequest.current) setServicesError(reason instanceof Error ? reason.message : String(reason)); }
        finally { if (version === serviceRequest.current) setLoadingServices(false); }
    };

    const submit = async (action: 'test' | 'save') => {
        try {
            const values = await form.validateFields();
            setBusy(action);
            setError('');
            const payload = { ...values, access_key: values.access_key?.trim() || undefined, tag_service_key: values.tag_service_key || '' };
            if (action === 'test') {
                ++serviceRequest.current; setLoadingServices(false);
                const result = await hydrusRequest<HydrusTest>('test', payload);
                setTest(result);
                setServices(result.services || []);
                if (!result.ok) setError(result.error || 'Could not connect to Hydrus.');
            } else {
                settingsSaved(await hydrusRequest<HydrusSettings>('settings', payload));
                form.setFieldValue('access_key', '');
                setSettingsOpen(false);
            }
        } catch (reason) {
            if (reason instanceof Error) setError(reason.message);
        } finally { setBusy(undefined); }
    };

    const tagServices = services.filter(service => [0, 5].includes(service.type));
    const selectedService = Form.useWatch('tag_service_key', form);
    const serviceOptions = tagServices.map(service => ({ value: service.service_key, label: service.name }));
    if (selectedService && !serviceOptions.some(service => service.value === selectedService)) {
        serviceOptions.push({ value: selectedService, label: `Saved service (${selectedService.slice(0, 12)}…)` });
    }

    return <Modal title="Hydrus connection" open={settingsOpen} zIndex={BASE_Z_INDEX + 50} width={620}
        styles={{ body: { maxHeight: '65vh', overflowY: 'auto', paddingRight: 8 } }}
        onCancel={() => { if (!busy) { form.setFieldValue('access_key', ''); setSettingsOpen(false); } }}
        maskClosable={!busy} closable={!busy}
        footer={<Space><Button disabled={!!busy} onClick={() => { form.setFieldValue('access_key', ''); setSettingsOpen(false); }}>Cancel</Button>
            <Button loading={busy === 'test'} disabled={busy === 'save'} onClick={() => submit('test')}>Test connection</Button>
            <Button type="primary" loading={busy === 'save'} disabled={busy === 'test'} onClick={() => submit('save')}>Save connection</Button></Space>}>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Connect your main Hydrus client"
            description="Enable the Client API in Hydrus and grant an API key permission to import files and search/view all files. Add Manage Pages for open-page browsing, plus tags and notes permissions for those features. The address is reached from the ComfyUI server." />
        <Form form={form} layout="vertical" disabled={!!busy} onValuesChange={changed => {
            if ('url' in changed || 'access_key' in changed || 'profile' in changed || 'clear_access_key' in changed) {
                ++serviceRequest.current; setLoadingServices(false); setTest(undefined); setServices([]); setServicesError('');
                form.setFieldValue('tag_service_key', '');
            }
        }}>
            <Form.Item name="url" label="Client API URL" rules={[{ required: true, message: 'Enter the Hydrus Client API URL.' },
                { pattern: /^https?:\/\//i, message: 'Use an http:// or https:// URL.' }]}>
                <Input placeholder="http://127.0.0.1:45869" autoComplete="off" />
            </Form.Item>
            <Form.Item name="access_key" label="API access key"
                extra={settings?.has_access_key ? 'A key is saved on the ComfyUI server. Leave blank to keep it.' : 'Stored on the ComfyUI server; never saved in browser storage.'}>
                <Input.Password autoComplete="new-password" placeholder={settings?.has_access_key ? 'Saved key ••••••••' : 'Paste your Client API access key'} />
            </Form.Item>
            {settings?.has_access_key && <Form.Item name="clear_access_key" label="Remove saved API key" valuePropName="checked"><Switch /></Form.Item>}
            <Form.Item name="tag_service_key" label="Default tag service" extra="Preselected for exports; each export can choose a different service. Optional when sending no tags.">
                <Select aria-label="Default Hydrus tag service" loading={loadingServices} allowClear showSearch optionFilterProp="label" placeholder="Choose a tag service" options={serviceOptions} />
            </Form.Item>
            <Button size="small" loading={loadingServices} onClick={loadServices} style={{ marginBottom: 12 }}>Reload tag services</Button>
            {servicesError && <Alert type="warning" message={servicesError} style={{ marginBottom: 12 }} />}
            <Form.Item name="default_tags" label="Default export tags" extra="Press Enter after each tag. Namespace tags such as source:comfyui are supported.">
                <HydrusTagSelect label="Default export tags" active={settingsOpen} disabled={!!busy} serviceKey={selectedService} placeholder="Type for recommendations or add a new tag" />
            </Form.Item>
            <Form.Item name="send_metadata" label="Send generation metadata as a note by default" extra="Includes available prompts and workflow in a Hydrus note. This option does not create tags." valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="positive_prompt_tags" label="Suggest positive-prompt tags by default" extra="Review and edit the generated tags in the export dialog." valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="prefix_positive_prompt_tags" label="Prefix positive-prompt tags by default" extra="On: positive_prompt:blue sky. Off: blue sky. Each export can override this choice." valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="negative_prompt_tags" label="Suggest negative-prompt tags by default" extra="Review and edit separate negative_prompt: tags in the export dialog." valuePropName="checked"><Switch /></Form.Item>
            <Space align="start" size="large">
                <Form.Item name="profile" label="Client profile" extra="Use a new name if this address points to a different Hydrus database." rules={[{ required: true }]}><Input /></Form.Item>
                <Form.Item name="timeout_seconds" label="Request timeout (seconds)"><InputNumber min={5} max={300} /></Form.Item>
            </Space>
        </Form>
        {test?.ok && <Alert type="success" showIcon message="Connected to Hydrus" description={<>
            <div>{test.permissions?.permits_everything ? 'All API permissions granted.' : `Granted permission IDs: ${test.permissions?.basic_permissions?.join(', ') || 'not reported'}.`}</div>
            <Typography.Text>{tagServices.length} tag service(s) available.</Typography.Text>
            {test.capabilities?.search && <div>Search check: {test.capabilities.search.ok ? 'passed' : 'failed — see details below'}.</div>}
        </>} />}
        {test?.warnings?.map((warning, index) => <Alert key={index} type="warning" showIcon message={warning} style={{ marginTop: 8 }} />)}
        {error && <Alert type="error" showIcon message={error} style={{ marginTop: 8 }} />}
    </Modal>;
}

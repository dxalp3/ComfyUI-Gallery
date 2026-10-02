const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const seeded = await page.request.post('http://127.0.0.1:8191/qa-sync-conflict');
        assert.equal(seeded.status(), 200);
        const state = await seeded.json();
        assert.equal(state.jobs.filter(job => job.state === 'conflict').length, 1);
        await page.goto('http://127.0.0.1:8191/Gallery/app');
        await page.getByRole('button', { name: /Sync · 1 conflicts/ }).click();
        const modal = page.getByRole('dialog', { name: 'Hydrus background synchronization' });
        await modal.getByText(/Conflict · note/).click();
        await modal.getByText('{"positive": "local edited prompt"}', { exact: true }).waitFor();
        await modal.getByText('{"positive": "remote edited prompt"}', { exact: true }).waitFor();
        if (process.env.SYNC_SCREENSHOT) { await page.waitForTimeout(500); await page.screenshot({ path: process.env.SYNC_SCREENSHOT }); }
        await modal.getByRole('button', { name: 'Keep both as separate notes' }).click();
        await modal.getByText('No pending changes.').waitFor({ timeout: 20000 });
        const remote = await (await page.request.get('http://127.0.0.1:8191/qa-state')).json();
        const notes = Object.values(Object.values(remote.files)[0].notes);
        assert(notes.includes('{"positive": "remote edited prompt"}'));
        assert(notes.includes('{"positive": "local edited prompt"}'));
        assert.deepEqual(errors, []);
        console.log('PASS real durable conflict, visible note previews, keep-both resolution and background completion.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

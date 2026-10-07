const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
 const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 const base = 'http://127.0.0.1:8191';
 try {
  await page.goto(base); await page.getByRole('tab', { name: 'Gallery workspace', exact: true }).click();
  await page.getByAltText('study-1.png', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create prefix from selection', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Prompts & prefixes', exact: true });
  await manager.getByRole('textbox', { name: 'Prefix name', exact: true }).fill('image reference');
  const terms = manager.getByRole('combobox', { name: 'Prefix tags', exact: true });
  await terms.fill('blue_eyes'); await terms.press('Enter'); await terms.press('Escape');
  const saved = page.waitForResponse(response => response.url().endsWith('/Gallery/prefixes') && response.request().method() === 'POST');
  await manager.getByRole('button', { name: 'Save prefix', exact: true }).click();
  assert.equal((await saved).status(), 200);
  let library = (await (await page.request.get(base + '/Gallery/prefixes')).json()).library;
  const prefix = library.prefixes.find(row => row.name === 'image reference'); assert(prefix);
  const values = prefix.tags.map(id => library.tags.find(tag => tag.id === id).text);
  assert(values.includes('azure sky')); assert(values.includes('mountain')); assert(values.includes('blue_eyes'));
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  // Existing external node opens the shared manager, preserving its node class/output.
  await page.evaluate(() => {
   const node = { comfyClass: 'TagPrefixPromptLibrary', type: 'TagPrefixPromptLibrary', title: 'Prompt Library', properties: {}, widgets: [
    { name: 'prefix', value: '' }, { name: 'Open prompt library', callback: () => { throw Error('Legacy manager should be replaced'); } }
   ], setDirtyCanvas() {} };
   window.comfyAPI.app.app.graph.add(node); window.qaExtension.nodeCreated(node);
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => window.qaNodes[0].widgets[1].callback());
  await manager.waitFor();
  await manager.getByRole('button', { name: 'Library search…', exact: true }).click();
  const libraryWindow = page.getByRole('dialog', { name: 'Library search', exact: true });
  const row = libraryWindow.locator('div').filter({ has: page.getByText('image reference', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Append prefix to node', exact: true }) }).last();
  await row.getByRole('button', { name: 'Append prefix to node', exact: true }).click();
  await page.waitForFunction(() => window.qaNodes[0].widgets[0].value.includes('blue eyes'));
  assert.equal(await page.evaluate(() => window.qaNodes[0].properties.prompt_library_selected_prefix), prefix.id);
  // Tag spelling is a gallery setting now, not a checkbox in the manager.
  const setSpaces = value => page.evaluate(value => { const settings = JSON.parse(localStorage.getItem('comfy-ui-gallery-settings') || '{}'); settings.preferPromptSpaces = value; localStorage.setItem('comfy-ui-gallery-settings', JSON.stringify(settings)); }, value);
  await setSpaces(false); await row.getByRole('button', {name:'Append prefix to node',exact:true}).click();
  await page.waitForFunction(() => window.qaNodes[0].widgets[0].value.includes('blue_eyes'));
  await setSpaces(true);
  await libraryWindow.getByRole('button', { name: 'Close', exact: true }).click();
  // Create a new prefix from the node manager and immediately find it in local search.
  await manager.getByRole('textbox', { name: 'Prefix name', exact: true }).fill('sky selection');
  const picker = manager.getByRole('combobox', { name: 'Prefix tags', exact: true });
  // The node manager starts with an empty draft on a node with no previous selection.
  await picker.fill('azure sky'); await picker.press('Enter'); await picker.press('Escape');
  await picker.fill('mountain'); await picker.press('Enter'); await picker.press('Escape');
  const savedAgain = page.waitForResponse(response => response.url().endsWith('/Gallery/prefixes') && response.request().method() === 'POST');
  await manager.getByRole('button', { name: 'Save prefix', exact: true }).click(); assert.equal((await savedAgain).status(), 200);
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Filter local files', exact: true });
  await search.fill('@sky selection'); await search.press('Enter'); await search.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('[data-gallery-entry]').length === 1);
  assert.equal(await page.locator('.cg-search .ant-select-selection-item').count(), 2);
  // A copied prefix expansion must also split, even though it has no @name.
  while (await page.locator('.cg-search .ant-select-selection-item-remove').count()) await page.locator('.cg-search .ant-select-selection-item-remove').first().click();
  await search.fill('azure sky, mountain'); await search.press('Enter'); await search.press('Escape');
  assert.equal(await page.locator('.cg-search .ant-select-selection-item').count(), 2);
  // Append persists the manifest and presents the actual image on the node.
  await page.getByAltText('study-1.png', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Append to Image Source (1)', exact: true }).click();
  const appendDialog = page.getByRole('dialog', { name: 'Append images and prompts', exact: true });
  await appendDialog.getByRole('button', {name:'Create prefix from this image',exact:true}).click();
  await manager.getByRole('textbox', {name:'Prefix name',exact:true}).fill('nested image draft');
  await manager.getByRole('button', {name:'Close',exact:true}).click();
  await appendDialog.getByRole('button', { name: 'Append to workflow', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Gallery Image Source', exact: true }); await editor.waitFor();
  const state = await page.evaluate(() => {
   const node = window.qaNodes.find(node => node.comfyClass === 'GalleryImageSource');
   return { data: JSON.parse(node.widgets.find(widget => widget.name === 'sources').value), type: node.widgets.find(widget => widget.name === 'sources').type };
  });
  assert.equal(state.data.images.length, 1); assert.notEqual(state.type, 'hidden');
  await page.waitForFunction(() => document.querySelector('.gallery-source-node-preview img')?.naturalWidth > 0);
  assert.match(await page.locator('.gallery-source-node-preview').innerText(), /1 image\(s\)/);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  if (process.env.GALLERY_QA_SCREENSHOT) await page.locator('.gallery-source-node-preview').screenshot({ path: process.env.GALLERY_QA_SCREENSHOT });
  assert.deepEqual(errors, []);
  console.log('PASS image-derived prefix, existing Prompt Library integration, shared search expansion, space formatting and visible serialized Image Source preview.');
 } catch (error) { console.log(await page.locator('body').innerText()); throw error; }
 finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

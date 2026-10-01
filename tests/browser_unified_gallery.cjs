const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.GALLERY_QA_URL || 'http://127.0.0.1:8191';
 const choose=async(label,option)=>{await page.getByRole('combobox',{name:label,exact:true}).press('ArrowDown');await page.getByTitle(option,{exact:true}).click();};
 try {
  await page.goto(base);
  await page.getByRole('button',{name:'Open Gallery',exact:true}).click();
  await page.locator('[data-gallery-entry]').first().waitFor();
  assert.equal(await page.locator('[data-gallery-entry]').count(),4);
  await page.getByRole('checkbox',{name:'Select study-4.png',exact:true}).click();
  await page.getByAltText('study-4.png',{exact:true}).click();
  let viewer=page.getByRole('dialog',{name:/Gallery viewer/});
  assert.equal(await viewer.getByRole('checkbox',{name:'Selected',exact:true}).isChecked(),true);
  await viewer.getByAltText('Viewing study-4.png').click({button:'right'});
  await page.getByRole('menuitem',{name:'Deselect image',exact:true}).click();
  assert.equal(await viewer.getByRole('checkbox',{name:'Selected',exact:true}).isChecked(),false);
  await viewer.getByAltText('Viewing study-4.png').click({button:'right'});
  await page.getByRole('menuitem',{name:'Export local selection to Hydrus',exact:true}).click();
  const exporter=page.getByRole('dialog',{name:/Export to Hydrus/});
  await exporter.getByRole('button',{name:'Close',exact:true}).click();
  await viewer.getByRole('button',{name:'Next image',exact:true}).click();
  await viewer.getByRole('checkbox',{name:'Selected',exact:true}).click();
  await viewer.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await page.getByRole('checkbox',{name:'Select study-3.png',exact:true}).isChecked(),true);
  await page.getByText('Both',{exact:true}).click();
  await choose('Hydrus search order','Pixel hash');
  await page.getByText('Advanced OR groups (0)',{exact:true}).click();
  await page.getByRole('button',{name:'Add OR group',exact:true}).click();
  const group=page.getByRole('combobox',{name:'OR group 1',exact:true});
  await group.fill('blue eyes');await group.press('Enter');await group.fill('green eyes');await group.press('Enter');await group.press('Escape');
  const request=page.waitForRequest(r=>r.url().endsWith('/Gallery/hydrus/search'));
  await page.getByRole('button',{name:'Search',exact:true}).click();
  const payload=(await request).postDataJSON();assert.equal(payload.file_sort_type,21);assert.deepEqual(payload.or_groups,[['blue eyes','green eyes']]);
  await page.waitForFunction(()=>document.querySelectorAll('[data-gallery-entry]').length===8);
  assert.equal(await page.getByLabel('Unified gallery',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Clear selection',exact:true}).click();
  await page.getByRole('button',{name:'Select all shown (8)',exact:true}).click();
  const remote=page.locator('[data-gallery-entry^="hydrus:"]').first();
  const remoteName=await remote.getAttribute('aria-label');
  await remote.getByRole('img').click();
  viewer=page.getByRole('dialog',{name:/Gallery viewer/});
  await viewer.getByAltText('Viewing '+remoteName).waitFor();
  await page.waitForFunction(()=>{const im=document.querySelector('img[alt^="Viewing #"]');return im?.complete&&im.naturalWidth>0;});
  assert.equal(await viewer.getByRole('checkbox',{name:'Selected',exact:true}).isChecked(),true);
  await viewer.getByAltText('Viewing '+remoteName).click({button:'right'});
  await page.getByRole('menuitem',{name:'Deselect image',exact:true}).click();
  await viewer.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await remote.getByRole('checkbox').isChecked(),false);
  // Append a mixed selection into the actual source bridge and simulated graph.
  await page.getByRole('button',{name:'Append to Image Source (7)',exact:true}).click();
  await page.waitForFunction(()=>window.qaNodes.length===1&&JSON.parse(window.qaNodes[0].widgets.find(w=>w.name==='sources').value).images.length===7);
  // Mount and unmount through the documented sidebar extension callbacks.
  await page.evaluate(()=>{const host=document.createElement('div');host.id='qa-sidebar';host.style.cssText='width:600px;height:100vh;overflow:auto';document.body.appendChild(host);window.qaSidebar.render(host);});
  await page.locator('#qa-sidebar').getByText('Both',{exact:true}).waitFor();
  assert.equal(await page.locator('#qa-sidebar [data-gallery-entry] input:checked').count(),7);
  await page.getByRole('button',{name:'Expand gallery',exact:true}).click();
  await page.getByRole('button',{name:'Dock in sidebar',exact:true}).click();
  assert.equal(await page.locator('#qa-sidebar [data-gallery-entry] input:checked').count(),7);
  await page.evaluate(()=>window.qaSidebar.destroy());
  await page.getByRole('button',{name:'Open Gallery',exact:true}).click();
  await page.getByRole('button',{name:'Select all shown (8)',exact:true}).waitFor();
  await page.getByText('Hydrus',{exact:true}).first().click();
  await page.getByRole('tab',{name:'Open client pages',exact:true}).click();
  await page.getByText('Img2img references · active',{exact:true}).click();
  await page.getByRole('button',{name:'Select all shown (4)',exact:true}).waitFor();
  // Local prompt filter stays authoritative when advanced tools mount.
  await page.locator('.ant-segmented-item').filter({hasText:'Local'}).click();
  await page.getByRole('textbox',{name:'Filter local files',exact:true}).fill('winter');
  await page.waitForFunction(()=>document.querySelectorAll('[data-gallery-entry]').length===1);
  await page.getByText('Local tools and filters',{exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Search local images',exact:true}).inputValue(),'winter');
  if(process.env.GALLERY_QA_SCREENSHOT) await page.screenshot({path:process.env.GALLERY_QA_SCREENSHOT,fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Unified gallery browser checks passed: mixed grid, grouped search, original viewer, selection/context menus, mixed img2img append, sidebar docking, client pages; no page errors.');
 } catch(error) { if(process.env.GALLERY_QA_SCREENSHOT) await page.screenshot({path:process.env.GALLERY_QA_SCREENSHOT,fullPage:true});throw error; }
 finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});


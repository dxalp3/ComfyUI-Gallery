const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 const base=process.env.GALLERY_QA_URL || 'http://127.0.0.1:8191';
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.route('**/Gallery/images*',async route=>{
   const response=await route.fetch(); const fixture=await response.json(); const template=Object.values(fixture.folders.output)[0];
   const files={};for(let i=0;i<10000;i++){const name='frame-'+String(i).padStart(5,'0')+'.png';files[name]={...template,name,url:'/static_gallery/'+name,timestamp:1700000000+i};}
   await route.fulfill({json:{folders:{output:files}}});
  });
  const image=await (await page.request.get(base+'/static_gallery/study-1.png')).body();
  await page.route('**/Gallery/thumbnail?*',route=>route.fulfill({body:image,contentType:'image/png'}));
  await page.route('**/Gallery/hydrus/status',route=>route.fulfill({json:{items:[],summary:{total:0,succeeded:0,failed:0}}}));
  await page.goto(base);
  await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
  await page.getByRole('button',{name:'Select all shown (10000)',exact:true}).waitFor();
  await page.addStyleTag({content:'button,input,select{background:#fff;color:#111;border:1px solid #aaa;font-size:12px}button:hover{background:#eee}'});
  const box=await page.getByLabel('Unified gallery',{exact:true}).boundingBox();
  assert.ok(box.width>1400);assert.ok(box.height>760,JSON.stringify(box));
  assert.ok(await page.locator('[data-gallery-entry]').count()<100,'10,000 items must remain virtualized');
  await page.getByRole('checkbox',{name:'Select frame-09999.png',exact:true}).click();
  const scroll=page.getByLabel('Unified gallery',{exact:true}).locator('div[style*="overflow: auto"]').first();
  await scroll.evaluate(el=>{el.scrollTop=4000;});
  await page.waitForFunction(()=>!document.querySelector('[data-gallery-entry="local:/static_gallery/frame-09999.png"]'));
  const oldScroll=await scroll.evaluate(el=>el.scrollTop);
  await page.getByRole('tab',{name:'Second workflow',exact:true}).click();
  assert.equal(await page.locator('#comfy-gallery-workspace').isVisible(),false);
  await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
  assert.equal(await scroll.evaluate(el=>el.scrollTop),oldScroll);
  await page.getByText('1 selected',{exact:true}).waitFor();
  // Vue may replace the tab bar: ensure there is exactly one reattached gallery tab.
  await page.evaluate(()=>{const bar=document.querySelector('.workflow-tabs-container');const replacement=bar.cloneNode(true);replacement.querySelector('#comfy-gallery-workspace-tab').remove();bar.replaceWith(replacement);});
  await page.waitForFunction(()=>document.querySelectorAll('#comfy-gallery-workspace-tab').length===1);
  await page.getByRole('tab',{name:'Test workflow',exact:true}).click();
  await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
  // Verify a real workflow-load hook also returns to the canvas.
  await page.evaluate(()=>window.qaExtension.afterConfigureGraph());
  assert.equal(await page.locator('#comfy-gallery-workspace').isVisible(),false);
  await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
  const colours=await page.locator('#comfy-gallery-workspace').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color,button:getComputedStyle(el.querySelector('.ant-btn-default')).color}));
  assert.notEqual(colours.bg,colours.fg);assert.equal(colours.button,colours.fg);
  await page.getByRole('button',{name:'Clear selection',exact:true}).click();
  await scroll.evaluate(el=>{el.scrollTop=0;});
  if(process.env.GALLERY_QA_SCREENSHOT) await page.screenshot({path:process.env.GALLERY_QA_SCREENSHOT});
  // Changing the viewport keeps the workspace in the page rather than a modal.
  await page.setViewportSize({width:850,height:700});
  const narrow=await page.getByLabel('Unified gallery',{exact:true}).boundingBox();
  assert.ok(narrow.height>400);assert.equal(await page.getByRole('dialog',{name:'Gallery',exact:true}).count(),0);
  // Legacy/no-tab-bar fallback opens the same workspace, with a coherent light surface.
  await page.route('**/Gallery/settings',route=>route.fulfill({json:{relativePath:'./',darkMode:false,showDateDivider:false}}));
  await page.goto(base);
  await page.locator('#comfy-gallery-workspace-tab').waitFor();
  await page.evaluate(()=>document.querySelector('.workflow-tabs-container').remove());
  await page.getByRole('button',{name:'Open Gallery',exact:true}).click();
  await page.getByRole('button',{name:'Select all shown (10000)',exact:true}).waitFor();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#comfy-gallery-workspace')).backgroundColor==='rgb(255, 255, 255)');
  const light=await page.locator('#comfy-gallery-workspace').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color,top:el.getBoundingClientRect().top}));
  assert.notEqual(light.bg,light.fg);assert.equal(light.top,0);
  await page.getByRole('button',{name:'Workflow',exact:true}).click();
  assert.equal(await page.locator('#comfy-gallery-workspace').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: 10,000-file virtual grid, >76% viewport grid height, workflow/tab-bar remounts, retained scroll/selection, contrast under host CSS, responsive workspace, light theme and fallback launcher.');
 } catch(e) {if(process.env.GALLERY_QA_SCREENSHOT) await page.screenshot({path:process.env.GALLERY_QA_SCREENSHOT});throw e;}
 finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

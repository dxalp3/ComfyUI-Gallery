const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const page=await browser.newPage({viewport:{width:1650,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto('http://127.0.0.1:8191');await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
 await page.getByRole('button',{name:'Prompts & prefixes',exact:true}).click();
 const library=page.locator('[data-panel-key="prompt-library"]');await library.getByRole('button',{name:'Place panel right',exact:true}).click();
 await library.getByRole('textbox',{name:'Prefix name',exact:true}).fill('unsaved manual tagging');
 // The underlying grid remains clickable while the editor is open.
 await page.getByAltText('study-4.png',{exact:true}).click();
 const viewer=page.locator('[data-panel-key="viewer"]');await viewer.getByRole('button',{name:'Place panel left',exact:true}).click();
 const left=await viewer.boundingBox(),right=await library.boundingBox();assert(left.x+left.width<=right.x);
 await library.getByRole('textbox',{name:'Prefix name',exact:true}).fill('reference beside editor');
 await viewer.getByRole('button',{name:'Next image',exact:true}).click();await viewer.getByAltText('Viewing study-3.png',{exact:true}).waitFor();
 assert.equal(await library.getByRole('textbox',{name:'Prefix name',exact:true}).inputValue(),'reference beside editor');
 // Move using real pointer capture, then resize and confirm persistence.
 await viewer.getByRole('button',{name:'Reset panel layout'}).click();const beforeDrag=await viewer.boundingBox();const header=viewer.locator('strong').first();const h=await header.boundingBox();await page.mouse.move(h.x+30,h.y+8);await page.mouse.down();await page.mouse.move(h.x+70,h.y+48,{steps:5});await page.mouse.up();
 const moved=await viewer.boundingBox();assert(moved.x>=beforeDrag.x+35&&moved.y>=beforeDrag.y+35);
 const handle=await viewer.getByRole('separator',{name:'Resize panel'}).boundingBox();await page.mouse.move(handle.x+8,handle.y+8);await page.mouse.down();await page.mouse.move(handle.x-100,handle.y-100,{steps:5});await page.mouse.up();
 const resized=await viewer.boundingBox();assert(resized.width<moved.width-90);
 await viewer.getByRole('button',{name:'Collapse panel'}).click();assert((await viewer.boundingBox()).height<80);
 await library.getByRole('textbox',{name:'Prefix name'}).fill('draft survives collapse');
 await viewer.locator('strong').first().click({position:{x:15,y:8}});await viewer.getByRole('button',{name:'Expand panel'}).click();assert.equal((await viewer.boundingBox()).width,resized.width);
 await viewer.getByRole('button',{name:'Close',exact:true}).click();await page.getByAltText('study-4.png',{exact:true}).click();
 const reopened=await viewer.boundingBox();assert.equal(reopened.width,resized.width);assert.equal(reopened.x,resized.x);
 await viewer.getByRole('button',{name:'Place panel left'}).click();
 if(process.env.GALLERY_QA_SCREENSHOT)await page.screenshot({path:process.env.GALLERY_QA_SCREENSHOT});
 await page.setViewportSize({width:850,height:650});const bounded=await viewer.boundingBox();assert(bounded.x+bounded.width<=850&&bounded.y<650);
 await viewer.focus();await viewer.press('Escape');await viewer.waitFor({state:'detached'});assert.deepEqual(errors,[]);console.log('PASS side-by-side editable reference panels, unblocked grid, navigation, drag, resize, collapse, draft retention, saved geometry and viewport bounds.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

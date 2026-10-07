const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const page=await browser.newPage({viewport:{width:1550,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto('http://127.0.0.1:8191');await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
 await page.getByAltText('study-1.png',{exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'Append to Image Source (1)',exact:true}).click();
 const append=page.getByRole('dialog',{name:'Append images and prompts',exact:true});await append.getByRole('button',{name:'Create prefix from this image',exact:true}).click();
 const manager=page.getByRole('dialog',{name:'Prompts & prefixes',exact:true});await manager.getByRole('button',{name:'Clear positive terms',exact:true}).click();
 await manager.getByRole('textbox',{name:'Prefix name',exact:true}).fill('paired polarity');
 const positive=manager.getByRole('combobox',{name:'Prefix tags',exact:true});await positive.fill('standing');await positive.press('Enter');await positive.press('Escape');
 await manager.getByRole('tab',{name:/Negative terms/}).click();
 const negative=manager.getByRole('combobox',{name:'Negative prefix tags',exact:true});await negative.fill('blurry');await negative.press('Enter');await negative.press('Escape');
 const save=page.waitForResponse(r=>r.url().endsWith('/Gallery/prefixes')&&r.request().method()==='POST');await manager.getByRole('button',{name:'Save prefix',exact:true}).click();assert.equal((await save).status(),200);
 const linked=manager.locator('a[title="Open associated original image"]').first();await linked.waitFor();assert.match(await linked.getAttribute('href'),/study-1.png/);await linked.locator('img').evaluate(img=>img.decode());
 await manager.getByRole('button',{name:'Close',exact:true}).click();assert(await append.getByRole('checkbox',{name:'Load negative prompt',exact:true}).isChecked());
 await append.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByAltText('study-1.png',{exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'Append to Image Source (1)',exact:true}).click();
 await append.getByText('Image prefix paired · selected terms are enabled below',{exact:true}).waitFor();assert(await append.getByRole('checkbox',{name:'Load negative prompt',exact:true}).isChecked());
 await append.getByRole('button',{name:'Append to workflow',exact:true}).click();const editor=page.getByRole('dialog',{name:'Gallery Image Source',exact:true});await editor.waitFor();await editor.getByRole('button',{name:'Cancel',exact:true}).click();
 const actual=await page.evaluate(()=>JSON.parse(window.qaNodes.find(n=>n.comfyClass==='GalleryImageSource').widgets.find(w=>w.name==='sources').value).images[0].prompt);assert.equal(actual.negative,'blurry');assert.equal(actual.positive,'standing');
 await page.getByRole('button',{name:'Workflow',exact:true}).click();
 await page.evaluate(()=>{
  const graph=window.comfyAPI.app.app.graph;const source=graph._nodes.find(n=>n.comfyClass==='GalleryImageSource');window.qaSource=source;
  const widget=source.widgets.find(w=>w.name==='sources');const manifest=JSON.parse(widget.value);manifest.images.push({...manifest.images[0],title:'second reference',prompt:{positive:'sitting',negative:'watermark',tags:[]}});widget.value=JSON.stringify(manifest);source.__galleryRefreshPreview();
  graph.links={901:{origin_id:source.id,origin_slot:4},902:{origin_id:source.id,origin_slot:5}};
  for(const [name,link] of [['Positive',901],['Negative',902]]){const node={comfyClass:'GalleryPromptEncode',title:name,widgets:[{name:'text',value:'fallback '+name.toLowerCase()}],inputs:[{name:'source_text',link}],properties:{},setDirtyCanvas(){},addWidget(type,name,value,callback){this.widgets.push({type,name,value,callback});},addDOMWidget(name,type,element){element.dataset.encoder=name;document.querySelector('#qa-node-previews').append(element);return {name,type};}};graph.add(node);window.qaExtension.nodeCreated(node);}
 });
 const effective=(i,text)=>page.waitForFunction(([i,text])=>document.querySelectorAll('[data-encoder="prompt_boxes"]')[i]?.querySelector('details div')?.textContent===text,[i,text]);
 await effective(0,'fallback positive, standing');await effective(1,'fallback negative, blurry');
 await page.getByRole('button',{name:'Use image 2: second reference',exact:true}).click();
 await effective(0,'fallback positive, sitting');await effective(1,'fallback negative, watermark');
 assert.equal(await page.evaluate(()=>JSON.parse(window.qaSource.widgets.find(w=>w.name==='sources').value).active_index),1);
 await page.evaluate(()=>{const nodes=window.qaNodes.filter(n=>n.comfyClass==='GalleryPromptEncode');nodes.forEach(n=>{n.inputs[0].link=null;n.onConnectionsChange();});});
 await effective(0,'fallback positive');await effective(1,'fallback negative');
 await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();await page.getByRole('button',{name:'Prompts & prefixes',exact:true}).click();
 await manager.getByRole('button',{name:'Library search…',exact:true}).click();
 const library=page.getByRole('dialog',{name:'Library search',exact:true});
 await library.getByRole('combobox',{name:'Prompt vocabulary',exact:true}).press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByTitle('Saved prefixes & tags',{exact:true}).click();
 await library.getByRole('textbox',{name:'Find indexed prompt',exact:true}).fill('paired polarity');
 await library.getByRole('button',{name:'Negative: blurry',exact:true}).click();
 // Tag search opens in its own window and leaves the main gallery's filter alone until asked.
 const tagSearch=page.getByRole('dialog',{name:/^Tag search/});await tagSearch.getByText(/loaded image\(s\) match/).waitFor();
 assert.equal((await page.locator('.cg-search').textContent()||'').includes('blurry'),false);
 await tagSearch.getByRole('button',{name:'Show in main gallery',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.cg-search')?.textContent.includes('blurry'));
 assert.deepEqual(errors,[]);console.log('PASS negative pairing/reload, associated thumbnail links, individual tag search, active thumbnail selection, connected prompt display and fallback restoration.');
}catch(e){console.log(await page.locator('body').innerText());throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const page=await browser.newPage({viewport:{width:1650,height:1150}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const base='http://127.0.0.1:8191';
const choose=async(scope,label,title)=>{const input=scope.getByRole('combobox',{name:label,exact:true});if(label==='Danbooru wiki category')await input.fill('Hair Styles');await input.press('ArrowDown');const id=await input.getAttribute('aria-controls');await page.locator('[id="'+id+'"]').locator('xpath=ancestor::div[contains(@class,"ant-select-dropdown")][1]').getByTitle(title,{exact:true}).click();};
const value=()=>page.evaluate(()=>window.qaBulkNode.widgets[0].value);
try{
 for(const [name,terms,negative_terms] of [['bulk A',['standing','blue_eyes'],['blurry']],['bulk B',['sitting','green_eyes'],['watermark']]]){const state=await(await page.request.get(base+'/Gallery/prefixes')).json();const result=await page.request.post(base+'/Gallery/prefixes',{data:{action:'save',revision:state.revision,name,terms,negative_terms}});assert.equal(result.status(),200);}
 await page.goto(base);await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
 await page.evaluate(()=>{const host=document.createElement('div');host.id='qa-node-previews';document.body.append(host);const graph=window.comfyAPI.app.app.graph;const source={comfyClass:'GalleryImageSource',widgets:[{name:'sources',value:JSON.stringify({layout:'single',images:[{prompt:{positive:'image prompt'}}]})}]};graph.add(source);graph.links={51:{origin_id:source.id,origin_slot:4}};const node={comfyClass:'GalleryPromptEncode',title:'Positive',widgets:[{name:'text',value:'base'},{name:'source_mode',value:'after'}],inputs:[{name:'source_text',link:51}],properties:{},setDirtyCanvas(){},addWidget(type,name,value,callback){this.widgets.push({type,name,value,callback});},addDOMWidget(name,type,el){document.querySelector('#qa-node-previews').append(el);return {name,type};}};graph.add(node);window.qaExtension.nodeCreated(node);window.qaBulkNode=node;});
 await page.waitForFunction(()=>window.qaBulkNode.widgets.some(w=>w.name==='Open prompt library'));
 await page.evaluate(()=>window.qaBulkNode.widgets.find(w=>w.name==='Open prompt library').callback());
 const manager=page.getByRole('dialog',{name:'Prompts & prefixes',exact:true});const palette=manager.locator('.cg-prompt-palette');
 await palette.getByRole('textbox',{name:'Browse vocabulary',exact:true}).fill('blue_eyes');await palette.getByRole('button',{name:'Append blue_eyes',exact:true}).click();
 await page.waitForFunction(()=>window.qaBulkNode.widgets[0].value==='base, blue eyes');
 assert.equal(await page.getByRole('textbox',{name:'Effective encoder prompt',exact:true}).inputValue(),'base, blue eyes, image prompt');
 await page.evaluate(()=>{window.qaBulkNode.widgets[0].value='base';window.qaBulkNode.widgets[0].callback();});
 await palette.getByRole('tab',{name:'Prefixes',exact:true}).click();await palette.getByRole('textbox',{name:'Browse vocabulary',exact:true}).fill('bulk ');
 await palette.getByRole('button',{name:'Select all matching',exact:true}).click();await palette.getByRole('button',{name:'Append selected (2)',exact:true}).waitFor();
 await choose(palette,'Insertion format','Alternatives {a|b|c}');await choose(palette,'Insertion position','Prepend before');
 await palette.getByRole('spinbutton',{name:'Insertion weight',exact:true}).fill('1.2');await palette.getByRole('spinbutton',{name:'Insertion weight',exact:true}).press('Tab');
 await palette.getByRole('textbox',{name:'Insertion prefix',exact:true}).fill('quality, ');await palette.getByRole('textbox',{name:'Insertion suffix',exact:true}).fill(', detailed');
 await palette.getByRole('button',{name:'Append selected (2)',exact:true}).click();
 await page.waitForFunction(()=>window.qaBulkNode.widgets[0].value.startsWith('(quality, {standing'));
 assert.equal(await value(),'(quality, {standing, blue eyes|sitting, green eyes}, detailed:1.2), base');
 // Whole-category insertion ignores the current search and includes results beyond page one.
 await page.evaluate(()=>{window.qaBulkNode.widgets[0].value='base';window.qaBulkNode.widgets[0].callback();});
 await palette.getByRole('tab',{name:'Tags',exact:true}).click();await palette.getByRole('textbox',{name:'Browse vocabulary',exact:true}).fill('braid');
 await choose(palette,'Insertion position','Append after');await palette.getByRole('spinbutton',{name:'Insertion weight',exact:true}).fill('1');await palette.getByRole('spinbutton',{name:'Insertion weight',exact:true}).press('Tab');
 await palette.getByRole('textbox',{name:'Insertion prefix',exact:true}).fill('');await palette.getByRole('textbox',{name:'Insertion suffix',exact:true}).fill('');
 const catalog=await(await page.request.post(base+'/Gallery/hydrus/dictionary',{data:{browse:true,category:'tag_group:hair_styles',selection:true,limit:10000}})).json();const group=catalog.categories.find(x=>x.value==='tag_group:hair_styles');assert(catalog.total>60);
 await choose(palette,'Danbooru wiki category',group.label+' ('+group.count+')');
 await palette.getByRole('button',{name:'Append entire category as alternatives',exact:true}).click();await page.waitForFunction(()=>window.qaBulkNode.widgets[0].value.startsWith('base, {'));
 const formatted=await(await page.request.post(base+'/Gallery/hydrus/format_terms',{data:{terms:catalog.items.map(x=>x.name),prefer_spaces:true}})).json();
 assert.equal(await value(),'base, {'+[...new Set(formatted.terms)].join('|')+'}');
 // Select-all matching spans all pages too, and selection remains while paging.
 await palette.getByRole('textbox',{name:'Browse vocabulary',exact:true}).fill('');await palette.getByRole('button',{name:'Select all matching',exact:true}).click();
 await palette.getByRole('button',{name:'Append selected ('+catalog.total+')',exact:true}).waitFor();await palette.getByRole('button',{name:'Next vocabulary page',exact:true}).click();assert(await palette.getByRole('button',{name:'Append selected ('+catalog.total+')',exact:true}).isVisible());
 // Saving a definition does not overwrite the target prompt.
 const before=await value();await manager.getByRole('textbox',{name:'Prefix name',exact:true}).fill('saved without replacing');const tags=manager.getByRole('combobox',{name:'Prefix tags',exact:true});await tags.fill('cloud');await tags.press('Enter');await tags.press('Escape');const saved=page.waitForResponse(r=>r.url().endsWith('/Gallery/prefixes')&&r.request().method()==='POST');await manager.getByRole('button',{name:'Save prefix',exact:true}).click();assert.equal((await saved).status(),200);assert.equal(await value(),before);
 if(process.env.GALLERY_QA_SCREENSHOT)await manager.screenshot({path:process.env.GALLERY_QA_SCREENSHOT});
 assert.deepEqual(errors,[]);console.log('PASS individual and bulk direct insertion, prefix alternatives, weights/affixes, whole categories beyond one page, selection persistence, connected combined display and non-destructive definition save.');
}catch(e){if(process.env.GALLERY_QA_SCREENSHOT)await page.screenshot({path:process.env.GALLERY_QA_SCREENSHOT.replace(/\.png$/, '-error.png')});console.log(await page.locator('body').innerText());throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

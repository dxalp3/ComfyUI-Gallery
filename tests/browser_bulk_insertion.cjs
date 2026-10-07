const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const page=await browser.newPage({viewport:{width:1650,height:1150}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const base='http://127.0.0.1:8191';
const M='\u27e6source\u27e7';
const choose=async(scope,label,title)=>{const input=scope.getByRole('combobox',{name:label,exact:true});if(label==='Danbooru wiki categories')await input.fill(title.replace(/ \(\d+\)$/,''));await input.press('ArrowDown');const id=await input.getAttribute('aria-controls');await page.locator('[id="'+id+'"]').locator('xpath=ancestor::div[contains(@class,"ant-select-dropdown")][1]').getByTitle(title,{exact:true}).click();};
// The encoder compiles its boxes into the text widget; the source box is a marker the backend replaces when the workflow runs.
const value=()=>page.evaluate(()=>window.qaBulkNode.widgets[0].value);
const reset=()=>page.evaluate(()=>{window.qaBulkNode.__galleryPromptBoxes.insert('base','replace');});
const preview=text=>page.waitForFunction(text=>document.querySelector('#qa-node-previews details div')?.textContent===text,text);
const setInsertion=async(palette,{format,position,weight='1',prefix='',suffix=''})=>{await choose(palette,'Insertion format',format);await choose(palette,'Insertion position',position);
 await palette.getByRole('spinbutton',{name:'Insertion weight',exact:true}).fill(weight);await palette.getByRole('spinbutton',{name:'Insertion weight',exact:true}).press('Tab');
 await palette.getByRole('textbox',{name:'Insertion prefix',exact:true}).fill(prefix);await palette.getByRole('textbox',{name:'Insertion suffix',exact:true}).fill(suffix);};
const selectAll=palette=>palette.getByRole('button',{name:/^Select all matching/});
try{
 for(const [name,terms,negative_terms] of [['bulk A',['standing','blue_eyes'],['blurry']],['bulk B',['sitting','green_eyes'],['watermark']]]){const state=await(await page.request.get(base+'/Gallery/prefixes')).json();const result=await page.request.post(base+'/Gallery/prefixes',{data:{action:'save',revision:state.revision,name,terms,negative_terms}});assert.equal(result.status(),200);}
 await page.goto(base);await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
 await page.evaluate(()=>{const host=document.createElement('div');host.id='qa-node-previews';document.body.append(host);const graph=window.comfyAPI.app.app.graph;const source={comfyClass:'GalleryImageSource',widgets:[{name:'sources',value:JSON.stringify({layout:'single',images:[{prompt:{positive:'image prompt'}}]})}]};graph.add(source);graph.links={51:{origin_id:source.id,origin_slot:4}};const node={comfyClass:'GalleryPromptEncode',title:'Positive',widgets:[{name:'text',value:'base'},{name:'source_mode',value:'after'}],inputs:[{name:'source_text',link:51}],properties:{},setDirtyCanvas(){},addWidget(type,name,value,callback){this.widgets.push({type,name,value,callback});},addDOMWidget(name,type,el){document.querySelector('#qa-node-previews').append(el);return {name,type};}};graph.add(node);window.qaExtension.nodeCreated(node);window.qaBulkNode=node;});
 await page.waitForFunction(()=>window.qaBulkNode.widgets.some(w=>w.name==='Open prompt library'));
 // Existing text becomes a box; the old "after" source order becomes the source box position.
 await page.waitForFunction(m=>window.qaBulkNode.widgets[0].value==='base, '+m&&window.qaBulkNode.widgets.find(w=>w.name==='source_mode').value==='boxes',M);
 await page.evaluate(()=>window.qaBulkNode.widgets.find(w=>w.name==='Open prompt library').callback());
 const manager=page.getByRole('dialog',{name:'Prompts & prefixes',exact:true});const palette=manager.locator('.cg-prompt-palette');
 await palette.getByRole('textbox',{name:'Browse vocabulary',exact:true}).fill('blue_eyes');await palette.getByRole('button',{name:'Append blue_eyes',exact:true}).click();
 await page.waitForFunction(m=>window.qaBulkNode.widgets[0].value==='base, '+m+', blue eyes',M);
 await preview('base, image prompt, blue eyes');
 // A plain tag append is a new box called #2.
 assert.deepEqual(await page.evaluate(()=>window.qaBulkNode.properties.prompt_boxes.boxes.map(b=>b.kind==='group'?b.name:'source')),['#1','source','#2']);
 await reset();
 await palette.getByRole('tab',{name:'Prefixes',exact:true}).click();await palette.getByRole('textbox',{name:'Browse vocabulary',exact:true}).fill('bulk ');
 await selectAll(palette).click();await palette.getByRole('button',{name:'Append selected (2)',exact:false}).waitFor();
 await setInsertion(palette,{format:'Alternatives {a|b|c}',position:'Prepend before',weight:'1.2',prefix:'quality, ',suffix:', detailed'});
 await palette.getByRole('button',{name:'Append selected (2)',exact:false}).click();
 await page.waitForFunction(()=>window.qaBulkNode.widgets[0].value.startsWith('(quality, {standing'));
 assert.equal(await value(),'(quality, {standing, blue eyes|sitting, green eyes}, detailed:1.2), base, '+M);
 // Prefix appends keep the prefix names as the box title.
 assert.equal(await page.evaluate(()=>window.qaBulkNode.properties.prompt_boxes.boxes[0].name),'bulk A + bulk B');
 // Whole categories: the tag search and favorites still apply, so clear the search to take everything in the category.
 await reset();
 await palette.getByRole('tab',{name:'Tags',exact:true}).click();await palette.getByRole('textbox',{name:'Browse vocabulary',exact:true}).fill('');
 await setInsertion(palette,{format:'Alternatives {a|b|c}',position:'Append after'});
 const hairKey='tag_group:hair_styles',attireKey='tag_group:attire';
 const browse=async categories=>(await(await page.request.post(base+'/Gallery/hydrus/dictionary',{data:{browse:true,categories,selection:true,limit:10000}})).json());
 const spelled=async items=>[...new Set((await(await page.request.post(base+'/Gallery/hydrus/format_terms',{data:{terms:items.map(x=>x.name),prefer_spaces:true}})).json()).terms)];
 const hair=await browse([hairKey]);assert(hair.total>60);const hairGroup=hair.categories.find(x=>x.value===hairKey);
 await choose(palette,'Danbooru wiki categories',hairGroup.label+' ('+hairGroup.count+')');
 await palette.getByRole('combobox',{name:'Danbooru wiki categories',exact:true}).press('Escape');
 // Select-all spans every page, and the selection survives paging.
 await selectAll(palette).click();await palette.getByRole('button',{name:'Append selected ('+hair.total+')',exact:false}).waitFor();
 await palette.getByRole('button',{name:'Next vocabulary page',exact:true}).click();assert(await palette.getByRole('button',{name:'Append selected ('+hair.total+')',exact:false}).isVisible());
 await palette.getByRole('button',{name:'Append selected ('+hair.total+')',exact:false}).click();
 await page.waitForFunction(()=>window.qaBulkNode.widgets[0].value.endsWith('}')&&window.qaBulkNode.widgets[0].value.includes(', {'));
 assert.equal(await value(),'base, '+M+', {'+(await spelled(hair.items)).join('|')+'}');
 // Several categories combine into one list without losing the search, and the fourth format keeps them together as one optional group.
 await reset();
 const attire=await browse([attireKey]);const attireGroup=attire.categories.find(x=>x.value===attireKey);
 await choose(palette,'Danbooru wiki categories',attireGroup.label+' ('+attireGroup.count+')');
 await palette.getByRole('combobox',{name:'Danbooru wiki categories',exact:true}).press('Escape');
 const both=await browse([hairKey,attireKey]);assert(both.total>hair.total);
 await setInsertion(palette,{format:'Optional group {a, b, c|}',position:'Append after'});
 await selectAll(palette).click();await palette.getByRole('button',{name:'Append selected ('+both.total+')',exact:false}).waitFor();
 await palette.getByRole('button',{name:'Append selected ('+both.total+')',exact:false}).click();
 await page.waitForFunction(()=>window.qaBulkNode.widgets[0].value.endsWith('|}'));
 assert.equal(await value(),'base, '+M+', {'+(await spelled(both.items)).join(', ')+'|}');
 // The group arrives as one optional or-chip.
 assert.deepEqual(await page.evaluate(()=>{const chip=window.qaBulkNode.properties.prompt_boxes.boxes.find(b=>b.kind==='group'&&b.name==='#2').chips;return [chip.length,chip[0].kind,chip[0].optional];}),[1,'or',true]);
 // Saving a definition does not overwrite the target prompt.
 const before=await value();await manager.getByRole('textbox',{name:'Prefix name',exact:true}).fill('saved without replacing');const tags=manager.getByRole('combobox',{name:'Prefix tags',exact:true});await tags.fill('cloud');await tags.press('Enter');await tags.press('Escape');const saved=page.waitForResponse(r=>r.url().endsWith('/Gallery/prefixes')&&r.request().method()==='POST');await manager.getByRole('button',{name:'Save prefix',exact:true}).click();assert.equal((await saved).status(),200);assert.equal(await value(),before);
 if(process.env.GALLERY_QA_SCREENSHOT)await manager.screenshot({path:process.env.GALLERY_QA_SCREENSHOT});
 assert.deepEqual(errors,[]);console.log('PASS individual and bulk direct insertion into encoder boxes (named after prefixes), alternatives, weights/affixes, combined multi-category selection, the optional-group format, selection persistence, source box placement and non-destructive definition save.');
}catch(e){if(process.env.GALLERY_QA_SCREENSHOT)await page.screenshot({path:process.env.GALLERY_QA_SCREENSHOT.replace(/\.png$/, '-error.png')});console.log(await page.locator('body').innerText());throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

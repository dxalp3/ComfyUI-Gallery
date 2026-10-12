const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const page=await browser.newPage({viewport:{width:1550,height:1150}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));try{
const base='http://127.0.0.1:8191';
for(const [name,terms,negative_terms] of [['QA negative',[],['bad hands','blur']],['QA colors',['red','blue'],[]]]){const {revision}=await(await page.request.get(base+'/Gallery/prefixes')).json();const response=await page.request.post(base+'/Gallery/prefixes',{data:{action:'save',name,terms,negative_terms,revision}});assert.equal(response.status(),200);}
const current=await(await page.request.get(base+'/Gallery/prefixes')).json();const prefix=current.library.prefixes.find(p=>p.name==='QA colors');const hash='e'.repeat(64);const localKey='local:./:/static_gallery/study-1.png', remoteKey='sha256:'+hash;
assert.equal((await page.request.post(base+'/Gallery/prefixes',{data:{action:'associate',prefix_id:prefix.id,image_keys:[localKey,remoteKey],image_refs:{[localKey]:{local_url:'/static_gallery/study-1.png',name:'QA local'},[remoteKey]:{hash,name:'QA remote'}},revision:current.revision}})).status(),200);
const poster=await(await page.request.get(base+'/static_gallery/study-1.png')).body();await page.route('**/Gallery/hydrus/original?**',route=>route.fulfill({body:poster,contentType:'image/png'}));
await page.goto(base);await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
await page.evaluate(()=>{const graph=window.comfyAPI.app.app.graph;const node={comfyClass:'GalleryPromptEncode',title:'QA encoder',widgets:[{name:'text',type:'text',value:''},{name:'source_mode',value:'after'}],inputs:[],properties:{},setDirtyCanvas(){},addWidget(type,name,value,callback){this.widgets.push({type,name,value,callback});},addDOMWidget(name,type,el){const host=document.createElement('div');host.style.display='none';host.append(el);document.body.append(host);return{name,type};}};graph.add(node);window.qaExtension.nodeCreated(node);window.qaPrefixNode=node;});
await page.waitForFunction(()=>window.qaPrefixNode.__galleryPromptBoxes);
await page.evaluate(()=>window.dispatchEvent(new CustomEvent('gallery-prefix-manager',{detail:{node:window.qaPrefixNode}})));
const panel=page.locator('.cg-prompt-palette');await panel.getByRole('tab',{name:'Prefixes',exact:true}).click();
const choose=async(label,title)=>{await panel.getByRole('combobox',{name:label,exact:true}).press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByTitle(title,{exact:true}).click();await page.locator('.ant-select-dropdown:visible').waitFor({state:'hidden'});};
await panel.getByRole('button',{name:'Append QA negative',exact:true}).click();await page.waitForFunction(()=>window.qaPrefixNode.widgets[0].value.includes('bad hands'));
await panel.getByRole('checkbox',{name:'Pick QA colors',exact:true}).check();await panel.getByRole('checkbox',{name:'Pick QA negative',exact:true}).check();
await choose('Insertion format','Optional group {a, b, c|}');
await panel.getByRole('button',{name:'Append selected (2)',exact:true}).click();
await page.waitForFunction(()=>window.qaPrefixNode.widgets[0].value.includes('{red, blue|}')&&window.qaPrefixNode.widgets[0].value.includes('{bad hands, blur|}'));
let boxes=await page.evaluate(()=>window.qaPrefixNode.properties.prompt_boxes.boxes.filter(b=>b.kind==='group'));
assert.deepEqual(boxes.slice(-2).map(b=>b.name),['QA colors','QA negative']);
await choose('Prefix grouping','One combined group');await panel.getByRole('button',{name:'Append selected (2)',exact:true}).click();await page.waitForFunction(()=>window.qaPrefixNode.widgets[0].value.includes('{red, blue, bad hands, blur|}'));
await choose('Prefix grouping','Separate groups, individual rules');await choose('Format for QA colors','Alternatives');await choose('Format for QA negative','Each optional');await panel.getByRole('button',{name:'Append selected (2)',exact:true}).click();await page.waitForFunction(()=>window.qaPrefixNode.widgets[0].value.includes('{red|blue}')&&window.qaPrefixNode.widgets[0].value.includes('{bad hands|}, {blur|}'));
await panel.getByText('Associated images (2)',{exact:true}).click();
await panel.getByAltText('Image: QA local',{exact:true}).click();let viewer=page.getByRole('dialog',{name:/Gallery viewer/});await viewer.getByAltText('Viewing study-1.png',{exact:true}).waitFor();await viewer.getByRole('button',{name:'Close',exact:true}).first().click();
await panel.getByAltText('Image: QA remote',{exact:true}).click();await viewer.getByAltText('Viewing QA remote',{exact:true}).waitFor();assert((await viewer.getByAltText('Viewing QA remote',{exact:true}).getAttribute('src')).includes('/Gallery/hydrus/original?'));assert.equal(page.context().pages().length,1);
assert.deepEqual(errors,[]);console.log('PASS negative-only prefix, separate same-rule groups, combined group and per-prefix rules');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

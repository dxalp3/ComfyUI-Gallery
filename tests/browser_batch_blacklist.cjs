const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const page=await browser.newPage({viewport:{width:1500,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:8191');await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
 await page.evaluate(()=>{const host=document.createElement('div');host.id='qa-batch';host.style.cssText='width:550px;position:fixed;right:10px;top:10px;z-index:5000;background:#222';document.body.append(host);
 const node={comfyClass:'GalleryPromptEncode',widgets:[{name:'text',value:'a, b, c'},{name:'source_mode',value:'after'}],inputs:[{name:'source_text',link:null}],properties:{},setDirtyCanvas(){},addWidget(type,name,value,callback){this.widgets.push({type,name,value,callback});},addDOMWidget(name,type,el){host.append(el);return{name,type};}};window.comfyAPI.app.app.graph.add(node);window.qaExtension.nodeCreated(node);window.qaBatch=node;});

 const editor=page.locator('#qa-batch');
 await editor.locator('summary').filter({hasText:'Batch blacklist'}).click();
 const blacklist=editor.getByRole('textbox',{name:'Batch tag blacklist',exact:true});
 await blacklist.fill('b');await editor.getByRole('button',{name:'Save batch blacklist',exact:true}).click();
 await editor.getByText('1 chip(s) excluded from batch selection',{exact:true}).waitFor();
 await editor.getByRole('button',{name:'Select all chips',exact:true}).click();await editor.getByText('2 selected',{exact:true}).waitFor();
 // Saving new entries also removes them from an existing selection.
 await blacklist.fill('b, c');await editor.getByRole('button',{name:'Save batch blacklist',exact:true}).click();await editor.getByText('1 selected',{exact:true}).waitFor();
 await editor.getByRole('button',{name:'Clear picked tags',exact:true}).click();
 await editor.getByRole('button',{name:'Edit a',exact:true}).click({modifiers:['Control']});await editor.getByRole('button',{name:'Edit c',exact:true}).click({modifiers:['Shift']});await editor.getByText('1 selected',{exact:true}).waitFor();
 await editor.getByRole('button',{name:'Remove selected chips',exact:true}).click();
 await page.waitForFunction(()=>window.qaBatch.widgets[0].value==='b, c, ⟦source⟧');
 await editor.getByRole('button',{name:'Select chips',exact:true}).click();await editor.getByRole('button',{name:'Edit b',exact:true}).click();assert.equal(await editor.getByRole('group',{name:'Selected chip actions'}).count(),0);
 await editor.getByRole('button',{name:'Select chips',exact:true}).click();await editor.getByRole('button',{name:'Edit b',exact:true}).click();await editor.getByRole('textbox',{name:'Tag text',exact:true}).waitFor();
 await page.reload();await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
 await page.getByAltText('study-1.png',{exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'Use for prefix… (1)',exact:true}).click();
 const flow=page.getByRole('dialog',{name:/^Use for prefix/});await flow.locator('summary').filter({hasText:'Batch blacklist (2)'}).click();assert.equal(await flow.getByRole('textbox',{name:'Batch tag blacklist'}).inputValue(),'b\nc');
 assert.deepEqual(errors,[]);console.log('PASS blacklist select-all/ranges, live pruning, selection-mode protection, single editing, persistence and gallery sharing');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

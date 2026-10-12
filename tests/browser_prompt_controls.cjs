const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 const page = await browser.newPage({viewport:{width:1500,height:1100}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.goto('http://127.0.0.1:8191');
  await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
  const current=await (await page.request.get('http://127.0.0.1:8191/Gallery/prefixes')).json();
  const saved=await page.request.post('http://127.0.0.1:8191/Gallery/prefixes',{data:{action:'save',name:'drop target',terms:['source tag'],negative_terms:['negative kept'],revision:current.revision}});
  assert.equal(saved.status(),200);
  const library=(await saved.json()).library;
  const prefix=library.prefixes.find(p=>p.name==='drop target');
  await page.evaluate(prefix=>{
   const graph=window.comfyAPI.app.app.graph;
   const source={comfyClass:'GalleryImageSource',widgets:[{name:'sources',value:JSON.stringify({version:1,layout:'single',images:[{input_name:'gallery_sources/qa.png',prompt:{positive:'source tag',negative:'negative kept',tags:[]},metadata:{gallery_prefix:{id:prefix.id,name:prefix.name,positive:['source tag'],negative:['negative kept']}}}]})}],properties:{},setDirtyCanvas(){}};
   graph.add(source); graph.links={101:{origin_id:source.id,origin_slot:4}};
   window.qaControlNodes=[];
   for(let i=0;i<2;i++) {
    const host=document.createElement('div');host.id='qa-control-'+i;host.style.cssText=`width:510px;position:fixed;left:${20+i*550}px;top:10px;z-index:5000;background:#222`;document.body.append(host);
    const node={comfyClass:'GalleryPromptEncode',widgets:[{name:'text',value:i?'destination':'a, b, {red|blue|}'},{name:'source_mode',value:'after'}],inputs:[{name:'source_text',link:i?null:101}],properties:{},setDirtyCanvas(){},addWidget(type,name,value,callback){this.widgets.push({type,name,value,callback});},addDOMWidget(name,type,el){host.append(el);return{name,type};}};
    graph.add(node);window.qaExtension.nodeCreated(node);window.qaControlNodes.push(node);
    window.qaEscapedEvents=0;
    for (const type of ['mousedown','keydown','dragstart','drop']) host.addEventListener(type,event=>{window.qaEscapedEvents++;event.preventDefault();});
   }
  },prefix);
  const first=page.locator('#qa-control-0'), second=page.locator('#qa-control-1');
  const add=first.getByRole('textbox',{name:'Add tags (Enter)',exact:true});
  await add.waitFor();
  const surface=first.locator('[data-tag-surface]').first();const bounds=await surface.boundingBox();await surface.click({position:{x:bounds.width-4,y:bounds.height-4}});assert.equal(await add.evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Backspace');
  await page.waitForFunction(()=>!window.qaControlNodes[0].widgets[0].value.includes('red'));
  await add.fill('{red|blue|}');await add.press('Enter');
  await first.getByRole('button',{name:'Edit b',exact:true}).dblclick();
  await page.waitForFunction(()=>window.qaControlNodes[0].properties.prompt_boxes.boxes[0].chips.length===2);
  const grouped=first.getByRole('button',{name:'Edit {red|blue|}',exact:true});
  await grouped.dragTo(second.getByRole('button',{name:'Edit destination',exact:true}),{targetPosition:{x:1,y:4}});
  await page.waitForFunction(()=>window.qaControlNodes[1].widgets[0].value.startsWith('{red|blue|}, destination'));
  assert((await page.evaluate(()=>window.qaControlNodes[0].widgets[0].value)).includes('{red|blue|}'));
  const response=page.waitForResponse(r=>r.url().endsWith('/Gallery/prefixes')&&r.request().method()==='POST');
  await grouped.dragTo(first.getByText('Source',{exact:true}));
  assert.equal((await response).status(),200);
  await first.getByRole('status').filter({hasText:'Added to drop target'}).waitFor();
  const updated=(await(await page.request.get('http://127.0.0.1:8191/Gallery/prefixes')).json()).library;
  const p=updated.prefixes.find(p=>p.id===prefix.id);
  assert(p.tags.map(id=>updated.tags.find(t=>t.id===id).text).includes('{red|blue|}'));
  assert.deepEqual(p.negative_terms,['negative kept']);
  await second.getByRole('button',{name:'Edit destination',exact:true}).click();
  await second.getByRole('textbox',{name:'Add tags (Enter)',exact:true}).press('Backspace');
  await page.waitForFunction(()=>!window.qaControlNodes[1].widgets[0].value.includes('destination'));
  assert.equal(await page.evaluate(()=>window.qaEscapedEvents),0);assert.deepEqual(errors,[]);
  console.log('PASS box focus, Backspace, double-click removal, cross-editor copies, grouped source-prefix persistence and polarity');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

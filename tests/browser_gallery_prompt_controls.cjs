const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:8191', hash='e'.repeat(64);
 try {
  const poster=await(await page.request.get(base+'/static_gallery/study-1.png')).body();
  await page.route('**/Gallery/images*',async route=>{
   const response=await route.fetch(), data=await response.json();
   const file=Object.values(data.folders.output).find(f=>f.name==='study-1.png');
   file.metadata={prompt:{'1':{class_type:'GalleryPromptEncode',inputs:{text:'plain, blue'}},'2':{class_type:'KSampler',inputs:{positive:['1',0]}},'3':{class_type:'GalleryImageSource',inputs:{sources:JSON.stringify({version:1,layout:'grid',images:[
    {input_name:'gallery_sources/'+hash+'.png',title:'Gallery ancestor',metadata:{gallery_origin:'gallery',gallery_url:'/static_gallery/study-2.png'}},
    {input_name:'hydrus/'+hash+'.png',title:'Hydrus ancestor',metadata:{gallery_origin:'hydrus',hydrus:{hash,mime:'image/png'}}}
   ]})}}},gallery_prompts:{'1':{text:'plain, {red|blue}, {a, b|}, {c|}, [soft]',resolved:'plain, blue'}}};
   await route.fulfill({json:data});
  });
  await page.route('**/Gallery/source/metadata',route=>route.fulfill({json:{metadata:{}}}));
  await page.route('**/view?**',route=>route.fulfill({body:poster,contentType:'image/png'}));
  await page.goto(base);await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
  await page.getByAltText('study-1.png',{exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Use for prefix… (1)',exact:true}).click();
  const flow=page.getByRole('dialog',{name:/^Use for prefix/});
  const from=flow.getByRole('list',{name:'Positive prompt',exact:true});
  await from.getByRole('button',{name:'Edit {red|blue}',exact:true}).waitFor();
  await from.getByRole('button',{name:'Edit {a, b|}',exact:true}).waitFor();
  await from.getByRole('button',{name:'Edit [soft]',exact:true}).waitFor();
  await flow.getByRole('button',{name:'Clear',exact:true}).click();
  await from.getByRole('button',{name:'Edit {a, b|}',exact:true}).dragTo(flow.getByRole('textbox',{name:/^Terms: tags/}));
  await flow.locator('.cg-terms').getByRole('button',{name:'Edit {a, b|}',exact:true}).waitFor();
  await flow.getByRole('textbox',{name:/^Terms: tags/}).press('Backspace');
  await flow.locator('.cg-terms').getByRole('button',{name:'Edit {a, b|}',exact:true}).waitFor({state:'detached'});
  // Return to the saved empty draft so closing needs no discard confirmation.
  await flow.getByRole('button',{name:'Close',exact:true}).first().click();
  await page.getByRole('button',{name:'Discard',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('gallery-image-search',{detail:{chips:[{kind:'image',url:'/static_gallery/study-1.png',name:'study-1.png'}]}})));
  const search=page.locator('[data-panel-key="tag-search"]');
  await search.getByRole('tab',{name:/^Lineage/}).click();
  await search.getByRole('button',{name:/Gallery ancestor/}).click();
  const viewer=page.getByRole('dialog',{name:/Gallery viewer/});
  await viewer.getByAltText('Viewing study-2.png',{exact:true}).waitFor();
  assert.equal(page.context().pages().length,1);
  await viewer.getByRole('button',{name:'Close',exact:true}).first().click();
  await search.getByRole('button',{name:/Hydrus ancestor/}).press('Enter');
  await viewer.getByAltText('Viewing Hydrus ancestor',{exact:true}).waitFor();
  assert.equal(page.context().pages().length,1);
  assert.deepEqual(errors,[]);
  console.log('PASS gallery grouped prompt chips, drag to prefix, Backspace, and gallery/Hydrus lineage viewer without new tabs');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

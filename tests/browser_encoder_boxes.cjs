const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');
// The Gallery Prompt Encode node: tag boxes, drag and drop, weights, disabling and persistence.
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const page=await browser.newPage({viewport:{width:1300,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const M='\u27e6source\u27e7';
try{
 await page.goto('http://127.0.0.1:8191');await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
 await page.evaluate(()=>{const host=document.createElement('div');host.id='qa-node-previews';host.style.cssText='width:420px;position:fixed;right:10px;top:10px;z-index:5000;background:#222';document.body.append(host);const graph=window.comfyAPI.app.app.graph;
  const node={comfyClass:'GalleryPromptEncode',title:'Encoder',widgets:[{name:'text',value:'a, b, c'},{name:'source_mode',value:'after'}],inputs:[{name:'source_text',link:null}],properties:{},setDirtyCanvas(){},addWidget(type,name,value,callback){this.widgets.push({type,name,value,callback});},addDOMWidget(name,type,el){document.querySelector('#qa-node-previews').append(el);return {name,type};}};
  graph.add(node);window.qaExtension.nodeCreated(node);window.qaEncoder=node;});
 const expectText=expected=>page.waitForFunction(expected=>window.qaEncoder.widgets[0].value===expected,expected);
 const editor=page.locator('#qa-node-previews');
 // An old workflow's text becomes box #1 with the source box after it.
 await expectText('a, b, c, '+M);
 // Comma-separated tags become individual chips; {q|r|} becomes one or-chip.
 const add=editor.getByRole('textbox',{name:/^Add tags/});
 await add.fill('x, y');await add.press('Enter');await expectText('a, b, c, x, y, '+M);
 const newBox=editor.getByRole('textbox',{name:'New box: type tags and press Enter',exact:true});
 await newBox.fill('p, {q|r|}');await newBox.press('Enter');await expectText('a, b, c, x, y, '+M+', p, {q|r|}');
 // Drag a chip from one box in front of a chip in another.
 await editor.getByRole('button',{name:'Edit p',exact:true}).dragTo(editor.getByRole('button',{name:'Edit a',exact:true}),{targetPosition:{x:1,y:4}});
 await expectText('p, a, b, c, x, y, '+M+', {q|r|}');
 // Drag a whole box above another.
 const grips=editor.getByRole('button',{name:/^Drag box/});
 await grips.nth(2).dragTo(grips.nth(0),{targetPosition:{x:2,y:1}});
 await expectText('{q|r|}, p, a, b, c, x, y, '+M);
 // Drop a chip on a box (not on a chip) to put it at the end of that box.
 await editor.getByRole('button',{name:'Edit x',exact:true}).dragTo(editor.getByText('#2',{exact:true}));
 await expectText('{q|r|}, x, p, a, b, c, y, '+M);
 // Weight and brackets live on the chip.
 await editor.getByRole('button',{name:'Edit a',exact:true}).click();
 await editor.getByRole('spinbutton',{name:'Weight',exact:true}).fill('1.2');
 await expectText('{q|r|}, x, p, (a:1.2), b, c, y, '+M);
 await editor.getByRole('button',{name:'Done',exact:true}).click();
 // A box can be switched off and back on; so can the source box.
 await editor.getByRole('checkbox',{name:'Use box #1',exact:true}).uncheck();await expectText('{q|r|}, x, '+M);
 await editor.getByRole('checkbox',{name:'Use box #1',exact:true}).check();await expectText('{q|r|}, x, p, (a:1.2), b, c, y, '+M);
 await editor.getByRole('checkbox',{name:'Use source box',exact:true}).uncheck();await expectText('{q|r|}, x, p, (a:1.2), b, c, y');
 await editor.getByRole('checkbox',{name:'Use source box',exact:true}).check();await expectText('{q|r|}, x, p, (a:1.2), b, c, y, '+M);
 // Boxes are stored on the node, and the backend is told to place the source box by its position.
 assert.equal(await page.evaluate(()=>window.qaEncoder.properties.prompt_boxes.boxes.length),3);
 assert.equal(await page.evaluate(()=>window.qaEncoder.widgets.find(w=>w.name==='source_mode').value),'boxes');
 if(process.env.GALLERY_QA_SCREENSHOT)await editor.screenshot({path:process.env.GALLERY_QA_SCREENSHOT});
 assert.deepEqual(errors,[]);console.log('PASS encoder tag boxes: migration, typed tags and or-chips, drag chips between boxes, drag boxes, drop on a box, weights, disabling boxes and the source box, stored state.');
}catch(e){console.log(await page.locator('body').innerText());throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

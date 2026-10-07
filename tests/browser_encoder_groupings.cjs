const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');
// Gallery Prompt Encode: typed {…} syntax gets suggestions and a live hint; the four grouping kinds are explicit badges and can be switched, extended and merged.
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const page=await browser.newPage({viewport:{width:1300,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const M='⟦source⟧';
try{
 await page.goto('http://127.0.0.1:8191');await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
 await page.evaluate(()=>{const host=document.createElement('div');host.id='qa-node-previews';host.style.cssText='width:520px;position:fixed;right:10px;top:10px;z-index:5000;background:#222';document.body.append(host);const graph=window.comfyAPI.app.app.graph;
  const node={comfyClass:'GalleryPromptEncode',title:'Encoder',widgets:[{name:'text',value:'a, b, c'},{name:'source_mode',value:'after'}],inputs:[{name:'source_text',link:null}],properties:{},setDirtyCanvas(){},addWidget(type,name,value,callback){this.widgets.push({type,name,value,callback});},addDOMWidget(name,type,el){document.querySelector('#qa-node-previews').append(el);return {name,type};}};
  graph.add(node);window.qaExtension.nodeCreated(node);window.qaEncoder=node;});
 const expectText=expected=>page.waitForFunction(expected=>window.qaEncoder.widgets[0].value===expected,expected);
 const editor=page.locator('#qa-node-previews');
 await expectText('a, b, c, '+M);
 // "Add as" makes typed tags one grouped chip; suggestions add tags to the draft; Enter adds the chip.
 const add=editor.getByRole('textbox',{name:/^Add tags/});
 await editor.getByRole('combobox',{name:'Add as'}).first().selectOption('optional');
 await add.fill('blond');
 await page.getByRole('option',{name:'blond hair'}).click();
 await add.fill('red hair');await add.press('Enter');
 await expectText('a, b, c, {blond hair|red hair|}, '+M);
 // Typed syntax still works in Tags mode, with suggestions inside the brace.
 await editor.getByRole('combobox',{name:'Add as'}).first().selectOption('tag');
 await add.fill('{x|y');await add.press('Enter');
 await expectText('a, b, c, {blond hair|red hair|}, {x|y}, '+M);
 await editor.getByRole('button',{name:'Edit {x|y}',exact:true}).click();await editor.getByRole('button',{name:'Remove tag'}).first().waitFor();
 await editor.getByRole('button',{name:'Remove tag',exact:true}).nth(0).waitFor();
 await page.evaluate(()=>{const s=window.qaEncoder.properties.prompt_boxes;});
 await editor.getByRole('button',{name:'Done',exact:true}).click();
 await editor.getByRole('button',{name:'Edit {x|y}',exact:true}).locator('xpath=..').getByRole('button',{name:'Remove tag'}).click();
 await expectText('a, b, c, {blond hair|red hair|}, '+M);
 // The chip header spells out its grouping.
 assert.ok((await editor.innerText()).toUpperCase().includes('OPTIONAL ALTERNATIVES'));
 // The chip says what it is with a badge instead of "or"/"or nothing" words.
 const chip=editor.getByRole('button',{name:'Edit {blond hair|red hair|}',exact:true});
 assert.ok(!(await editor.innerText()).includes('or nothing'));
 await chip.click();
 await editor.getByRole('radio',{name:'Optional group',exact:true}).click();
 await expectText('a, b, c, {blond hair, red hair|}, '+M);
 await editor.getByRole('radio',{name:'Alternatives',exact:true}).click();
 await expectText('a, b, c, {blond hair|red hair}, '+M);
 const alt=editor.getByRole('textbox',{name:/^Add an alternative/});
 await alt.fill('black hair');await alt.press('Enter');
 await expectText('a, b, c, {blond hair|red hair|black hair}, '+M);
 await editor.getByRole('button',{name:'Remove red hair'}).click();
 await expectText('a, b, c, {blond hair|black hair}, '+M);
 await editor.getByRole('button',{name:'Done',exact:true}).click();
 // Typing the syntax into an existing tag turns it into that grouping.
 await editor.getByRole('button',{name:'Edit c',exact:true}).click();
 const text=editor.getByRole('textbox',{name:'Tag text'});await text.fill('{c, d|}');await text.press('Enter');
 await expectText('a, b, {c, d|}, {blond hair|black hair}, '+M);
 await editor.getByRole('button',{name:'Done',exact:true}).click();
 // Shift-click picks several chips; they can be combined into one group.
 await editor.getByRole('button',{name:'Edit a',exact:true}).click({modifiers:['Shift']});
 await editor.getByRole('button',{name:'Edit b',exact:true}).click({modifiers:['Shift']});
 await editor.getByRole('button',{name:'Optional group',exact:true}).click();
 await expectText('{a, b|}, {c, d|}, {blond hair|black hair}, '+M);
 if(process.env.GALLERY_QA_SCREENSHOT)await editor.screenshot({path:process.env.GALLERY_QA_SCREENSHOT});
 assert.deepEqual(errors,[]);console.log('PASS encoder groupings: suggestions inside braces, live syntax hint, explicit badges, switching kinds, adding/removing options, typed syntax on a chip, merging picked chips.');
}catch(e){console.log((await page.locator('#qa-node-previews').innerText()).slice(0,2000));throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

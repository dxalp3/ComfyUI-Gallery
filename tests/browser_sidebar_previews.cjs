const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const page=await browser.newPage({viewport:{width:1000,height:750}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 let saved;
 await page.route('**/Gallery/settings',async route=>{if(route.request().method()==='POST'){saved=route.request().postDataJSON();await route.fulfill({json:{success:true}});}else await route.continue();});
 await page.goto('http://127.0.0.1:8191');
 await page.waitForFunction(()=>window.qaSidebar&&window.qaListeners.executed);
 await page.evaluate(()=>{const host=document.createElement('div');host.id='qa-sidebar';host.style.cssText='position:fixed;left:0;top:40px;width:260px;height:650px;z-index:5000';document.body.append(host);window.qaSidebar.render(host);window.qaListeners.executed({detail:{output:{images:[{filename:'study-1.png',type:'output'},{filename:'controlnet-temp.png',type:'temp'}]}}});});
 const pane=page.getByRole('region',{name:'Gallery assets',exact:true});
 await pane.getByRole('button',{name:'View study-1.png',exact:true}).waitFor();
 assert.equal(await pane.getByRole('button',{name:'View controlnet-temp.png',exact:true}).count(),0);
 assert.equal(await pane.getByRole('button',{name:'Prompts & prefixes',exact:true}).count(),0);
 await pane.getByRole('button',{name:'Gallery tools',exact:true}).click();await page.getByRole('menuitem',{name:'Show temporary previews',exact:true}).click();
 await pane.getByRole('button',{name:'View controlnet-temp.png',exact:true}).waitFor();assert.equal(saved.showTemporaryPreviews,true);
 await pane.getByRole('button',{name:'Gallery tools',exact:true}).click();await page.getByRole('menuitem',{name:'✓ Show temporary previews',exact:true}).click();
 await pane.getByRole('button',{name:'View controlnet-temp.png',exact:true}).waitFor({state:'detached'});assert.equal(saved.showTemporaryPreviews,false);
 for(const width of [230,320]){await page.locator('#qa-sidebar').evaluate((el,width)=>el.style.width=width+'px',width);assert(await pane.evaluate(el=>el.scrollWidth<=el.clientWidth));}
 await pane.screenshot({path:require('node:path').resolve(__dirname,'../../../outputs/sidebar-preview.png')});
 assert.deepEqual(errors,[]);console.log('PASS hidden temporary previews, persisted opt-in/out, compact tools and narrow sidebar layout');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

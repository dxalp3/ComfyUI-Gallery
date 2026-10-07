const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
// One metadata window, "Use for prefix" pairing, Find images by lineage (and strict), prefix polarity filters, the header Library search button.
// Needs a QA server whose /Gallery/images has paired.png (prompt picks), gen1.png (made from paired.png), gen2.png (made from gen1.png) and other.png.
(async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const shot=name=>process.env.GALLERY_QA_SCREENSHOTS?page.screenshot({path:process.env.GALLERY_QA_SCREENSHOTS+'/'+name+'.png'}):undefined;
 const choose=async(label,option)=>{await page.getByRole('combobox',{name:label,exact:true}).last().press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByTitle(option,{exact:true}).click();};
 try {
  await page.goto(process.env.GALLERY_QA_URL || 'http://127.0.0.1:8191');
  await page.getByRole('tab',{name:'Gallery workspace',exact:true}).click();
  await page.locator('[data-gallery-entry]').first().waitFor();
  // The header has a Library search button next to Hydrus sync.
  await page.getByRole('button',{name:/Library search$/}).first().click();
  const library=page.getByRole('dialog',{name:'Library search'});
  await library.waitFor();
  await choose('Prefix polarity filter','Negative only');
  await library.getByText('NegOnly',{exact:true}).waitFor();
  assert.equal(await library.getByText('Pose',{exact:true}).count(),0);
  await library.getByRole('button',{name:'Close'}).first().click();
  // One "Metadata" entry; a local-only image shows its generation metadata and which option each group took.
  await page.getByAltText('paired.png',{exact:true}).click({button:'right'});
  assert.equal(await page.getByRole('menuitem',{name:'Hydrus metadata'}).count(),0);
  await page.getByRole('menuitem',{name:'Metadata',exact:true}).click();
  const info=page.getByRole('dialog',{name:/^Metadata · paired.png/});
  await info.getByRole('heading',{name:'Picked options'}).waitFor();
  assert.equal(await info.getByRole('tab').count(),0);
  await shot('metadata');
  // "Use for prefix…" pairs the image with an existing prefix without changing its tags.
  await info.getByRole('button',{name:'Use for prefix…'}).click();
  const flow=page.getByRole('dialog',{name:/^Use for prefix/});
  await choose('Prefix for these images','Pose · positive only');
  await flow.getByRole('button',{name:'Pair only'}).click();
  await flow.getByText('Paired with:').waitFor();
  await shot('use-for-prefix');
  await flow.getByRole('button',{name:'Close'}).first().click();
  await info.getByRole('button',{name:'Close'}).first().click();
  // Find images: the paired image and everything generated from it, two generations deep, whatever the prompt.
  await page.getByRole('button',{name:/Prompts & prefixes$/}).first().click();
  await page.getByRole('button',{name:'Open prefix editor'}).click();
  const editor=page.getByRole('dialog',{name:/^Prefix editor/});
  await choose('Prefix polarity filter','Positive only');
  await editor.getByRole('combobox',{name:'Existing prefix',exact:true}).press('ArrowDown');
  assert.equal(await page.locator('.ant-select-dropdown:visible').getByTitle('NegOnly · negative only').count(),0);
  await page.locator('.ant-select-dropdown:visible').getByTitle('Pose · positive only').click();
  await editor.getByText('Associated images (1)').waitFor();
  await editor.getByRole('button',{name:'Find images'}).click();
  const found=page.locator('[data-panel-key="tag-search"]');
  // Prefix search: Sources = paired + later used as a source; Generated grouped by the image each was made from.
  await found.getByRole('tab',{name:'Generated (2)'}).waitFor();
  await found.getByText(/^Made from paired.png/).waitFor();
  await found.getByText(/^Made from gen1.png/).waitFor();
  assert.equal(await found.getByAltText('other.png',{exact:true}).count(),0);
  await found.getByRole('tab',{name:'Sources (2)'}).click();
  await found.getByText('Used as a source later').waitFor();
  await shot('find-images');
  // Strict: only those that still carry every prefix tag (gen1 is "sitting", not "standing").
  await found.getByText('Only images that still have every prefix tag').click();
  await found.getByRole('tab',{name:'Generated (1)'}).waitFor();
  await found.getByText('Only images that still have every prefix tag').click();
  // Ctrl-click selects in the shared gallery selection.
  await found.getByRole('tab',{name:/^Generated/}).click();
  await found.getByRole('group',{name:'gen2.png'}).click({modifiers:['Control']});
  await found.getByText('1 selected here').waitFor();
  // Search by image (right-click a result): lineage, what came from it, and what shares its prefix.
  await found.getByRole('group',{name:'gen1.png'}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Search by this image (new search)'}).click();
  await found.getByRole('tab',{name:'Generated from it (1)'}).waitFor();
  await found.getByRole('tab',{name:/^Lineage/}).click();
  await found.getByText('Made from (input images, nearest first)').waitFor();
  await found.getByRole('tab',{name:'Same prefix (1)'}).click();
  await found.getByAltText('paired.png',{exact:true}).waitFor();
  await shot('search-by-image');
  // The pairing can be undone from the prefix editor.
  await found.getByRole('button',{name:'Close'}).first().click();
  await editor.getByRole('button',{name:/^Unpair/}).click();
  await editor.getByText('Associated images').waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
  console.log('PASS prefix images: header Library search, polarity filters, single metadata window with picks, pair via Use for prefix, Find images by lineage and strict tags, unpair.');
 } catch(e){await shot('failure');throw e;} finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

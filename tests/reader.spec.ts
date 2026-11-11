import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const fixture = path.resolve('tests/fixtures/reading.pdf');
const entry = (word:string) => [{word,phonetic:'/test/',meanings:[{partOfSpeech:'noun',definitions:[{definition:'A definition for ' + word,example:'An example of ' + word}]}]}];
async function open(page:Page) {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(fixture);
  await expect(page.locator('.pdf-page[data-index="0"][data-ready="true"] .textLayer span').first()).toBeVisible();
}
async function select(page:Page, first='Hello world', last='Curiosity brings', firstPage=0, lastPage=firstPage) {
  await page.evaluate(({first,last,firstPage,lastPage}) => {
    const find = (index:number, text:string) => [...document.querySelectorAll('.pdf-page[data-index="' + index + '"] .textLayer span')].find(el=>el.textContent?.includes(text))!;
    const a=find(firstPage,first),b=find(lastPage,last);
    if (!a || !b) throw new Error('Text not mounted');
    const range=document.createRange();range.setStart(a.firstChild!,0);range.setEnd(b.firstChild!,b.textContent!.length);
    const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
    document.querySelector('#pages')!.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  },{first,last,firstPage,lastPage});
  await expect(page.locator('#selection-tools')).toBeVisible();
}
async function records(page:Page) {
  return page.evaluate(async () => {
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('leaf-reader',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('documents').objectStore('documents').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  });
}
test.beforeEach(async ({page}) => {
  await page.route('https://api.dictionaryapi.dev/**', async route => {
    const word=decodeURIComponent(route.request().url().split('/').at(-1)!);
    if(word==='slowword') await new Promise(resolve=>setTimeout(resolve,400));
    if(word==='unfindableword') {await route.fulfill({status:404,json:{title:'No Definitions Found'}});return;}
    await route.fulfill({json:entry(word)});
  });
  await page.route('https://translate.googleapis.com/**', async route => {
    const url=new URL(route.request().url());
    const word=(url.searchParams.get('q')||'').toLowerCase();
    if(word==='slowword') await new Promise(resolve=>setTimeout(resolve,400));
    const map:Record<string,any>={
      running:[[['달리기','running',null,null,10]],[['noun',['달리기','주력'],[['달리기',['running','race']],['주력',['running']]]]]],
      hello:[[['여보세요','hello',null,null,10]],[['interjection',['여보세요','안녕하세요'],[['여보세요',['hello','hi']],['안녕하세요',['hello']]]]]],
      book:[[['책, 도서','book',null,null,10]],[['noun',['책, 도서','서적'],[['책, 도서',['book','volume']],['서적',['book','publication']]]]]],
      curiosity:[[['호기심','curiosity',null,null,10]],[['noun',['호기심','진기함'],[['호기심',['curiosity']],['진기함',['novelty','curiosity']]]]]]
    };
    await route.fulfill({json:map[word]||[[['뜻: '+word,word,null,null,10]],[['noun',['뜻: '+word],[['뜻: '+word,[word]]]]]]});
  });
});
test('home layout, local Korean inflections, latest result, offline English failure',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/읽는 흐름/})).toBeVisible();
  await page.screenshot({path:'test-results/home.png',fullPage:true});
  await page.locator('#word-input').fill(' “Running!” ');
  await page.locator('#dictionary-form').evaluate(form=>(form as HTMLFormElement).requestSubmit());
  await expect(page.locator('#word-title')).toHaveText('running');
  await expect(page.locator('#korean-badge')).toHaveText('온라인 API');
  await expect(page.locator('#korean-result')).toContainText('달리');
  await expect(page.locator('#english-result')).toContainText('A definition for running');
  await page.locator('#word-input').fill('slowword');await page.locator('#word-input').press('Enter');
  await page.locator('#word-input').fill('hello');await page.locator('#word-input').press('Enter');
  await expect(page.locator('#english-result')).toContainText('A definition for hello');
  await page.waitForTimeout(500);
  await expect(page.locator('#word-title')).toHaveText('hello');
  await expect(page.locator('#english-result')).not.toContainText('slowword');
  await page.unroute('https://api.dictionaryapi.dev/**');
  await page.unroute('https://translate.googleapis.com/**');
  await page.route('https://api.dictionaryapi.dev/**',route=>route.abort('internetdisconnected'));
  await page.route('https://translate.googleapis.com/**',route=>route.abort('internetdisconnected'));
  await page.locator('#word-input').fill('book');await page.locator('#word-input').press('Enter');
  await expect(page.locator('#english-result')).toContainText('연결할 수 없어요');
  await expect(page.locator('#korean-badge')).toHaveText('오프라인 내장');
  await expect(page.locator('#korean-result')).toContainText('책');
});
test('real double click and drag, recolor, saved identity, delete, zoom and export',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);
  const text=page.locator('.pdf-page[data-index="0"] .textLayer span').filter({hasText:'Hello world'});
  const box=(await text.boundingBox())!;
  await page.mouse.dblclick(box.x+15,box.y+box.height/2);
  await expect(page.locator('#word-title')).toHaveText('hello');
  await expect(page.locator('#korean-result')).toContainText('여보세요');
  // Clear the existing word selection before starting a new text selection.
  await page.mouse.click(box.x-18,box.y);
  // Native pointer drag across two lines.
  await page.mouse.move(box.x+1,box.y+box.height/2);await page.mouse.down();
  const nextBox=(await page.locator('.pdf-page[data-index="0"] .textLayer span').filter({hasText:'Curiosity brings'}).boundingBox())!;
  await page.mouse.move(nextBox.x+nextBox.width-2,nextBox.y+nextBox.height/2,{steps:12});await page.mouse.up();
  await expect(page.locator('#selection-tools')).toBeVisible();
  await page.getByRole('button',{name:'노랑 형광펜',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('✓ 자동 저장됨');
  const saved=await records(page);expect(saved[0].highlights).toHaveLength(1);expect(saved[0].highlights[0].regions.length).toBeGreaterThanOrEqual(2);
  expect(saved[0].highlights[0]).not.toHaveProperty('text');
  const initial=JSON.stringify(saved[0].highlights[0].regions);
  await page.locator('#zoom-in').click();
  await expect(page.locator('.pdf-page[data-index="0"] .highlight').first()).toBeVisible();
  expect(JSON.stringify((await records(page))[0].highlights[0].regions)).toBe(initial);
  await page.setViewportSize({width:1200,height:900});
  await page.locator('#fit-width').click();
  await expect(page.locator('.pdf-page[data-index="0"] .highlight').first()).toBeVisible();
  await page.locator('.highlight').first().click();
  await page.getByRole('button',{name:'초록 형광펜',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('✓ 자동 저장됨');
  expect((await records(page))[0].highlights[0].color).toBe('green');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-button').click();
  const download=await downloadPromise;expect(download.suggestedFilename()).toBe('reading-형광펜.pdf');
  const output=await readFile((await download.path())!);
  const parsed=await getDocument({data:new Uint8Array(output),useSystemFonts:true}).promise;
  expect(parsed.numPages).toBe(7);const content=await (await parsed.getPage(1)).getTextContent();
  expect(content.items.map((item:any)=>item.str??'').join(' ')).toContain('Hello world');
  await parsed.destroy();
  await page.screenshot({path:'test-results/reader.png',fullPage:true});
  await page.reload();
  await page.locator('#file-input').setInputFiles({name:'renamed.pdf',mimeType:'application/pdf',buffer:await readFile(fixture)});
  await expect(page.locator('#highlight-count')).toHaveText('1');
  await expect(page.locator('.highlight').first()).toBeVisible();
  await page.locator('#file-input').setInputFiles({name:'renamed.pdf',mimeType:'application/pdf',buffer:await readFile('tests/fixtures/different.pdf')});
  await expect(page.locator('#highlight-count')).toHaveText('0');
  await page.locator('#file-input').setInputFiles(fixture);
  await expect(page.locator('.highlight').first()).toBeVisible();
  await page.locator('.highlight').first().click();await page.locator('#delete-highlight').click();
  await expect(page.locator('#highlight-count')).toHaveText('0');
  await expect(page.locator('#save-status')).toHaveText('✓ 자동 저장됨');
  expect((await records(page)).find((r:any)=>r.id===saved[0].id).highlights).toHaveLength(0);
  expect(errors).toEqual([]);
});
test('multiple pages, rotations and CropBox keep export highlight pixels at the same position',async({page})=>{
  await open(page);
  // Select across adjacent rendered pages.
  await expect(page.locator('.pdf-page[data-index="1"][data-ready="true"]')).toHaveCount(1);
  await select(page,'A final line','Hello world',0,1);
  await page.getByRole('button',{name:'노랑 형광펜',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('✓ 자동 저장됨');
  expect(new Set((await records(page))[0].highlights[0].regions.map((r:any)=>r.pageIndex))).toEqual(new Set([0,1]));
  // Add a mark on rotated, cropped, and rotated+cropped pages.
  for(const index of [1,2,3]){
    await page.locator('#page-number').fill(String(index+1));await page.locator('#page-number').press('Enter');await page.locator('#page-number').blur();
    await expect(page.locator('.pdf-page[data-index="'+index+'"][data-ready="true"] .textLayer span').first()).toBeVisible();
    await select(page,'Curiosity brings','Every sentence',index);
    await page.getByRole('button',{name:'분홍 형광펜',exact:true}).click();
    await expect(page.locator('#save-status')).toHaveText('✓ 자동 저장됨');
  }
  const marks=(await records(page))[0].highlights;
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-button').click();
  const output=await readFile((await(await downloadPromise).path())!);
  // Open the exported copy in PDF.js, with no app overlays, and inspect the drawn rectangle.
  await page.locator('#file-input').setInputFiles({name:'exported.pdf',mimeType:'application/pdf',buffer:output});
  await expect(page.locator('#highlight-count')).toHaveText('0');
  for(const index of [1,2,3]){
    await page.locator('#page-number').fill(String(index+1));await page.locator('#page-number').blur();
    await expect(page.locator('.pdf-page[data-index="'+index+'"] canvas')).toBeVisible();
    await expect(page.locator('.pdf-page[data-index="'+index+'"][data-ready="true"] .textLayer span').first()).toBeVisible();
    const info=await page.evaluate(({index})=>{
      const node=document.querySelector('.pdf-page[data-index="'+index+'"]')!;
      const canvas=node.querySelector('canvas')!;
      const span=[...node.querySelectorAll('.textLayer span')].find(s=>s.textContent?.includes('Curiosity brings'))!;
      const box=span.getBoundingClientRect(),parent=node.getBoundingClientRect();
      const ratio=canvas.width/parent.width;
      const ctx=canvas.getContext('2d')!;
      let colored=0,total=0;
      for(let y=Math.max(0,Math.floor((box.top-parent.top)*ratio));y<Math.min(canvas.height,(box.bottom-parent.top)*ratio);y+=2)
        for(let x=Math.max(0,Math.floor((box.left-parent.left)*ratio));x<Math.min(canvas.width,(box.right-parent.left)*ratio);x+=2){
          const [r,g,b]=ctx.getImageData(x,y,1,1).data;
          if(r>g+10&&b>g+4) colored++;
          total++;
        }
      return {colored,total};
    },{index});
    expect(info.colored/info.total).toBeGreaterThan(.35);
  }
  expect(marks.length).toBe(4);
});
test('scan notice, large page navigation, invalid PDF, responsive and file drop',async({page})=>{
  await page.goto('/');
  const buffer=await readFile(fixture);
  await page.evaluate(async bytes=>{
    const file=new File([new Uint8Array(bytes)],'dropped.pdf',{type:'application/pdf'});
    const transfer=new DataTransfer();transfer.items.add(file);
    document.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
  },Array.from(buffer));
  await expect(page.locator('#file-name')).toHaveText('dropped.pdf');
  await page.locator('#page-number').fill('7');await page.locator('#page-number').blur();
  await expect(page.locator('.scan-notice')).toContainText('OCR');
  expect(await page.locator('.pdf-page canvas').count()).toBeLessThan(7);
  await page.setViewportSize({width:600,height:900});
  await expect(page.locator('#word-input')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#file-input').setInputFiles('tests/fixtures/broken.pdf');
  await expect(page.locator('#reader-status')).toHaveText('PDF를 열지 못했어요.');
  await expect(page.locator('#welcome')).toBeVisible();
});


test('password prompt, wrong password, cancel, opening and unsupported encrypted export',async({page})=>{
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('tests/fixtures/encrypted.pdf');
  await expect(page.locator('#password-dialog')).toBeVisible();
  await page.locator('#password-dialog button[value="cancel"]').click();
  await expect(page.locator('#reader-status')).toHaveText('비밀번호 입력을 취소했어요.');
  await page.locator('#file-input').setInputFiles('tests/fixtures/encrypted.pdf');
  await expect(page.locator('#password-dialog')).toBeVisible();
  await page.locator('#pdf-password').fill('wrong');
  await page.locator('#password-dialog button[value="open"]').click();
  await expect(page.locator('#password-message')).toContainText('맞지 않아요');
  await page.locator('#pdf-password').fill('asdfasdf');
  await page.locator('#password-dialog button[value="open"]').click();
  await expect(page.locator('#password-dialog')).toBeHidden();
  await expect(page.locator('.pdf-page[data-ready="true"] canvas').first()).toBeVisible();
  await page.locator('#export-button').click();
  await expect(page.locator('#toast')).toContainText('암호화된 PDF 내보내기는 아직 지원하지 않아요');
});
test('quick file switches and zoom cancellation keep the last document',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);
  await page.locator('#zoom-in').click();
  await page.locator('#file-input').setInputFiles('tests/fixtures/different.pdf');
  await page.locator('#file-input').setInputFiles(fixture);
  await expect(page.locator('#file-name')).toHaveText('reading.pdf');
  await expect(page.locator('#page-total')).toHaveText('/ 7');
  await expect(page.locator('.pdf-page[data-ready="true"] .textLayer').first()).toContainText('Hello world');
  expect(errors).toEqual([]);
});
test('larger dictionary type and draggable panel preferences survive reload',async({page})=>{
  await page.goto('/');
  await page.locator('#word-input').fill('book');await page.locator('#word-input').press('Enter');
  await expect(page.locator('.ko-translation').first()).toHaveText('책, 도서');
  expect(await page.locator('.ko-translation').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(18);
  await expect(page.locator('.ko-explanation').first()).not.toHaveAttribute('open','');
  await page.locator('#dictionary-font-up').click();
  await page.locator('#dictionary-font-up').click();
  expect(await page.locator('.ko-translation').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(20);
  const divider=page.locator('#panel-divider'),box=(await divider.boundingBox())!;
  const before=(await page.locator('.dictionary').boundingBox())!.width;
  await page.mouse.move(box.x+4,box.y+180);await page.mouse.down();
  await page.mouse.move(box.x-116,box.y+180,{steps:10});await page.mouse.up();
  expect((await page.locator('.dictionary').boundingBox())!.width).toBeGreaterThan(before+100);
  const width=await divider.getAttribute('aria-valuenow');
  await page.reload();
  await expect(page.locator('#dictionary-font-size')).toHaveText('18px');
  await expect(divider).toHaveAttribute('aria-valuenow',width!);
  await divider.focus();await page.keyboard.press('ArrowRight');
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBe(Number(width)-20);
  await page.locator('#word-input').fill('book');await page.locator('#word-input').press('Enter');
  await expect(page.locator('.ko-translation').first()).toBeVisible();
  await page.screenshot({path:'test-results/dictionary-large.png',fullPage:true});
});
test('sentence memo create, cancel, edit, restore, Unicode export, and delete memo only',async({page})=>{
  await open(page);
  await select(page);
  await page.locator('#selection-note').click();
  await expect(page.locator('#note-quote')).toContainText('Hello world');
  await page.locator('#note-text').fill('취소할 메모');
  await page.locator('#note-dismiss').click();
  await expect(page.locator('#highlight-count')).toHaveText('0');
  await select(page);
  await page.locator('#selection-note').click();
  await page.locator('#note-text').fill('핵심 문장입니다.\n내일 다시 읽기 ✨');
  await page.getByRole('button',{name:'메모 저장',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('✓ 자동 저장됨');
  await expect(page.locator('.note-pin').first()).toBeVisible();
  let saved=(await records(page))[0];
  expect(saved.highlights[0].note).toBe('핵심 문장입니다.\n내일 다시 읽기 ✨');
  expect(saved.highlights[0].quote).toContain('Hello world');
  await page.locator('#zoom-in').click();
  await expect(page.locator('.note-pin').first()).toBeVisible();
  await page.locator('.note-pin').first().click();
  await expect(page.locator('#note-text')).toHaveValue('핵심 문장입니다.\n내일 다시 읽기 ✨');
  await page.locator('#note-text').fill('수정한 한국어 메모 ✨');
  await page.getByRole('button',{name:'메모 저장',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('✓ 자동 저장됨');
  await page.reload();await page.locator('#file-input').setInputFiles(fixture);
  await expect(page.locator('.note-pin').first()).toBeVisible();
  const waiting=page.waitForEvent('download');await page.locator('#export-button').click();
  const download=await waiting;
  await download.saveAs('test-results/memo-export.pdf');
  const parsed=await getDocument({data:new Uint8Array(await readFile((await download.path())!)),useSystemFonts:true}).promise;
  const annotations=await(await parsed.getPage(1)).getAnnotations();
  const note=annotations.find(a=>a.subtype==='Text');
  expect(note?.contentsObj.str).toBe('수정한 한국어 메모 ✨');
  expect(note?.titleObj.str).toBe('Leaf 메모');
  await parsed.destroy();
  await page.locator('.note-pin').first().click();
  await page.screenshot({path:'test-results/memo-editor.png',fullPage:true});
  await page.locator('#note-remove').click();
  await expect(page.locator('#save-status')).toHaveText('✓ 자동 저장됨');
  await expect(page.locator('.note-pin')).toHaveCount(0);
  await expect(page.locator('#highlight-count')).toHaveText('1');
  expect((await records(page))[0].highlights[0]).not.toHaveProperty('note');
});
test('zoom presets, page fit, pointer-anchored Ctrl wheel and keyboard shortcuts',async({page})=>{
  await open(page);
  await page.locator('#zoom-label').selectOption('100');
  await expect(page.locator('#zoom-label')).toHaveValue('100');
  await expect(page.locator('.pdf-page[data-index="0"][data-ready="true"]')).toHaveCount(1);
  const text=page.locator('.pdf-page[data-index="0"] .textLayer span').filter({hasText:'Hello world'});
  const before=(await text.boundingBox())!;
  const point={x:before.x+before.width/2,y:before.y+before.height/2};
  await page.mouse.move(point.x,point.y);
  await page.keyboard.down('Control');await page.mouse.wheel(0,-180);await page.keyboard.up('Control');
  await expect.poll(async()=>Number(await page.locator('#zoom-label option:checked').textContent().then(s=>s?.replace('%','')))).toBeGreaterThan(100);
  await expect.poll(async()=> (await text.boundingBox())?.width ?? 0).toBeGreaterThan(before.width+30);
  const after=(await text.boundingBox())!;
  expect(Math.abs(after.x+after.width/2-point.x)).toBeLessThan(3);
  expect(Math.abs(after.y+after.height/2-point.y)).toBeLessThan(3);
  await page.locator('#fit-page').click();
  await expect(page.locator('#fit-page')).toHaveClass(/active/);
  const viewport=(await page.locator('#reader-scroll').boundingBox())!;
  const paper=(await page.locator('.pdf-page[data-index="0"]').boundingBox())!;
  expect(paper.height).toBeLessThanOrEqual(viewport.height-40);
  await page.locator('#reader-scroll').focus();
  await page.keyboard.press('Control+0');
  await expect(page.locator('#fit-width')).toHaveClass(/active/);
  await page.keyboard.press('Control+-');
  await expect(page.locator('#fit-width')).not.toHaveClass(/active/);
  await page.setViewportSize({width:600,height:900});
  await expect(page.locator('#panel-divider')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

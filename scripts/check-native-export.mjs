import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:960}});
 await page.goto('http://127.0.0.1:4173/');
 await page.locator('#file-input').setInputFiles('tests/fixtures/reading.pdf');
 await page.locator('.pdf-page[data-ready="true"] .textLayer span').first().waitFor();
 await page.evaluate(()=>{
  const spans=[...document.querySelectorAll('.pdf-page[data-index="0"] .textLayer span')];
  const a=spans.find(s=>s.textContent.includes('Hello world')),b=spans.find(s=>s.textContent.includes('Curiosity brings'));
  const range=document.createRange();range.setStart(a.firstChild,0);range.setEnd(b.firstChild,b.textContent.length);
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
  document.querySelector('#pages').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
 });
 await page.getByRole('button',{name:'노랑 형광펜',exact:true}).click();
 const waiting=page.waitForEvent('download');await page.locator('#export-button').click();
 const download=await waiting;
 const file=path.resolve('test-results/native-export.pdf');await download.saveAs(file);
 await page.goto(pathToFileURL(file).href);
 await page.waitForTimeout(2500);
 console.log('Native Edge PDF viewer:',await page.locator('embed[type="application/pdf"]').count());
 await page.screenshot({path:'test-results/edge-native-pdf.png'});
} finally {await browser.close();}

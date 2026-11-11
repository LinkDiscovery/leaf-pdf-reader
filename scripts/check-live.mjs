import { chromium } from '@playwright/test';
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
 const page = await browser.newPage();
 await page.goto('http://127.0.0.1:4173/');
 await page.locator('#word-input').fill('book');
 await page.locator('#word-input').press('Enter');
 await page.waitForFunction(() => {
   const text = document.querySelector('#english-result')?.textContent || '';
   return text && !text.includes('찾고 있어요');
 }, {timeout:20000});
 console.log('LIVE ENGLISH:', (await page.locator('#english-result').textContent()).slice(0,400));
 console.log('LOCAL KOREAN:', (await page.locator('#korean-result').textContent()).slice(0,180));
} finally {await browser.close();}

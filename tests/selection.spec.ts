import { test, expect } from '@playwright/test';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('leaf-tour-seen', '1'));
  await page.route('**/firebase-config.json', route => route.fulfill({ json: null }));
  await page.route('https://api.dictionaryapi.dev/**', route => route.fulfill({ json: [] }));
  await page.route('https://translate.googleapis.com/**', route => route.fulfill({ json: [[['뜻', 'word']]] }));
  await page.goto('/');
});

for (const fraction of [.2, .8]) test('drag endpoint ' + fraction + ' includes the complete word and exposes exact selection', async ({ page }) => {
  await page.locator('#file-input').setInputFiles(path.resolve('tests/fixtures/reading.pdf'));
  const span = page.locator('.pdf-page[data-index="0"][data-ready="true"] .textLayer span').filter({ hasText: 'Hello world' });
  await expect(span).toBeVisible();
  const points = await span.evaluate((el, fraction) => {
    const text = el.firstChild!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1); const first = range.getBoundingClientRect();
    range.setStart(text, 10); range.setEnd(text, 11); const last = range.getBoundingClientRect();
    return { start: { x: first.left + 1, y: first.top + first.height / 2 }, end: { x: last.left + last.width * fraction, y: last.top + last.height / 2 } };
  }, fraction);
  await page.mouse.move(points.start.x, points.start.y); await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 12 }); await page.mouse.up();
  await expect(page.locator('#selection-tools')).toBeVisible();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('Hello world');
  if (fraction === .8) return;
  await expect(page.locator('#selection-preview')).toContainText('Hello world');
  await page.screenshot({ path: 'test-results/selection-preview.png' });
  await page.locator('#selection-snap').click();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('Hello worl');
  await page.locator('#selection-snap').click();
  await page.locator('#selection-word-save').click(); await expect(page.locator('#study-text')).toHaveValue('Hello world');
});

test('hyphenated fragments join known words but genuine compounds keep their hyphen', async ({ page }) => {
  await page.route('**/dictionary/en-ko.json', route => route.fulfill({ json: { metadata: {}, lookup: { different: [0], 'well-known': [1], resign: [2], 're-sign': [3] }, entries: [['different', '<div><i>adj.</i><b>다른</b></div>'], ['well-known', '<div><i>adj.</i><b>유명한</b></div>'], ['resign', ''], ['re-sign', '']] } }));
  await page.reload();
  for (const [input, expected] of [['differ-ent', 'different'], ['differ- ent', 'different'], ['dif\u00adferent', 'different'], ['well-known', 'well-known'], ['re-sign', 're-sign']]) {
    await page.locator('#word-input').fill(input); await page.locator('#word-input').press('Enter');
    await expect(page.locator('#word-title')).toHaveText(expected);
  }
  const pdf = await PDFDocument.create(), sheet = pdf.addPage([500, 700]), font = await pdf.embedFont(StandardFonts.Helvetica);
  sheet.drawText('differ-', { x: 50, y: 600, size: 18, font }); sheet.drawText('ent', { x: 50, y: 570, size: 18, font });
  await page.locator('#file-input').setInputFiles({ name: 'hyphen.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.textLayer span').filter({ hasText: 'differ-' })).toBeVisible();
  const selectSource = () => page.evaluate(() => {
    const spans = [...document.querySelectorAll('.textLayer span')];
    const a = spans.find(el => el.textContent === 'differ-')!, b = spans.find(el => el.textContent === 'ent')!;
    const range = document.createRange(); range.setStart(a.firstChild!, 0); range.setEnd(b.firstChild!, 3);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    document.querySelector('#pages')!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await selectSource();
  await page.locator('#selection-lookup').click(); await expect(page.locator('#word-title')).toHaveText('different');
  await selectSource();
  await page.locator('#selection-word-save').click(); await expect(page.locator('#study-text')).toHaveValue('different');
  await expect(page.locator('#study-source')).toHaveValue('hyphen.pdf');
});

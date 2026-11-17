import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('leaf-tour-seen', '1'));
  await page.route('**/firebase-config.json', route => route.fulfill({ json: null }));
  await page.route('https://api.dictionaryapi.dev/**', route => route.fulfill({ json: [{ meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To keep.' }] }] }] }));
  await page.route('https://translate.googleapis.com/**', route => route.fulfill({ json: [[['유지하다', 'retain']]] }));
  await page.goto('/'); await expect(page.locator('#study-sync')).toContainText('이 기기에 저장');
});
async function save(page: Page, text: string, source: string) {
  await page.locator('#study-add').click(); await page.locator('#study-text').fill(text); await page.locator('#study-source').fill(source); await page.locator('#study-submit').click();
  await expect(page.locator('#study-editor')).toBeHidden();
}

test('word and sentence collections group by paper, filter, move and preserve unassigned records', async ({ page }) => {
  await page.getByRole('tab', { name: '나의 단어장' }).click();
  await save(page, 'retain', '논문 A.pdf'); await save(page, 'retain', '논문 B.pdf'); await save(page, 'unassigned', '');
  await expect(page.locator('.study-paper-group')).toHaveCount(3);
  await page.locator('#study-paper').selectOption({ label: '논문 A.pdf' });
  await expect(page.locator('.study-card')).toHaveCount(1); await expect(page.locator('.study-paper-heading')).toHaveText('논문 A.pdf · 1개');
  await page.locator('#study-add').click(); await expect(page.locator('#study-source')).toHaveValue('논문 A.pdf'); await page.locator('#study-dismiss').click();
  await page.getByRole('tab', { name: '나의 문장' }).click();
  await expect(page.locator('.study-card')).toHaveCount(0);
  await page.locator('#study-add').click(); await expect(page.locator('#study-source')).toHaveValue('논문 A.pdf');
  await page.locator('#study-text').fill('We retain information.'); await page.locator('#study-submit').click();
  await expect(page.locator('.study-paper-heading')).toHaveText('논문 A.pdf · 1개');
  await page.getByRole('tab', { name: '나의 단어장' }).click();
  await page.locator('.study-card').getByRole('button', { name: '수정' }).click(); await page.locator('#study-source').fill('논문 B.pdf'); await page.locator('#study-submit').click();
  await expect(page.locator('.study-card')).toHaveCount(0);
  await page.locator('#study-paper').selectOption({ label: '논문 B.pdf' }); await expect(page.locator('.study-card')).toHaveCount(2);
  await page.locator('#study-search').fill('missing'); await expect(page.locator('.study-card')).toHaveCount(0); await page.locator('#study-search').fill('');
  await page.locator('#study-paper').selectOption('none'); await expect(page.locator('.study-card')).toContainText('unassigned');
  const event = page.waitForEvent('download'); await page.locator('#study-export').click(); const backup = await readFile((await (await event).path())!);
  const entries = JSON.parse(backup.toString()).entries; expect(entries).toHaveLength(4); expect(entries.filter((e: { source: string }) => e.source === '논문 B.pdf')).toHaveLength(2);
  await page.reload(); await page.getByRole('tab', { name: '나의 단어장' }).click();
  await expect(page.locator('.study-card')).toHaveCount(3); await expect(page.locator('.study-paper-group')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/papers-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#ui-font-size').selectOption('20');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#study-paper').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/papers-mobile.png' });
});

test('typing a dictionary query and manually adding entries inherit the open PDF', async ({ page }) => {
  await page.locator('#file-input').setInputFiles(path.resolve('tests/fixtures/reading.pdf'));
  await expect(page.locator('.pdf-page[data-ready=true]').first()).toBeVisible();
  await page.locator('#word-input').fill('retain'); await page.locator('#word-input').press('Enter');
  await expect(page.locator('#english-result')).toContainText('To keep.'); await page.locator('#dictionary-save').click();
  await expect(page.locator('#study-source')).toHaveValue('reading.pdf'); await expect(page.locator('#study-page')).toHaveValue('1'); await page.locator('#study-submit').click();
  await page.getByRole('tab', { name: '나의 문장' }).click(); await page.locator('#study-add').click();
  await expect(page.locator('#study-source')).toHaveValue('reading.pdf'); await expect(page.locator('#study-page')).toHaveValue('1');
  await page.locator('#study-text').fill('A saved sentence.'); await page.locator('#study-submit').click();
  await expect(page.locator('.study-paper-heading')).toHaveText('reading.pdf · 1개');
});

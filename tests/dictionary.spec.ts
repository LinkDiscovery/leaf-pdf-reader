import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

for (const mode of ['noun-only', 'noun-and-verb', 'offline']) test(`Korean lookup retains a known verb: ${mode}`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('leaf-tour-seen', '1'));
  await page.route('**/firebase-config.json', route => route.fulfill({ json: null }));
  await page.route('**/dictionary/en-ko.json', route => route.fulfill({ json: {
    metadata: { version: 'test', entries: 1 }, lookup: { record: [0] },
    entries: [['record', '<div><i>n.</i> <b>기록</b></div><div><i>v.</i> <b>기록하다</b></div>']],
  } }));
  await page.route('https://api.dictionaryapi.dev/**', route => route.fulfill({ json: [{ word: 'record', meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To make a record of information.' }] }] }] }));
  await page.route('https://translate.googleapis.com/**', route => {
    if (mode === 'offline') return route.abort('internetdisconnected');
    const groups = [['noun', ['기록'], [['기록', ['record']]]]];
    if (mode === 'noun-and-verb') groups.push(['verb', ['기록하다'], [['기록하다', ['record']]]]);
    return route.fulfill({ json: [[['기록', 'record']], groups] });
  });
  await page.goto('/');
  await page.locator('#word-input').fill('record'); await page.locator('#word-input').press('Enter');
  await expect(page.locator('#english-result')).toContainText('To make a record of information.');
  await expect(page.locator('#korean-result')).toContainText('기록');
  await expect(page.locator('#korean-result')).toContainText('기록하다', { timeout: 1500 });
  await expect(page.locator('#korean-result .ko-pos')).toContainText(['명사', '동사']);
});

async function dictionaryFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem('leaf-tour-seen', '1'));
  await page.route('**/firebase-config.json', route => route.fulfill({ json: null }));
  await page.route('**/dictionary/en-ko.json', route => route.fulfill({ json: { metadata: { version: 'test', entries: 0 }, entries: [], lookup: {} } }));
  await page.route('https://api.dictionaryapi.dev/**', route => {
    const word = decodeURIComponent(route.request().url().split('/').at(-1)!);
    const meanings = word === 'record' ? [
      { partOfSpeech: 'noun', definitions: ['Recorded information.', 'A data entry.', 'A best achievement.', 'A music disc.'].map(definition => ({ definition, example: 'This is a written record.' })) },
      { partOfSpeech: 'verb', definitions: [{ definition: 'To preserve information.', example: 'We record the results.' }, { definition: 'To capture sound.', example: 'They record a song.' }] },
      { partOfSpeech: 'adjective', definitions: [{ definition: 'Greater than any before.' }] },
    ] : [{ partOfSpeech: 'noun', definitions: [{ definition: 'Meaning of ' + word }] }];
    return route.fulfill({ json: [{ word, meanings }] });
  });
  await page.route('https://translate.googleapis.com/**', route => {
    const word = new URL(route.request().url()).searchParams.get('q')!;
    return route.fulfill({ json: word === 'record' ? [[['기록', word]], [
      ['noun', ['기록', '자료', '최고 기록', '음반'], [['기록', ['record']], ['자료', ['data']], ['최고 기록', ['best']], ['음반', ['disc']]]],
      ['verb', ['기록하다', '녹음하다'], [['기록하다', ['record']], ['녹음하다', ['record']]]],
      ['adjective', ['기록적인'], [['기록적인', ['record']]]],
    ]] : [[['번역: ' + word, word]]] });
  });
  await page.goto('/');
}
async function lookup(page: Page, word: string) {
  await page.locator('#word-input').fill(word); await page.locator('#word-input').press('Enter');
  await expect(page.locator('#word-title')).toHaveText(word);
  await expect(page.locator('#korean-badge')).not.toHaveText('조회 중');
  if (!word.includes(' ')) await expect(page.locator('#english-result .meaning-check').first()).toBeVisible();
}

test('each part of speech allows three meanings per language, preserves choices and saves together or separately', async ({ page }) => {
  await dictionaryFixture(page); await lookup(page, 'record');
  const en = page.locator('#english-result .meaning-check'), ko = page.locator('#korean-result .meaning-check');
  await en.nth(1).check(); await en.nth(2).check(); await ko.nth(1).check(); await ko.nth(2).check();
  await expect(page.locator('#dictionary-en-count')).toHaveText('선택 5개 · 품사별 3개'); await expect(page.locator('#dictionary-ko-count')).toHaveText('선택 5개 · 품사별 3개');
  await expect(en.nth(3)).toBeDisabled(); await expect(ko.nth(3)).toBeDisabled();
  await expect(en.nth(5)).toBeEnabled(); await expect(ko.nth(5)).toBeEnabled();
  await page.locator('#dictionary-pos').selectOption('adjective');
  await expect(en.first()).toBeChecked(); await expect(ko.first()).toBeChecked();
  await page.locator('#dictionary-pos').selectOption('all');
  await expect(en.nth(2)).toBeChecked(); await expect(ko.nth(2)).toBeChecked();
  await page.locator('#dictionary-save').click();
  await expect(page.locator('#study-english')).toHaveValue('[명사] Recorded information.\n[명사] A data entry.\n[명사] A best achievement.\n[동사] To preserve information.\n[형용사] Greater than any before.');
  await expect(page.locator('#study-korean')).toHaveValue('[명사] 기록\n[명사] 자료\n[명사] 최고 기록\n[동사] 기록하다\n[형용사] 기록적인');
  await page.locator('#study-submit').click();
  await page.locator('#dictionary-pos').selectOption('verb');
  await expect(en).toHaveCount(2); await expect(ko).toHaveCount(2);
  await page.locator('#dictionary-save').click();
  await expect(page.locator('#study-english')).toHaveValue('[동사] To preserve information.');
  await expect(page.locator('#study-korean')).toHaveValue('[동사] 기록하다');
  await expect(page.locator('#study-example')).toHaveValue('We record the results.');
  await expect(page.locator('#study-duplicate')).toBeVisible();
  await page.locator('#study-submit').click();
  await page.getByRole('tab', { name: '나의 단어장' }).click();
  await expect(page.locator('.study-card')).toHaveCount(2);
  await page.reload(); await page.getByRole('tab', { name: '나의 단어장' }).click();
  await expect(page.locator('.study-card').filter({ hasText: '[명사] 자료' })).toHaveCount(1);
  await expect(page.locator('.study-card').filter({ hasText: '[동사] 기록하다' })).toHaveCount(2);
});

test('three-search history restores choices within the open app and clears on reload', async ({ page }) => {
  await dictionaryFixture(page); await lookup(page, 'record');
  await page.locator('#dictionary-pos').selectOption('verb');
  await page.locator('#english-result .meaning-check').nth(0).uncheck(); await page.locator('#english-result .meaning-check').nth(1).check();
  await page.locator('#korean-result .meaning-check').nth(0).uncheck(); await page.locator('#korean-result .meaning-check').nth(1).check();
  await lookup(page, 'secondword'); await lookup(page, 'thirdword');
  await expect(page.locator('#recent-words button')).toHaveCount(3);
  await page.locator('#dictionary-back').click(); await expect(page.locator('#word-title')).toHaveText('secondword');
  await page.locator('#dictionary-back').click(); await expect(page.locator('#word-title')).toHaveText('record');
  await expect(page.locator('#dictionary-pos')).toHaveValue('verb');
  await expect(page.locator('#english-result .meaning-check').nth(1)).toBeChecked();
  await expect(page.locator('#english-result .meaning-check').nth(0)).not.toBeChecked();
  let requests = 0;
  await page.route('https://api.dictionaryapi.dev/**', route => { requests++; return route.abort('internetdisconnected'); });
  await page.route('https://translate.googleapis.com/**', route => { requests++; return route.abort('internetdisconnected'); });
  await expect(page.locator('#word-title')).toHaveText('record');
  await expect(page.locator('#korean-result .meaning-check').nth(1)).toBeChecked();
  await expect(page.locator('#dictionary-back')).toBeDisabled();
  await page.locator('#dictionary-forward').click(); await expect(page.locator('#word-title')).toHaveText('secondword');
  await expect(page.locator('#english-result')).toContainText('Meaning of secondword');
  expect(requests).toBe(0);
  await page.locator('#word-input').fill('fourthword'); await page.locator('#word-input').press('Enter');
  await expect(page.locator('#word-title')).toHaveText('fourthword');
  await expect(page.locator('#recent-words')).not.toContainText('thirdword');
  await page.locator('#word-input').fill('fifthword'); await page.locator('#word-input').press('Enter');
  await expect(page.locator('#recent-words button')).toHaveCount(3);
  await expect(page.locator('#recent-words')).not.toContainText('record');
  await page.reload(); await expect(page.locator('#recent-words button')).toHaveCount(0);
  await expect(page.locator('#word-input')).toHaveValue(''); await expect(page.locator('#dictionary-content')).toBeHidden();
  await page.locator('#word-input').fill('freshword'); await page.locator('#word-input').press('Enter');
  await expect(page.locator('#recent-words button')).toHaveCount(1);
  await page.locator('#dictionary-history-clear').click();
  await expect(page.locator('#dictionary-content')).toBeHidden();
  await page.reload(); await expect(page.locator('#recent-words button')).toHaveCount(0);
});

test('closing and reopening clears lookup history, removes legacy cache, and keeps saved words', async ({ page, context }) => {
  await dictionaryFixture(page); await lookup(page, 'record');
  await page.locator('#dictionary-save').click(); await page.locator('#study-submit').click();
  await expect(page.locator('#study-editor')).toBeHidden();
  await page.getByRole('tab', { name: '나의 단어장' }).click(); await expect(page.locator('.study-card')).toContainText('record');
  await page.evaluate(() => localStorage.setItem('leaf-dictionary-history-v1', JSON.stringify({ version: 1, index: 0, entries: [{ id: 'old', query: 'oldword', kind: 'word', pos: 'all', source: { source: '', page: 0, example: '' } }] })));
  await page.close();
  const reopened = await context.newPage(); await dictionaryFixture(reopened);
  await expect(reopened.locator('#recent-words button')).toHaveCount(0);
  await expect(reopened.locator('#dictionary-content')).toBeHidden();
  expect(await reopened.evaluate(() => localStorage.getItem('leaf-dictionary-history-v1'))).toBeNull();
  await reopened.getByRole('tab', { name: '나의 단어장' }).click(); await expect(reopened.locator('.study-card')).toContainText('record');
});

test('returning to a PDF lookup preserves its source and example after another search', async ({ page }) => {
  await dictionaryFixture(page);
  await page.locator('#file-input').setInputFiles(path.resolve('tests/fixtures/reading.pdf'));
  const span = page.locator('.pdf-page[data-index="0"][data-ready="true"] .textLayer span').filter({ hasText: 'Hello world' });
  await expect(span).toBeVisible(); const box = (await span.boundingBox())!;
  await page.mouse.dblclick(box.x + 15, box.y + box.height / 2);
  await expect(page.locator('#word-title')).toHaveText('hello'); await expect(page.locator('#dictionary-en-count')).toHaveText('선택 1개 · 품사별 3개');
  await lookup(page, 'record'); await page.locator('#dictionary-back').click();
  await page.locator('#dictionary-save').click();
  await expect(page.locator('#study-text')).toHaveValue('hello');
  await expect(page.locator('#study-source')).toHaveValue('reading.pdf'); await expect(page.locator('#study-page')).toHaveValue('1');
  await expect(page.locator('#study-example')).toHaveValue(/Hello world/);
});

test('sentence translation returns after a word chip lookup and large-text mobile fits', async ({ page }) => {
  await dictionaryFixture(page);
  const sentence = 'This is a sentence about a record.';
  await lookup(page, sentence);
  await page.locator('#english-result').getByRole('button', { name: 'record', exact: true }).click();
  await expect(page.locator('#word-title')).toHaveText('record');
  await page.locator('#dictionary-back').click();
  await expect(page.locator('#korean-result')).toContainText('번역: ' + sentence);
  await expect(page.locator('#dictionary-picks')).toBeHidden();
  await page.locator('#dictionary-save').click();
  await expect(page.locator('#study-editor-title')).toHaveText('문장 저장');
  await expect(page.locator('#study-korean')).toHaveValue('번역: ' + sentence); await page.locator('#study-dismiss').click();
  await page.locator('#dictionary-forward').click(); await expect(page.locator('#english-result .meaning-check').first()).toBeVisible();
  await page.locator('#ui-font-size').selectOption('20'); await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#dictionary-pos').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/dictionary-mobile.png' });
});

test('late lookup responses do not replace text being typed into the search field', async ({ page }) => {
  await dictionaryFixture(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://api.dictionaryapi.dev/**', async route => { await pending; await route.fulfill({ json: [{ meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'Delayed result' }] }] }] }); });
  await page.locator('#word-input').fill('firstword'); await page.locator('#word-input').press('Enter');
  await expect(page.locator('#korean-badge')).not.toHaveText('조회 중');
  await page.locator('#word-input').fill('typingnext'); release();
  await expect(page.locator('#english-result')).toContainText('Delayed result');
  await expect(page.locator('#word-input')).toHaveValue('typingnext');
});

test('long combined meanings are retained and saving explains the size limit', async ({ page }) => {
  await dictionaryFixture(page);
  await page.route('https://api.dictionaryapi.dev/**', route => route.fulfill({ json: [{ meanings: ['noun', 'verb', 'adjective', 'adverb'].map(partOfSpeech => ({ partOfSpeech, definitions: [{ definition: partOfSpeech + 'x'.repeat(1100) }] })) }] }));
  await lookup(page, 'longword'); await page.locator('#dictionary-save').click();
  const original = await page.locator('#study-english').inputValue(); expect(original.length).toBeGreaterThan(4000);
  await page.locator('#study-submit').click();
  await expect(page.locator('#study-form-error')).toContainText('4,000자');
  await expect(page.locator('#study-english')).toHaveValue(original);
  await page.locator('#study-english').fill('Shortened meaning'); await page.locator('#study-submit').click();
  await page.getByRole('tab', { name: '나의 단어장' }).click(); await expect(page.locator('.study-card')).toContainText('Shortened meaning');
});

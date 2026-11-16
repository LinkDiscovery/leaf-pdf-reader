import { test, expect, type Page } from '@playwright/test';
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('leaf-tour-seen', '1')); });
async function login(page: Page, email: string) {
  await page.addInitScript(() => localStorage.setItem('leaf-tour-seen', '1'));
  await page.goto('/'); await expect(page.locator('#study-login')).toBeVisible();
  await page.evaluate(async email => { const driver = await import('/tests/sync/auth-driver.ts'); await driver.login(email); }, email);
  await expect(page.locator('#study-sync')).toContainText('동기화 완료');
  await page.getByRole('tab', { name: '나의 단어장' }).click();
}
test('two devices sync, persist offline changes, isolate accounts and preserve deletions', async ({ browser }) => {
  const a = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' }); const b = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' });
  const first = await a.newPage(); const second = await b.newPage();
  const email = `reader-${Date.now()}@example.test`;
  try {
    await login(first, email); await login(second, email);
    await first.locator('#study-add').click(); await first.locator('#study-text').fill('retain'); await first.locator('#study-korean').fill('기억하다'); await first.locator('#study-submit').click();
    await expect(first.locator('#study-sync')).toContainText('동기화 완료'); await expect(second.locator('.study-card')).toContainText('retain');
    await a.setOffline(true);
    await first.locator('.study-card').getByRole('button', { name: '수정' }).click(); await first.locator('#study-korean').fill('오프라인 수정'); await first.locator('#study-submit').click();
    await expect(first.locator('#study-sync')).toContainText('전송 대기'); await expect(first.locator('#study-logout')).toBeDisabled();
    await expect(second.locator('.study-card')).toContainText('기억하다');
    await a.setOffline(false); await expect(second.locator('.study-card')).toContainText('오프라인 수정');
    await expect(first.locator('#study-sync')).toContainText('동기화 완료');
    await first.reload(); await first.getByRole('tab', { name: '나의 단어장' }).click(); await expect(first.locator('.study-card')).toContainText('오프라인 수정');
    await second.locator('.study-card').getByRole('button', { name: '삭제' }).click(); await second.locator('#study-delete-dialog button[value=delete]').click(); await expect(first.locator('.study-card')).toHaveCount(0);
    await first.locator('#study-add').click(); await first.locator('#study-text').fill('private-word'); await first.locator('#study-submit').click(); await expect(first.locator('#study-sync')).toContainText('동기화 완료');
    await first.locator('#study-logout').click(); await expect(first.locator('#study-sync')).toContainText('이 기기에 저장'); await expect(first.locator('.study-card')).toHaveCount(0);
    await first.evaluate(async () => { const driver = await import('/tests/sync/auth-driver.ts'); await driver.login(`other-${Date.now()}@example.test`); });
    await expect(first.locator('#study-sync')).toContainText('동기화 완료'); await expect(first.locator('.study-card')).toHaveCount(0);
    await expect(second.locator('.study-card')).toContainText('private-word');
  } finally { await a.close(); await b.close(); }
});

test('guest records migrate explicitly and reimport does not overwrite account edits', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#study-login')).toBeVisible();
  await page.getByRole('tab', { name: '나의 단어장' }).click();
  await page.locator('#study-add').click(); await page.locator('#study-text').fill('guest-word'); await page.locator('#study-korean').fill('기기 뜻'); await page.locator('#study-submit').click();
  await expect(page.locator('.study-card')).toContainText('guest-word');
  await page.evaluate(async () => { const driver = await import('/tests/sync/auth-driver.ts'); await driver.login(`import-${Date.now()}@example.test`); });
  await expect(page.locator('#study-sync')).toContainText('동기화 완료'); await expect(page.locator('.study-card')).toHaveCount(0);
  await page.locator('#study-migrate').click(); await expect(page.locator('.study-card')).toContainText('guest-word');
  await page.locator('.study-card').getByRole('button', { name: '수정' }).click(); await page.locator('#study-korean').fill('계정에서 수정한 뜻'); await page.locator('#study-submit').click();
  await expect(page.locator('#study-sync')).toContainText('동기화 완료');
  await page.locator('#study-migrate').click(); await expect(page.locator('#toast')).toContainText('0개를 가져왔어요'); await expect(page.locator('.study-card')).toContainText('계정에서 수정한 뜻');
  await page.locator('#study-logout').click(); await expect(page.locator('#study-sync')).toContainText('이 기기에 저장'); await expect(page.locator('.study-card')).toContainText('기기 뜻');
});

test('three meanings for each of three parts of speech sync intact to another device', async ({ browser }) => {
  const a = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' }), b = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' });
  const first = await a.newPage(), second = await b.newPage();
  const parts = ['noun', 'verb', 'adjective'], labels = ['명사', '동사', '형용사'];
  const english = parts.flatMap((pos, p) => [1, 2, 3].map(n => `[${labels[p]}] ${pos} meaning ${n}`)).join('\n');
  const korean = parts.flatMap((_, p) => [1, 2, 3].map(n => `[${labels[p]}] 뜻 ${p + 1}-${n}`)).join('\n');
  try {
    await first.route('https://api.dictionaryapi.dev/**', route => route.fulfill({ json: [{ word: 'testword', meanings: parts.map(partOfSpeech => ({ partOfSpeech, definitions: [1, 2, 3, 4].map(n => ({ definition: `${partOfSpeech} meaning ${n}` })) })) }] }));
    await first.route('https://translate.googleapis.com/**', route => route.fulfill({ json: [[['뜻 1-1', 'testword']], parts.map((pos, p) => [pos, [1, 2, 3, 4].map(n => `뜻 ${p + 1}-${n}`)])] }));
    const email = `multi-pos-${Date.now()}@example.test`;
    await login(first, email); await login(second, email);
    await first.getByRole('tab', { name: 'PDF 읽기' }).click();
    await first.locator('#word-input').fill('testword'); await first.locator('#word-input').press('Enter');
    for (const panel of ['#english-result', '#korean-result']) for (const pos of parts) {
      const checks = first.locator(`${panel} .meaning-check[data-pos="${pos}"]`);
      await checks.nth(1).check(); await checks.nth(2).check(); await expect(checks.nth(3)).toBeDisabled();
    }
    await first.reload();
    await expect(first.locator('#dictionary-en-count')).toHaveText('선택 9개 · 품사별 3개');
    await expect(first.locator('#dictionary-ko-count')).toHaveText('선택 9개 · 품사별 3개');
    await expect(first.locator('#study-sync')).toContainText('동기화 완료');
    await first.locator('#dictionary-save').click();
    await expect(first.locator('#study-english')).toHaveValue(english); await expect(first.locator('#study-korean')).toHaveValue(korean);
    await first.locator('#study-submit').click();
    await expect(second.locator('.study-card')).toContainText('testword');
    await second.locator('.study-card').getByRole('button', { name: '수정' }).click();
    await expect(second.locator('#study-english')).toHaveValue(english); await expect(second.locator('#study-korean')).toHaveValue(korean);
  } finally { await a.close(); await b.close(); }
});

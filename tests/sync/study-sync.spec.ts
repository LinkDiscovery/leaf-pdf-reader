import { test, expect, type Page } from '@playwright/test';
async function login(page: Page, email: string) {
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

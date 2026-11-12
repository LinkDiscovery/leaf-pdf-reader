import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/firebase-config.json', route => route.fulfill({ json: null }));
});

test('first visit spotlight, skip persists, manual replay completes and restores the current tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#tour-dialog')).toBeVisible();
  await expect(page.locator('#tour-title')).toHaveText('내 PDF로 시작하세요');
  await expect(page.locator('#tour-skip')).toBeFocused();
  const target = (await page.locator('#open-button').boundingBox())!;
  const spot = (await page.locator('#tour-spotlight').boundingBox())!;
  expect(spot.x).toBeLessThan(target.x); expect(spot.x + spot.width).toBeGreaterThan(target.x + target.width);
  await page.screenshot({ path: 'test-results/tour-desktop.png' });
  await page.locator('#tour-skip').click();
  await expect(page.locator('#tour-dialog')).toBeHidden();
  await page.reload(); await expect(page.locator('#welcome-help')).toBeVisible();
  await expect(page.locator('#tour-dialog')).toBeHidden();
  await page.getByRole('tab', { name: '나의 문장' }).click();
  await page.locator('#help-open').click();
  for (let index = 1; index <= 9; index++) {
    await expect(page.locator('#tour-progress')).toHaveText(`${index} / 9 · 처음 사용 안내`);
    if (index === 4) {
      await expect(page.locator('[data-tour-word]')).toHaveText('단어장 추가');
      await page.screenshot({ path: 'test-results/tour-selection.png' });
    }
    await page.locator('#tour-next').click();
  }
  await expect(page.locator('#tour-dialog')).toBeHidden();
  await expect(page.locator('#tab-sentences')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#help-open')).toBeFocused();
  await expect(page.locator('.study-card')).toHaveCount(0);
  await page.reload(); await expect(page.locator('#welcome-help')).toBeVisible();
  await expect(page.locator('#tour-dialog')).toBeHidden();
});

test('large text mobile tour stays inside viewport, goes back, opens reference and dismisses with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('leaf-ui-font-size', '20'));
  await page.goto('/');
  for (let index = 1; index <= 9; index++) {
    await expect(page.locator('#tour-progress')).toContainText(`${index} / 9`);
    const card = (await page.locator('#tour-card').boundingBox())!;
    const spot = (await page.locator('#tour-spotlight').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(0); expect(card.x + card.width).toBeLessThanOrEqual(390);
    expect(card.y).toBeGreaterThanOrEqual(0); expect(card.y + card.height).toBeLessThanOrEqual(844);
    expect(spot.width).toBeGreaterThan(0); expect(spot.height).toBeGreaterThan(0);
    expect(card.y >= spot.y + spot.height || card.y + card.height <= spot.y || card.x >= spot.x + spot.width || card.x + card.width <= spot.x).toBe(true);
    if (index === 4) await page.screenshot({ path: 'test-results/tour-mobile-large.png' });
    await page.locator('#tour-next').click();
  }
  await page.reload(); await expect(page.locator('#welcome-help')).toBeVisible();
  await expect(page.locator('#tour-dialog')).toBeHidden();
  await page.locator('#help-open').click(); await page.locator('#tour-next').click();
  await page.locator('#tour-prev').click(); await expect(page.locator('#tour-progress')).toContainText('1 / 9');
  await page.keyboard.press('Escape'); await expect(page.locator('#tour-dialog')).toBeHidden();
  await page.locator('#help-open').click(); await page.locator('#tour-reference').click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await page.locator('#help-tour').click(); await expect(page.locator('#tour-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
});

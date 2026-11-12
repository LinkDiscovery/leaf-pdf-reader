import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('leaf-tour-seen', '1'));
  await page.route('**/firebase-config.json', route => route.fulfill({ json: null }));
  await page.route('https://api.dictionaryapi.dev/**', route => route.fulfill({ json: [{ word: 'hello', meanings: [] }] }));
  await page.route('https://translate.googleapis.com/**', route => route.fulfill({ json: [[['안녕하세요', 'hello']]] }));
});

async function mockAudio(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const state = { calls: [] as any[], canceled: 0, voices: [{ name: 'Korean', lang: 'ko-KR', localService: true }, { name: 'English', lang: 'en-US', localService: true }] };
    (window as any).__audio = state;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(public text: string) {} } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => state.voices,
      speak: (utterance: any) => state.calls.push(utterance),
      cancel: () => { state.canceled++; state.calls.at(-1)?.onerror?.({ error: 'canceled' }); },
    } });
  });
}

test('dictionary word pronunciation toggles, uses English voice, ignores stale events and hides for sentences', async ({ page }) => {
  await mockAudio(page); await page.goto('/');
  await page.locator('#word-input').fill('hello'); await page.locator('#word-input').press('Enter');
  const listen = page.locator('#dictionary-audio button');
  await expect(listen).toHaveAccessibleName('hello 발음 듣기'); await listen.click();
  expect(await page.evaluate(() => { const u = (window as any).__audio.calls[0]; return [u.text, u.lang, u.voice.name]; })).toEqual(['hello', 'en-US', 'English']);
  await expect(listen).toHaveText('■ 멈추기'); await listen.click(); await expect(listen).toHaveText('🔊 듣기');
  expect(await page.evaluate(() => (window as any).__audio.canceled)).toBe(1);
  await listen.click();
  await page.locator('#word-input').fill('book'); await page.locator('#word-input').press('Enter');
  await expect(listen).toHaveAttribute('aria-pressed', 'false'); await listen.click();
  await page.evaluate(() => (window as any).__audio.calls[1].onend());
  await expect(listen).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as any).__audio.calls.at(-1).onend());
  await expect(listen).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'test-results/audio-dictionary.png', fullPage: true });
  await page.locator('#word-input').fill('This is a full sentence.'); await page.locator('#word-input').press('Enter');
  await expect(listen).toHaveCount(0);
});

test('word cards pronounce only their word, stop on switch or filtering, and sentence cards have no audio', async ({ page }) => {
  await mockAudio(page); await page.goto('/');
  await page.getByRole('tab', { name: '나의 단어장' }).click();
  for (const word of ['retain', 'curiosity']) {
    await page.locator('#study-add').click(); await page.locator('#study-text').fill(word); await page.locator('#study-korean').fill('뜻');
    await page.locator('#study-example').fill('This example must not be read.'); await page.locator('#study-submit').click();
    await expect(page.locator('#study-editor')).toBeHidden();
  }
  const retain = page.getByRole('button', { name: 'retain 발음 듣기' });
  await retain.click(); await page.getByRole('button', { name: 'curiosity 발음 듣기' }).click();
  expect(await page.evaluate(() => (window as any).__audio.calls.map((u: any) => u.text))).toEqual(['retain', 'curiosity']);
  await expect(retain).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#study-search').fill('retain');
  expect(await page.evaluate(() => (window as any).__audio.canceled)).toBe(2);
  await page.locator('#study-search').fill('');
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#ui-font-size').selectOption('20');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/audio-wordbook-mobile.png', fullPage: true });
  await retain.click(); await page.getByRole('tab', { name: '나의 문장' }).click();
  expect(await page.evaluate(() => (window as any).__audio.canceled)).toBe(3);
  await page.locator('#study-add').click(); await page.locator('#study-text').fill('Keep learning.'); await page.locator('#study-submit').click();
  await expect(page.locator('.study-card')).toHaveCount(1); await expect(page.locator('.study-card .word-audio')).toHaveCount(0);
});

test('voice errors recover and missing speech support leaves a disabled explanation', async ({ page }) => {
  await mockAudio(page); await page.goto('/');
  await page.locator('#word-input').fill('hello'); await page.locator('#word-input').press('Enter');
  const listen = page.locator('#dictionary-audio button'); await listen.click();
  await page.evaluate(() => (window as any).__audio.calls.at(-1).onerror({ error: 'voice-unavailable' }));
  await expect(listen).toHaveAttribute('aria-pressed', 'false'); await expect(page.locator('#toast')).toContainText('재생하지 못했어요');
  await page.evaluate(() => (window as any).__audio.voices = []); await listen.click();
  expect(await page.evaluate(() => (window as any).__audio.calls.at(-1).lang)).toBe('en-US');
  await listen.click();
  await page.evaluate(() => (window as any).__audio.voices = [{ lang: 'ko-KR', localService: true }]); await listen.click();
  await expect(page.locator('#toast')).toContainText('영어 음성을 찾지 못했어요');
  await page.addInitScript(() => { delete (window as any).speechSynthesis; delete (window as any).SpeechSynthesisUtterance; });
  await page.reload(); await page.locator('#word-input').fill('hello'); await page.locator('#word-input').press('Enter');
  await expect(listen).toBeDisabled(); await expect(listen).toHaveText('음성 미지원');
});

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('leaf-tour-seen', '1'));
  await page.route('**/firebase-config.json', route => route.fulfill({ json: null }));
  await page.route('https://api.dictionaryapi.dev/**', route => route.fulfill({ json: [{ word: 'hello', meanings: [] }] }));
  await page.route('https://translate.googleapis.com/**', route => route.fulfill({ json: [[['안녕하세요', 'hello']]] }));
});

async function mockAudio(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const state = { calls: [] as any[], recordings: [] as any[], canceled: 0, paused: 0, voices: [{ name: 'Korean', lang: 'ko-KR', localService: true }, { name: 'English', lang: 'en-US', localService: true }] };
    (window as any).__audio = state;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(public text: string) {} } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => state.voices,
      speak: (utterance: any) => state.calls.push(utterance),
      cancel: () => { state.canceled++; state.calls.at(-1)?.onerror?.({ error: 'canceled' }); },
    } });
    Object.defineProperty(window, 'Audio', { configurable: true, value: class {
      constructor(public src: string) { state.recordings.push(this); }
      async play() {} pause() { state.paused++; }
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

test('voice errors recover and unavailable English voices use cancelable dictionary recordings', async ({ page }) => {
  await mockAudio(page); await page.goto('/');
  await page.locator('#word-input').fill('hello'); await page.locator('#word-input').press('Enter');
  const listen = page.locator('#dictionary-audio button'); await listen.click();
  await page.evaluate(() => (window as any).__audio.calls.at(-1).onerror({ error: 'voice-unavailable' }));
  await expect.poll(() => page.evaluate(() => (window as any).__audio.recordings.length)).toBe(1);
  await page.evaluate(() => (window as any).__audio.recordings[0].onerror());
  await expect.poll(() => page.evaluate(() => (window as any).__audio.recordings.length)).toBe(2);
  await page.evaluate(() => (window as any).__audio.recordings[1].onended());
  await expect(listen).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => (window as any).__audio.voices = []); await listen.click();
  await expect.poll(() => page.evaluate(() => (window as any).__audio.recordings.length)).toBe(3);
  await expect(listen).toHaveAttribute('aria-pressed', 'true');
  await listen.click(); expect(await page.evaluate(() => (window as any).__audio.paused)).toBeGreaterThan(0);
  await listen.click(); await expect.poll(() => page.evaluate(() => (window as any).__audio.recordings.length)).toBe(4);
  await page.evaluate(() => (window as any).__audio.recordings[2].onended());
  await expect(listen).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as any).__audio.recordings[3].onended());
  await expect(listen).toHaveAttribute('aria-pressed', 'false');
  // A stopped network lookup must not start audio later.
  await page.route('https://api.dictionaryapi.dev/**', async route => { await new Promise(resolve => setTimeout(resolve, 200)); await route.fulfill({ json: [{ phonetics: [{ audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/book.mp3' }] }] }); });
  await page.locator('#word-input').fill('book'); await page.locator('#word-input').press('Enter');
  await listen.click(); await listen.click();
  await expect(page.locator('#word-title')).toHaveText('book');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__audio.recordings.length)).toBe(4);
});

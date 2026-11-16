import { test, expect, type Page } from '@playwright/test';
import { parsePattern, patternNote } from '../src/sentence-pattern';

test('pattern parsing and note preservation reject malformed output and overflow', () => {
  const value = { pattern: 'A + depend on + B', meaning: 'A가 B에 달려 있다.' };
  expect(parsePattern('<think>internal</think>\n' + JSON.stringify(value))).toEqual(value);
  expect(parsePattern(JSON.stringify({ pattern: 'be interested in + noun / V-ing', meaning: '~에 관심이 있다.' })).pattern).toBe('be interested in + 명사 / 동사-ing');
  expect(() => parsePattern('<think>unfinished')).toThrow();
  expect(() => parsePattern('{"pattern":"x","meaning":""}')).toThrow();
  expect(() => parsePattern('{"pattern":"A + 名詞","meaning":"뜻"}')).toThrow();
  expect(() => patternNote('x'.repeat(4000), value)).toThrow();
  expect(patternNote(patternNote('기존 메모\n둘째 줄', value), value)).toBe('문장 패턴: A + depend on + B\n패턴 뜻: A가 B에 달려 있다.\n\n기존 메모\n둘째 줄');
});

async function openSentence(page: Page) {
  await page.addInitScript(() => localStorage.setItem('leaf-tour-seen', '1'));
  await page.route('**/firebase-config.json', route => route.fulfill({ json: null }));
  await page.goto('/');
  await page.getByRole('tab', { name: '나의 문장' }).click();
  await page.locator('#study-add').click();
  await page.locator('#study-text').fill('It remains difficult for students to understand the theory.');
  await page.locator('#sentence-pattern summary').click();
}

test('manual patterns require explicit save, preserve notes and survive backup without downloading a model', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', request => { if (/huggingface|pattern\.worker|mlc-ai.*wasm/.test(request.url())) modelRequests.push(request.url()); });
  await openSentence(page);
  await page.locator('#study-note').fill('내가 적은 메모');
  await page.locator('#pattern-value').fill('It remains + 형용사 + for A + to B');
  await page.locator('#pattern-meaning').fill('A가 B하는 것은 여전히 ~하다.');
  await page.locator('#pattern-apply').click();
  await expect(page.locator('#study-note')).toHaveValue(/내가 적은 메모$/);
  await page.locator('#study-submit').click();
  await page.reload(); await page.getByRole('tab', { name: '나의 문장' }).click();
  await expect(page.locator('.study-card')).toContainText('It remains + 형용사');
  await page.locator('.study-card').getByRole('button', { name: '패턴 분석' }).click();
  await expect(page.locator('#sentence-pattern')).toHaveAttribute('open', '');
  await expect(page.locator('#pattern-meaning')).toHaveValue('A가 B하는 것은 여전히 ~하다.');
  await page.locator('#pattern-meaning').fill('수정한 뜻'); await page.locator('#pattern-apply').click();
  const note = await page.locator('#study-note').inputValue();
  expect(note.match(/문장 패턴:/g)).toHaveLength(1); expect(note).toContain('내가 적은 메모');
  await page.locator('#study-dismiss').click();
  await expect(page.locator('.study-card')).not.toContainText('수정한 뜻');
  const downloaded = page.waitForEvent('download'); await page.locator('#study-export').click();
  const download = await downloaded;
  const { readFile } = await import('node:fs/promises');
  const backup = await readFile((await download.path())!);
  expect(JSON.parse(backup.toString()).entries[0].note).toContain('패턴 뜻:');
  await page.locator('.study-card').getByRole('button', { name: '삭제' }).click(); await page.locator('#study-delete-dialog button[value=delete]').click();
  await expect(page.locator('.study-card')).toHaveCount(0);
  await page.locator('#study-import').click();
  await page.locator('#study-import-file').setInputFiles({ name: 'patterns.json', mimeType: 'application/json', buffer: backup });
  await expect(page.locator('.study-card')).toContainText('패턴 뜻:');
  await page.locator('.study-card').getByRole('button', { name: '패턴 분석' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('#study-editor').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(modelRequests).toEqual([]);
  await page.screenshot({ path: 'test-results/pattern-mobile.png' });
});

test('analysis is opt-in, cancellation ignores late results, and errors keep user notes', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as any).patternWorkers = [];
    window.Worker = class {
      onmessage: ((event: any) => void) | null = null;
      onerror = null; terminated = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        if (!String(url).includes('pattern.worker')) return new NativeWorker(url, options) as any;
        (window as any).patternWorkers.push(this);
      }
      postMessage() { this.onmessage?.({ data: { type: 'analyzing' } }); }
      terminate() { this.terminated = true; }
    } as any;
  });
  await openSentence(page);
  expect(await page.evaluate(() => (window as any).patternWorkers.length)).toBe(0);
  await page.locator('#study-note').fill('보존할 메모');
  await page.locator('#pattern-run').click(); await expect(page.locator('#pattern-status')).toContainText('분석하고');
  await page.locator('#study-text').fill('A new sentence.');
  await expect(page.locator('#pattern-status')).toContainText('원문이 바뀌어');
  await page.evaluate(() => (window as any).patternWorkers[0].onmessage({ data: { type: 'result', value: { pattern: 'stale', meaning: '지난 결과' } } }));
  await expect(page.locator('#pattern-value')).toHaveValue('');
  await page.locator('#pattern-run').click(); await expect(page.locator('#pattern-status')).toContainText('분석하고');
  await page.evaluate(() => (window as any).patternWorkers.at(-1).onmessage({ data: { type: 'error', message: 'GPU를 사용할 수 없어요.' } }));
  await expect(page.locator('#pattern-status')).toContainText('GPU');
  await expect(page.locator('#study-note')).toHaveValue('보존할 메모');
  await expect(page.locator('#pattern-run')).toBeEnabled();
  await page.locator('#pattern-run').click(); await expect(page.locator('#pattern-status')).toContainText('분석하고');
  await page.evaluate(() => (window as any).patternWorkers.at(-1).onmessage({ data: { type: 'result', value: { pattern: 'A + depend on + B', meaning: 'A가 B에 달려 있다.' } } }));
  await expect(page.locator('#pattern-value')).toHaveValue('A + depend on + B');
  await expect(page.locator('#study-note')).toHaveValue('보존할 메모');
  await page.locator('#pattern-apply').click();
  await expect(page.locator('#study-note')).toHaveValue(/패턴 뜻:.*\n\n보존할 메모/);
});

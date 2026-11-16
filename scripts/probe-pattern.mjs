// Manual, real-model experiment: downloads GBs of weights; never part of npm test.
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const suite = option('--suite', 'sentences');
if (!['sentences', 'held-out'].includes(suite)) throw new Error('--suite must be sentences or held-out');
const url = new URL('tests/pattern/probe.html', option('--url', 'http://127.0.0.1:4173/'));
const model = option('--model', '');
if (model) url.searchParams.set('model', model);
const sentences = JSON.parse(await readFile(path.join(root, `tests/pattern/${suite}.json`), 'utf8'));
const thinking = process.argv.includes('--thinking');
const context = await chromium.launchPersistentContext(path.join(root, '.cache/pattern-probe'), { channel: 'msedge', headless: true });
let page, timer, result;
try {
  page = await context.newPage();
  await page.goto(url.href);
  await page.waitForFunction(() => Boolean(window.runProbe));
  timer = setInterval(async () => {
    try { console.log(await page.evaluate(() => ({ progress: window.probeState?.progress, completed: window.probeState?.results?.length }))); } catch {}
  }, 15000);
  result = await page.evaluate(({ sentences, thinking }) => window.runProbe(sentences, thinking), { sentences, thinking });
} catch (error) {
  result = { ...(await page?.evaluate(() => window.probeState).catch(() => ({}))), error: String(error) };
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  const output = path.join(root, `test-results/pattern-probe-${Date.now()}.json`);
  await writeFile(output, JSON.stringify({ date: new Date().toISOString(), suite, thinking, ...result }, null, 2));
  console.log(output);
  await context.close();
}

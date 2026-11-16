import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { patternInstruction, parsePattern } from '../src/sentence-pattern.ts';

const model = process.argv[2] || 'qwen3:8b';
const suite = process.argv[3] || 'sentences';
if (!['sentences', 'held-out'].includes(suite)) throw new Error('Unknown suite');
const all = JSON.parse(await readFile(new URL(`../tests/pattern/${suite}.json`, import.meta.url), 'utf8'));
const one = process.argv.find(argument => argument.startsWith('--one='));
const sentences = one ? [all[Number(one.slice(6))]] : process.argv.includes('--quick') ? [0, 2, 5, 13, 19].filter(i => i < all.length).map(i => all[i]) : all;
if (sentences.some(sentence => typeof sentence !== 'string')) throw new Error('Invalid sentence index');
const thinking = process.argv.includes('--thinking');
const cpu = process.argv.includes('--cpu');
const plain = process.argv.includes('--plain');
const report = { date: new Date().toISOString(), model, suite, thinking, cpu, plain, instruction: patternInstruction, results: [] };
const output = new URL(`../.cache/ollama-evaluations/${Date.now()}-${model.replace(/[^a-z0-9]/gi, '-')}-${suite}${thinking ? '-thinking' : ''}${cpu ? '-cpu' : ''}${plain ? '-plain' : ''}.json`, import.meta.url);
await mkdir(new URL('../.cache/ollama-evaluations/', import.meta.url), { recursive: true });
for (const sentence of sentences) {
  const start = performance.now();
  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(cpu ? 180000 : 90000),
      body: JSON.stringify({ model, stream: false, think: thinking, keep_alive: '5m',
        messages: [{ role: 'system', content: patternInstruction }, { role: 'user', content: sentence }],
        ...(plain ? {} : { format: { type: 'object', properties: { pattern: { type: 'string' }, meaning: { type: 'string' } }, required: ['pattern', 'meaning'], additionalProperties: false } }),
        options: { temperature: thinking ? 0.6 : 0, num_ctx: 4096, num_predict: thinking ? 2048 : 300, ...(cpu ? { num_gpu: 0 } : {}) },
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const reply = await response.json();
    const raw = reply.message?.content;
    let parsed; try { parsed = parsePattern(raw || ''); } catch (error) { parsed = { error: String(error) }; }
    report.results.push({ sentence, raw, parsed, finish: reply.done_reason, ms: Math.round(performance.now() - start), tokens: reply.eval_count });
  } catch (error) { report.results.push({ sentence, error: String(error), ms: Math.round(performance.now() - start) }); }
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.results.at(-1)));
  if (report.results.at(-1).error) { process.exitCode = 1; break; }
}
console.log(output.pathname);

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { patternInstruction, parsePattern } from '../src/sentence-pattern.ts';

// Loopback-only adapter. It exposes one bounded task, not Ollama's general API.
export function createPatternServer({ model = 'qwen3.5:9b', cpu = false, upstream = 'http://127.0.0.1:11434', request = fetch } = {}) {
  const origins = new Set(['https://linkdiscovery.github.io', 'http://127.0.0.1:4173', 'http://localhost:4173']);
  let active;
  const server = createServer(async (req, res) => {
    const send = (status, value) => {
      if (!res.destroyed && !res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const port = server.address()?.port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) { send(403, { error: '허용되지 않은 주소입니다.' }); return; }
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { send(403, { error: '허용되지 않은 사이트입니다.' }); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    const route = req.url?.split('?')[0];
    if (!['/health', '/analyze'].includes(route)) { send(404, { error: '없는 기능입니다.' }); return; }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Leaf-Client');
      if (origin) res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204); res.end(); return;
    }
    if (req.method === 'GET' && route === '/health') {
      try {
        const response = await request(`${upstream}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Unavailable');
        const installed = (await response.json()).models?.some(item => item.name === model);
        send(installed ? 200 : 503, installed ? { service: 'leaf-sentence-pattern', model, cpu } : { error: `모델이 없어요. 터미널에서 ollama pull ${model}을 실행해 주세요.` });
      } catch { send(503, { error: 'Ollama를 실행한 뒤 다시 연결해 주세요.' }); }
      return;
    }
    if (req.method !== 'POST' || route !== '/analyze') { send(405, { error: '지원하지 않는 요청입니다.' }); return; }
    if (req.headers['x-leaf-client'] !== 'sentence-pattern' || req.headers['content-type']?.split(';')[0] !== 'application/json') { send(415, { error: '올바른 앱 요청이 아닙니다.' }); return; }
    if (active) { send(429, { error: '다른 문장을 분석 중이에요. 잠시 후 다시 시도해 주세요.' }); return; }
    let sentence;
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > 8192) { send(413, { error: '문장이 너무 길어요.' }); req.resume(); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      sentence = body.sentence;
      if (typeof sentence !== 'string' || !/[a-z]/i.test(sentence) || sentence.length > 1200 || Object.keys(body).some(key => key !== 'sentence')) throw new Error('Invalid sentence');
    } catch { send(400, { error: '1,200자 이내의 영어 문장만 입력해 주세요.' }); return; }
    if (active) { send(429, { error: '다른 문장을 분석 중이에요.' }); return; }
    const controller = new AbortController(); active = controller;
    const timer = setTimeout(() => controller.abort(), 180000);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const response = await request(`${upstream}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ model, stream: false, think: false, keep_alive: '5m',
          messages: [{ role: 'system', content: patternInstruction }, { role: 'user', content: sentence.trim() }],
          options: { temperature: 0, num_ctx: 4096, num_predict: 300, ...(cpu ? { num_gpu: 0 } : {}) },
        }),
      });
      if (!response.ok) throw new Error('Ollama request failed');
      const reply = await response.json();
      if (reply.done_reason === 'length') { send(502, { error: '분석이 길어져 중단했어요. 문장을 짧게 나누어 주세요.' }); return; }
      send(200, { ...parsePattern(reply.message?.content || ''), model });
    } catch {
      send(controller.signal.aborted ? 504 : 502, { error: controller.signal.aborted ? '분석 시간이 초과됐어요. 다시 시도해 주세요.' : '모델이 올바른 분석을 반환하지 못했어요. Ollama 상태를 확인하거나 직접 입력해 주세요.' });
    } finally { clearTimeout(timer); if (active === controller) active = undefined; }
  });
  server.on('close', () => active?.abort());
  server.requestTimeout = 30000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cpu = process.argv.includes('--cpu');
  const model = process.env.LEAF_OLLAMA_MODEL || 'qwen3.5:9b';
  const server = createPatternServer({ model, cpu });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Port 4175 is already in use.' : error.message); process.exitCode = 1; });
  server.listen(4175, '127.0.0.1', () => console.log(`Leaf sentence analysis: http://127.0.0.1:4175 · ${model} · ${cpu ? 'CPU' : 'automatic'}\nKeep this window open while using analysis. Ctrl+C to stop.`));
}

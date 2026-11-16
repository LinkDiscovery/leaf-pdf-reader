import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPatternServer } from './ollama-bridge.mjs';

const headers = { Origin: 'https://linkdiscovery.github.io', 'Content-Type': 'application/json', 'X-Leaf-Client': 'sentence-pattern' };
async function fixture(request) {
  const server = createPatternServer({ cpu: true, request });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

test('bridge allows the app origin and blocks other sites and unrelated APIs', async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return Response.json({ models: [{ name: 'qwen3.5:9b' }] }); });
  try {
    const health = await fetch(f.base + '/health', { headers });
    assert.equal(health.status, 200); assert.equal((await health.json()).cpu, true);
    assert.equal(health.headers.get('access-control-allow-origin'), headers.Origin);
    const denied = await fetch(f.base + '/health', { headers: { Origin: 'https://unrelated.example' } });
    assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(f.base + '/api/pull', { headers })).status, 404);
    const preflight = await fetch(f.base + '/analyze', { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('only a bounded sentence reaches the fixed local model, and malformed replies fail', async () => {
  let calls = 0, invalid = false;
  const f = await fixture(async (url, options) => {
    calls++; assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen3.5:9b'); assert.equal(body.options.num_gpu, 0);
    assert.equal(body.messages.at(-1).content, 'The result depends on context.');
    return Response.json({ done_reason: 'stop', message: { content: invalid ? '{"pattern":"x","meaning":""}' : '{"pattern":"depend on + noun","meaning":"~에 달려 있다."}' } });
  });
  const post = body => fetch(f.base + '/analyze', { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ sentence: 'x'.repeat(1201) })).status, 400);
    assert.equal((await post({ sentence: 'Hello', model: 'other' })).status, 400);
    assert.equal((await post({ sentence: 'x'.repeat(9000) })).status, 413);
    assert.equal((await fetch(f.base + '/analyze', { method: 'POST', body: 'sentence=Hello' })).status, 415);
    assert.equal(calls, 0);
    const response = await post({ sentence: 'The result depends on context.' });
    assert.equal(response.status, 200); assert.equal((await response.json()).pattern, 'depend on + 명사');
    invalid = true; assert.equal((await post({ sentence: 'The result depends on context.' })).status, 502);
  } finally { await f.close(); }
});

test('cancellation aborts upstream work and releases the single-request limit', async () => {
  let started, aborted;
  const ready = new Promise(resolve => { started = resolve; });
  const stopped = new Promise(resolve => { aborted = resolve; });
  let hold = true;
  const f = await fixture(async (url, options) => {
    if (!hold) return Response.json({ done_reason: 'stop', message: { content: '{"pattern":"be + adjective","meaning":"~하다."}' } });
    started();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted(); reject(new Error('Aborted')); }, { once: true }));
  });
  try {
    const controller = new AbortController();
    const body = JSON.stringify({ sentence: 'A sentence.' });
    const pending = fetch(f.base + '/analyze', { method: 'POST', headers, body, signal: controller.signal }).catch(() => undefined);
    await ready;
    assert.equal((await fetch(f.base + '/analyze', { method: 'POST', headers, body })).status, 429);
    controller.abort(); await stopped; await pending; hold = false;
    assert.equal((await fetch(f.base + '/analyze', { method: 'POST', headers, body })).status, 200);
  } finally { await f.close(); }
});

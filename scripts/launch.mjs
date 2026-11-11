import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const url = 'http://127.0.0.1:4173';
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.mjs':'application/javascript', '.json':'application/json; charset=utf-8', '.css':'text/css', '.wasm':'application/wasm', '.pdf':'application/pdf', '.zip':'application/zip', '.png':'image/png', '.svg':'image/svg+xml' };
const open = () => {
  if (process.env.LEAF_NO_OPEN) return;
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached:true, stdio:'ignore', windowsHide:true });
  child.on('error', () => console.log('Open ' + url + ' in your browser.')); child.unref();
};
try {
  const response = await fetch(url + '/leaf-health', { signal:AbortSignal.timeout(1200) });
  if (response.ok && await response.text() === 'leaf-pdf-reader') { open(); process.exit(0); }
} catch {}
const server = createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-cache');
  if (req.url === '/leaf-health') { res.writeHead(200, {'Content-Type':'text/plain'}); res.end('leaf-pdf-reader'); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, url).pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error('Not found');
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Port 4173 is in use by another app. Close that app and retry.' : error);
  process.exitCode = 1;
});
server.listen(4173, '127.0.0.1', () => { console.log('Leaf PDF Reader: ' + url); console.log('Keep this window open while reading. Ctrl+C to stop.'); open(); });

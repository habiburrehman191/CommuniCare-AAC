import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSuggestionHandler } from './suggestions';
import { createTranscribeHandler } from './transcribe';
import { createTtsHandler } from './tts';
const port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? '127.0.0.1';
const origin = process.env.APP_ORIGIN ?? 'http://localhost:' + port;
const handler = createSuggestionHandler({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL, origin });
const transcribeHandler = createTranscribeHandler({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_TRANSCRIBE_MODEL, origin });
const ttsHandler = createTtsHandler({ azureKey: process.env.AZURE_SPEECH_KEY, azureRegion: process.env.AZURE_SPEECH_REGION, azureVoice: process.env.AZURE_SPEECH_VOICE, origin });
const root = path.resolve('dist');
const routes = new Set([
    '/',
    '/board',
    '/settings',
    '/profiles',
    '/emergency',
    '/dev/sign-collection',
    '/dev/v3-test'
]);
createServer({ requestTimeout: 15000, headersTimeout: 15000, maxHeaderSize: 8192 }, async (req, res) => {
    try {
        const url = new URL(req.url ?? '/', origin);
        if (url.pathname === '/api/suggestions') {
            const buffers: Uint8Array[] = []; let size = 0;
            for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413, { 'Cache-Control': 'no-store' }); res.end(); return; } buffers.push(chunk); }
            const response = await handler(new Request(origin + '/api/suggestions', { method: req.method, headers: { origin: req.headers.origin ?? '', 'content-type': req.headers['content-type'] ?? '' }, ...(['GET', 'HEAD'].includes(req.method ?? 'GET') ? {} : { body: Buffer.concat(buffers).toString('utf8') }) }), req.socket.remoteAddress);
            res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
        }
        if (url.pathname === '/api/transcribe') {
            const buffers: Uint8Array[] = []; let size = 0;
            for await (const chunk of req) { size += chunk.length; if (size > 2097152) { res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'Payload exceeds 2 MB limit' })); return; } buffers.push(chunk); }
            const response = await transcribeHandler(new Request(origin + req.url, { method: req.method, headers: { origin: req.headers.origin ?? '', 'content-type': req.headers['content-type'] ?? '' }, ...(['GET', 'HEAD'].includes(req.method ?? 'GET') ? {} : { body: Buffer.concat(buffers) }) }), req.socket.remoteAddress);
            res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
        }
        if (url.pathname === '/api/tts') {
            const buffers: Uint8Array[] = []; let size = 0;
            for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'Payload exceeds limit' })); return; } buffers.push(chunk); }
            const response = await ttsHandler(new Request(origin + req.url, { method: req.method, headers: { origin: req.headers.origin ?? '', 'content-type': req.headers['content-type'] ?? '' }, ...(['GET', 'HEAD'].includes(req.method ?? 'GET') ? {} : { body: Buffer.concat(buffers) }) }), req.socket.remoteAddress);
            res.writeHead(response.status, Object.fromEntries(response.headers));
            const bodyBuf = Buffer.from(await response.arrayBuffer());
            res.end(bodyBuf); return;
        }
        if (!['GET', 'HEAD'].includes(req.method ?? 'GET') || url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
        const relative = routes.has(url.pathname) ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
        const content = await readFile(file), types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); }
}).listen(port, host, () => console.log('CommuniCare server ready on port ' + port));


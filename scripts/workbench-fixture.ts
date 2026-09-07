// Local-only manual QA fixture. Run: bun scripts/workbench-fixture.ts
// Never sends traffic outside loopback. Request bodies are limited to 1 MiB.
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 43111,
  maxRequestBodySize: 1024 * 1024,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === '/download.bin' || url.pathname === '/no-range.bin') {
      const total = Math.min(128, Math.max(1, Number(url.searchParams.get('mib')) || 32)) * 1024 * 1024;
      const supportsRange = url.pathname === '/download.bin';
      const match = supportsRange ? /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '') : null;
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
      if (start > end || start >= total) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
      const headers = new Headers({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start + 1), ETag: '"protopeek-P-v1"' });
      if (supportsRange) headers.set('Accept-Ranges', 'bytes');
      if (match) headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
      let position = start;
      let cancelled = false;
      const stream = new ReadableStream({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (cancelled) return;
          const length = Math.min(64 * 1024, end - position + 1);
          controller.enqueue(new Uint8Array(length).fill(80));
          position += length;
          if (position > end) controller.close();
        },
        cancel() { cancelled = true; },
      });
      return new Response(request.method === 'HEAD' ? null : stream, { status: match ? 206 : 200, headers });
    }
    if (url.pathname === '/events') {
      let timer: ReturnType<typeof setInterval>;
      let index = 0;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(': connected\n\n'));
          timer = setInterval(() => {
            controller.enqueue(new TextEncoder().encode(`id: ${++index}\nevent: tick\ndata: {"count":${index}}\n\n`));
            if (index === 5) { clearInterval(timer); controller.close(); }
          }, 500);
        },
        cancel() { clearInterval(timer); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/ws') {
      if (server.upgrade(request)) return;
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    if (url.pathname === '/slow') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(60_000, Math.max(100, Number(url.searchParams.get('ms')) || 10_000)));
        request.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    if (url.pathname === '/redirect') return Response.redirect(new URL('/echo?redirected=1', url), 302);
    if (url.pathname === '/openapi.json') return Response.json({
      openapi: '3.0.3', info: { title: 'ProtoPeek local QA', version: '1.0.0' },
      servers: [{ url: 'http://127.0.0.1:43111' }],
      paths: {
        '/echo': { get: { summary: 'Echo a request', operationId: 'echo', responses: { 200: { description: 'Echo' } } },
          post: { summary: 'Echo a JSON body', operationId: 'postEcho', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string', example: 'Hello ProtoPeek' } } } } } }, responses: { 200: { description: 'Echo' } } } },
        '/status/500': { get: { summary: 'Server error', responses: { 500: { description: 'Intentional failure' } } } },
      },
    });
    const status = url.pathname.startsWith('/status/') ? Number(url.pathname.split('/')[2]) : 200;
    if (!Number.isInteger(status) || status < 200 || status > 599) return new Response('Invalid status', { status: 400 });
    if (status === 204 || status === 304 || request.method === 'HEAD') return new Response(null, { status });
    return Response.json({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(request.headers), body: await request.text() }, { status, headers: { 'X-ProtoPeek-Fixture': 'local-only' } });
  },
  websocket: { message(ws, message) { ws.send(message); } },
});
console.log(`Local QA fixture: ${server.url} — /echo /status/404 /status/500 /slow /redirect /openapi.json /ws`);

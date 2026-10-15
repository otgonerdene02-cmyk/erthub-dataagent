#!/usr/bin/env node
/* Хөгжүүлэлтийн энгийн статик сервер (тест/preview-д).
   node scripts/serve.js [port] [--mock-publish]
   --mock-publish: /api/site-content-ийг санах ойд хуурамчаар хариулна
   (scripts/mock-publish.js). Хуудсыг ?mockpub=1-тэй нээнэ.
   ?fx=1: амьд feed-ийн оронд tests/lib/feed-fixtures.js тарина (харагдацыг
   өгөгдөлтэй төлөвөөр шалгах; backend хүрэхгүй үед). */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const PORT = parseInt(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || '8080', 10);
const MOCK = args.includes('--mock-publish') ? require('./mock-publish').createMockPublish() : null;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
http.createServer((req,res)=>{
  if (MOCK && MOCK.handle(req, res)) return;
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('403'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    if (/[?&]fx=1/.test(req.url) && /index\.html$/.test(p)) {
      const h = data.toString('utf8'), i = h.indexOf('<head>');
      if (i >= 0) data = Buffer.from(h.slice(0, i + 6) + '<script src="/tests/lib/feed-fixtures.js"></script>' + h.slice(i + 6), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control':'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('serve: http://localhost:' + PORT + '/' +
  (MOCK ? '  (mock нийтлэл: хуудсыг ?mockpub=1-тэй нээнэ)' : '')));

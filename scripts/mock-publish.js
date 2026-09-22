/*
 * ErtHub — /api/site-content-ийн ЛОКАЛ хуурамч backend (тест/QA агентад)
 * =====================================================================
 * АСУУДАЛ: "Сайтад нийтлэх" товч (1) Google нэвтрэлт, (2) portal_admins эрх,
 * (3) АМЬД portal.mrt.gov.mn руу бичилт шаарддаг. Тестийн агент нууц үг
 * оруулж чадахгүй, амьд сайт руу бичих нь буцаагдашгүй — тиймээс урсгал
 * "товч идэвхгүй" дээр зогсож, бүтэн сценари дуусдаггүй байв.
 *
 * ШИЙДЭЛ: etransport-backend-ийн гэрээг (src/routes/siteContent.js) санах
 * ойд давтана. `node scripts/serve.js 8090 --mock-publish` + хуудсыг
 * `?mockpub=1`-тэй нээвэл js/publish-mock.js хуурамч админ хэрэглэгч үүсгэж,
 * нийтлэл ЭНЭ сервер рүү явна — амьд сайтад ОГТ хүрэхгүй.
 *
 * Гэрээ (жинхэнэтэй ижил):
 *   GET  /api/site-content      → 404 (нийтлэлгүй) | {version,content,registry,meta}
 *   GET  /api/site-content/me   → {canPublish} (Bearer токен шаардана)
 *   PUT  /api/site-content      → {version,at} | 401 | 403 | 409 (baseVersion зөрвөл)
 * Нэмэлт (зөвхөн mock):
 *   DELETE /api/site-content    → санах ойг цэвэрлэнэ (сценари бүрийн өмнө)
 */
'use strict';

const TOKEN = 'MOCK-ADMIN-TOKEN';        /* js/publish-mock.js-тэй ижил */
const TOKEN_NOPERM = 'MOCK-VIEWER-TOKEN'; /* эрхгүй хэрэглэгчийн сценари */

function createMockPublish() {
  let versions = [];

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  function err(res, code, message) { send(res, code, { error: { message } }); }
  function tokenOf(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : '';
  }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

  /* true буцаавал хүсэлтийг энэ модуль хариулсан */
  function handle(req, res) {
    const p = req.url.split('?')[0];
    if (p !== '/api/site-content' && p !== '/api/site-content/me') return false;
    const last = versions[versions.length - 1];

    if (p === '/api/site-content/me') {
      const t = tokenOf(req);
      if (!t) { err(res, 401, 'Нэвтрээгүй байна'); return true; }
      send(res, 200, { canPublish: t === TOKEN });
      return true;
    }
    if (req.method === 'GET') {
      if (!last) { err(res, 404, 'Нийтлэл алга'); return true; }
      send(res, 200, last);
      return true;
    }
    if (req.method === 'DELETE') { versions = []; send(res, 200, { ok: true }); return true; }
    if (req.method !== 'PUT') { err(res, 405, 'Method not allowed'); return true; }

    const t = tokenOf(req);
    if (!t) { err(res, 401, 'Нэвтрээгүй байна'); return true; }
    if (t !== TOKEN) { err(res, 403, 'Нийтлэх эрхгүй'); return true; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let b;
      try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return err(res, 400, 'JSON буруу'); }
      if (!isObj(b) || (b.content != null && !isObj(b.content)) || (b.registry != null && !isObj(b.registry)))
        return err(res, 400, 'content/registry объект байх ёстой');
      const cur = last ? last.version : null;
      if (b.baseVersion !== undefined && b.baseVersion !== cur)
        return err(res, 409, 'Өөр хүн түрүүлж нийтэлсэн байна (хувилбар ' + cur + ') — хуудсаа сэргээнэ үү');
      const at = new Date().toISOString();
      const row = {
        version: (cur || 0) + 1,
        content: b.content || (last && last.content) || null,
        registry: b.registry || (last && last.registry) || null,
        meta: { at, by: 'mock-admin@localhost' }
      };
      versions.push(row);
      send(res, 200, { version: row.version, at });
    });
    return true;
  }

  return { handle, reset() { versions = []; }, get versions() { return versions; } };
}

module.exports = { createMockPublish, TOKEN, TOKEN_NOPERM };

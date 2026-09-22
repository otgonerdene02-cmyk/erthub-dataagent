/*
 * ErtHub — Контент нийтлэх давхарга (etransport-backend · Postgres)
 * ==================================================================
 * АСУУДАЛ: админ самбар файл руу бичдэггүй тул засвар нь зөвхөн хөтчийн
 * санах ойд үлдэж, `Экспортлох` → гар хуулалт → commit → push хийж байж
 * сайтад гардаг байв. Энэ модуль тэр гинжийг таслана.
 *
 * ЗАРЧИМ — content.json нь ХЭВЭЭР үндсэн эх сурвалж:
 *   1. Сайт эхлээд `content.json` / `metric_registry.json` ФАЙЛЫГ уншина
 *      (хурдан, сүлжээнээс хамааралгүй, git-ээр хянагддаг).
 *      Backend унтарсан, сүлжээ тасарсан бол сайт ЯГ ӨМНӨХ ШИГЭЭ ажиллана.
 *   2. Дараа нь `GET /api/site-content`-ийг уншиж, байвал файлын дээр
 *      ДАВХАРЛАНА (overlay). Админ `Нийтлэх` дарангуут бүх зочин шинэ
 *      текстийг харна — commit хүлээхгүй.
 *   3. Экспорт → commit нь ХЭВЭЭР хэрэгтэй: тэр нь нийтлэлийг git-ийн
 *      бүртгэлтэй болгож, overlay-г үндсэн файлд шингээнэ.
 *
 * ХАДГАЛАЛТ: backend нь Postgres-ийн `public.site_content_versions`-д
 * нийтлэл БҮРИЙГ шинэ мөр болгож бичнэ (түүхтэй, буцаах боломжтой).
 * `json` төрөл (jsonb биш) тул түлхүүрийн дараалал ЯГ хадгалагдана.
 *
 * ЭРХ: нэвтрэлт Firebase Auth (Google) хэвээр — backend ID token-ийг
 * шалгаж, `public.portal_admins`-д бүртгэлтэй uid/и-мэйлд л бичүүлнэ.
 *
 * ДАВХАР НИЙТЛЭЛЭЭС ХАМГААЛАХ: ачаалсан хувилбарын дугаарыг (`version`)
 * санаж, нийтлэхдээ `baseVersion` болгон илгээнэ. Хооронд нь өөр хүн
 * нийтэлсэн бол backend 409 буцааж, амьд өөрчлөлтийг чимээгүй дарахгүй.
 */
(function () {
  'use strict';

  var BASE = (typeof ETRANSPORT_BACKEND_BASE !== 'undefined' && ETRANSPORT_BACKEND_BASE) || '';
  var URL_ = BASE ? BASE + '/api/site-content' : null;
  /* Сайт эхний зурагтаа хүлээхгүй — overlay хожуу ирвэл дахин зурна.
     Гэхдээ хязгааргүй хүлээхгүй: сүлжээ муу үед тестийн probe (headless)
     хэдэн арван секунд өлгөгдөж болзошгүй. */
  var TIMEOUT_MS = 6000;

  /* undefined = хараахан уншаагүй / уншилт амжилтгүй (шалгалтгүй нийтэлнэ)
     null      = backend "нийтлэл алга" (404) гэж хариулсан
     тоо       = ачаалсан нийтлэлийн дугаар */
  var baseVersion;

  function fetchJson(url, opts, ms) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var o = opts || {};
    if (ctl) o.signal = ctl.signal;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || TIMEOUT_MS);
    return fetch(url, o).then(function (r) {
      clearTimeout(timer);
      return r.json().catch(function () { return null; })
        .then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    }, function (e) { clearTimeout(timer); throw e; });
  }

  function errMsg(r) {
    return (r.body && r.body.error && r.body.error.message) || ('HTTP ' + r.status);
  }

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

  /* ---- Уншилт: нээлттэй, токен шаардахгүй ---- */
  /* Буцаах утга: {content, registry, meta:{at,by,version}} эсвэл null.
     Хэлбэр буруу талбарыг алгасна (эвдэрсэн нийтлэл сайтыг унагаах ёсгүй). */
  function load() {
    if (!URL_) return Promise.resolve(null);
    return fetchJson(URL_, { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) { baseVersion = null; return null; }   /* хараахан нийтлээгүй */
        if (!r.ok || !isObj(r.body)) return null;
        var b = r.body;
        if (typeof b.version === 'number') baseVersion = b.version;
        var out = {
          content: isObj(b.content) ? b.content : null,
          registry: isObj(b.registry) ? b.registry : null,
          meta: { at: (b.meta && b.meta.at) || null, by: (b.meta && b.meta.by) || null,
                  version: typeof b.version === 'number' ? b.version : null }
        };
        return (out.content || out.registry) ? out : null;
      })
      .catch(function (e) {
        console.info('[ErtHub] нийтлэгдсэн контент уншигдсангүй, файлын хувилбар үлдэнэ:', e.message);
        return null;
      });
  }

  function withToken(fn) {
    var u = window.auth && window.auth.currentUser;
    if (!u) return Promise.reject(new Error('Нэвтрээгүй байна'));
    return u.getIdToken().then(fn);
  }

  /* ---- Бичих: нэвтэрсэн БА portal_admins-д бүртгэлтэй ---- */
  /* content / registry — объект. Аль нэгийг нь null өгвөл backend өмнөх
     нийтлэлийнхийг хуулна. */
  function publish(content, registry) {
    if (!URL_) return Promise.reject(new Error('Backend тохируулаагүй байна (js/backend-config.js)'));
    var body = { content: content || null, registry: registry || null };
    if (baseVersion !== undefined) body.baseVersion = baseVersion;
    return withToken(function (tok) {
      return fetchJson(URL_, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify(body)
      }, 20000);
    }).then(function (r) {
      if (r.ok) {
        baseVersion = r.body.version;
        return { at: r.body.at || new Date().toISOString(), version: r.body.version };
      }
      throw new Error(errMsg(r));
    });
  }

  /* Энэ хэрэглэгч нийтлэх эрхтэй эсэх — backend portal_admins-аас шийднэ. */
  function canPublish() {
    if (!URL_) return Promise.resolve(false);
    return withToken(function (tok) {
      return fetchJson(URL_ + '/me', {
        cache: 'no-store', headers: { 'Authorization': 'Bearer ' + tok }
      });
    }).then(function (r) { return !!(r.ok && r.body && r.body.canPublish); })
      .catch(function () { return false; });
  }

  window.EHPublish = { load: load, publish: publish, canPublish: canPublish, enabled: !!URL_ };
})();

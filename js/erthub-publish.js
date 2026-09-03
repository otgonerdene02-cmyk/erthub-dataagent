/*
 * ErtHub — Контент нийтлэх давхарга (Firestore REST)
 * ===================================================
 * АСУУДАЛ: админ самбар файл руу бичдэггүй тул засвар нь зөвхөн хөтчийн
 * санах ойд үлдэж, `Экспортлох` → гар хуулалт → commit → push хийж байж
 * сайтад гардаг байв. Энэ модуль тэр гинжийг таслана.
 *
 * ЗАРЧИМ — content.json нь ХЭВЭЭР үндсэн эх сурвалж:
 *   1. Сайт эхлээд `content.json` / `metric_registry.json` ФАЙЛЫГ уншина
 *      (хурдан, сүлжээнээс хамааралгүй, git-ээр хянагддаг).
 *      Firestore унтарсан, дүрэм хаасан, сүлжээ тасарсан бол сайт ЯГ
 *      ӨМНӨХ ШИГЭЭ ажиллана.
 *   2. Дараа нь Firestore дахь `site_content/current` баримтыг уншиж,
 *      байвал файлын дээр ДАВХАРЛАНА (overlay). Админ `Нийтлэх` дарангуут
 *      бүх зочин шинэ текстийг харна — commit хүлээхгүй.
 *   3. Экспорт → commit нь ХЭВЭЭР хэрэгтэй: тэр нь нийтлэлийг git-ийн
 *      бүртгэлтэй болгож, overlay-г үндсэн файлд шингээнэ.
 *
 * ХАДГАЛАХ ХЭЛБЭР: JSON-г МӨР (string) болгож хадгална. Firestore нь
 * массив доторх массивыг зөвшөөрдөггүй бөгөөд төрөл хөрвүүлэлт нь
 * `null` / хоосон мөрийг гажуудуулж болзошгүй — мөрөөр хадгалснаар
 * файлын агуулга ЯГ ТЭР ХЭВЭЭР эргэж ирнэ. content.json ~45KB,
 * Firestore-ийн нэг талбарын дээд хэмжээ 1 MiB тул багтана.
 *
 * ЭРХ: бичих эрхийг `firestore.rules` шийднэ — `admins/{uid}` баримт
 * үүссэн хэрэглэгч л бичнэ. Уншилт нээлттэй (сайтын зочин бүр уншина).
 */
(function () {
  'use strict';

  var CFG = (typeof FIREBASE_CONFIG !== 'undefined') ? FIREBASE_CONFIG : null;
  var PID = CFG && CFG.projectId;
  var KEY = CFG && CFG.apiKey;
  var BASE = PID
    ? 'https://firestore.googleapis.com/v1/projects/' + PID + '/databases/(default)/documents'
    : null;

  var DOC = '/site_content/current';
  /* Сайт эхний зурагтаа хүлээхгүй — overlay хожуу ирвэл дахин зурна.
     Гэхдээ хязгааргүй хүлээхгүй: сүлжээ муу үед тестийн probe (headless)
     хэдэн арван секунд өлгөгдөж болзошгүй. */
  var TIMEOUT_MS = 6000;

  function fetchJson(url, opts, ms) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var o = opts || {};
    if (ctl) o.signal = ctl.signal;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || TIMEOUT_MS);
    return fetch(url, o).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    }, function (e) { clearTimeout(timer); throw e; });
  }

  /* ---- Уншилт: нээлттэй, токен шаардахгүй ---- */
  /* Буцаах утга: {content, registry, meta} эсвэл null.
     content/registry нь задлагдсан объект; задрахгүй бол тэр талбарыг
     алгасна (эвдэрсэн нийтлэл сайтыг унагаах ёсгүй). */
  function load() {
    if (!BASE) return Promise.resolve(null);
    return fetchJson(BASE + DOC + '?key=' + KEY, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) return null;              /* 404 = хараахан нийтлээгүй */
        var f = (r.body && r.body.fields) || {};
        var out = { content: null, registry: null, meta: {
          at: str(f.updatedAt), by: str(f.byEmail), uid: str(f.byUid) } };
        out.content = parse(str(f.content));
        out.registry = parse(str(f.registry));
        return (out.content || out.registry) ? out : null;
      })
      .catch(function (e) {
        console.info('[ErtHub] нийтлэгдсэн контент уншигдсангүй, файлын хувилбар үлдэнэ:', e.message);
        return null;
      });
  }

  function str(x) { return (x && typeof x.stringValue === 'string') ? x.stringValue : null; }
  function parse(s) {
    if (!s) return null;
    try { return JSON.parse(s); }
    catch (e) { console.warn('[ErtHub] нийтлэгдсэн JSON эвдэрсэн байна:', e.message); return null; }
  }

  /* ---- Бичих: нэвтэрсэн БА admins/{uid} байх шаардлагатай ---- */
  /* content / registry — объект. Аль нэгийг нь null өгвөл тэр талбарыг
     хөндөхгүй (patch-ийн updateMask ашиглана). */
  function publish(content, registry) {
    if (!BASE) return Promise.reject(new Error('Firebase тохируулаагүй байна'));
    var u = window.auth && window.auth.currentUser;
    if (!u) return Promise.reject(new Error('Нэвтрээгүй байна'));
    return u.getIdToken().then(function (tok) {
      var fields = {}, mask = [];
      if (content) { fields.content = { stringValue: JSON.stringify(content) }; mask.push('content'); }
      if (registry) { fields.registry = { stringValue: JSON.stringify(registry) }; mask.push('registry'); }
      fields.updatedAt = { stringValue: new Date().toISOString() };
      fields.byUid = { stringValue: u.uid };
      fields.byEmail = { stringValue: u.email || '' };
      mask.push('updatedAt', 'byUid', 'byEmail');
      var qs = '?key=' + KEY + mask.map(function (m) { return '&updateMask.fieldPaths=' + m }).join('');
      return fetchJson(BASE + DOC + qs, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ fields: fields })
      }, 20000);
    }).then(function (r) {
      if (r.ok) return { at: new Date().toISOString() };
      var msg = (r.body && r.body.error && r.body.error.message) || ('HTTP ' + r.status);
      if (r.status === 403 || r.status === 401) {
        throw new Error('Бичих эрхгүй — Firestore дээр admins/<uid> баримт үүсгэсэн эсэхээ шалгана уу (' + msg + ')');
      }
      throw new Error(msg);
    });
  }

  /* Энэ хэрэглэгч нийтлэх эрхтэй эсэх — admins/{uid} баримтыг уншиж
     шалгана. Дүрэм нь зөвхөн ЭЗЭНД нь уншуулдаг тул хариу нь үнэн зөв. */
  function canPublish() {
    if (!BASE) return Promise.resolve(false);
    var u = window.auth && window.auth.currentUser;
    if (!u) return Promise.resolve(false);
    return u.getIdToken().then(function (tok) {
      return fetchJson(BASE + '/admins/' + u.uid + '?key=' + KEY, {
        cache: 'no-store', headers: { 'Authorization': 'Bearer ' + tok }
      });
    }).then(function (r) { return !!r.ok })
      .catch(function () { return false });
  }

  window.EHPublish = { load: load, publish: publish, canPublish: canPublish, enabled: !!BASE };
})();

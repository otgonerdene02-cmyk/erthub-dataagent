/*
 * ErtHub — "Сайтад нийтлэх"-ийг ЛОКАЛ хуурамч backend-тэй ажиллуулах
 * ====================================================================
 * Зөвхөн localhost/127.0.0.1 дээр, хаягт `?mockpub=1` (эсвэл `=viewer`)
 * байвал идэвхжинэ. Бусад бүх үед (амьд сайт, GitHub Pages) ЮУ Ч ХИЙХГҮЙ.
 *
 *   ?mockpub=1       — хуурамч АДМИН (нийтлэх эрхтэй)
 *   ?mockpub=viewer  — нэвтэрсэн ч эрхгүй хэрэглэгч (403 сценари)
 *   ?mockpub=0       — унтраана
 * Сонголт sessionStorage-д хадгалагдана — админаас сайт руу шилжихэд ч
 * ижил mock backend-ээс уншина.
 *
 * Хийдэг зүйл:
 *   1. window.EH_PUBLISH_BASE = location.origin → erthub-publish.js
 *      нийтлэлээ scripts/serve.js --mock-publish руу явуулна.
 *   2. data-auth="1"-тэй ачаалбал (админ) window.auth-ыг хуурамчаар
 *      солино: «Нэвтрэх (Google)» popup-гүйгээр шууд нэвтэрнэ.
 * Жинхэнэ backend хуурамч токеныг хүлээж авахгүй тул энэ файл амьд
 * сайт руу бичих ЗАМ нээхгүй.
 *
 * Ачаалах дараалал: backend-config.js → ЭНЭ → erthub-publish.js.
 */
(function () {
  'use strict';
  var KEY = 'eh_mockpub';
  var host = location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return;

  var mode = null;
  try {
    var q = new URLSearchParams(location.search).get('mockpub');
    if (q === '0') sessionStorage.removeItem(KEY);
    else if (q) sessionStorage.setItem(KEY, q);
    mode = sessionStorage.getItem(KEY);
  } catch (e) {
    mode = new URLSearchParams(location.search).get('mockpub');
  }
  if (!mode || mode === '0') return;

  window.EH_PUBLISH_BASE = location.origin;
  console.info('[ErtHub] mock нийтлэл идэвхтэй (' + mode + ') → ' + location.origin + '/api/site-content');

  var me = document.currentScript;
  if (!me || me.getAttribute('data-auth') !== '1') return;

  var viewer = mode === 'viewer';
  var USER = {
    uid: viewer ? 'mock-viewer-uid' : 'mock-admin-uid',
    email: viewer ? 'mock-viewer@localhost' : 'mock-admin@localhost',
    getIdToken: function () {
      return Promise.resolve(viewer ? 'MOCK-VIEWER-TOKEN' : 'MOCK-ADMIN-TOKEN');
    }
  };
  var subs = [];
  var auth = {
    currentUser: null,
    onAuthStateChanged: function (cb) {
      subs.push(cb);
      setTimeout(function () { cb(auth.currentUser); }, 0);
      return function () { subs = subs.filter(function (f) { return f !== cb; }); };
    },
    signInWithPopup: function () {
      auth.currentUser = USER; fire();
      return Promise.resolve({ user: USER });
    },
    signOut: function () { auth.currentUser = null; fire(); return Promise.resolve(); }
  };
  function fire() { subs.forEach(function (f) { f(auth.currentUser); }); }
  window.auth = auth;
  window.googleProvider = window.googleProvider || { mock: true };
})();

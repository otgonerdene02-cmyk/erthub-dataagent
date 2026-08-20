/*
 * ErtHub — датасэтийн "Үзсэн" тоолуур
 * ====================================
 * Хэрэглэгч датасэт рүү орох бүрт тухайн датасэтийн үзэлтийг нэмэгдүүлж,
 * картан дээр харуулна.
 *
 * Хоёр давхарга:
 *   1. localStorage — үргэлж ажиллана, backend шаардахгүй. Гэхдээ энэ нь
 *      ЗӨВХӨН тухайн browser-ийн тоо. Firestore идэвхжээгүй үед энэ л
 *      ажиллана.
 *   2. Cloud Firestore (REST) — бүх хэрэглэгчийн ДУНДЫН жинхэнэ тоо.
 *      SDK ачаалахгүй, зөвхөн fetch ашиглана (SDK ~300KB нэмэх нь энэ
 *      жижиг боломжид хэтэрхий үнэтэй).
 *
 * Firestore-ыг идэвхжүүлмэгц код өөрчлөхгүйгээр автоматаар дундын тоо руу
 * шилжинэ. Идэвхжүүлэх алхмуудыг README-д бичсэн.
 *
 * Нэг session дотор нэг датасэтийг дахин дахин нээхэд тоо үрэхгүйн тулд
 * sessionStorage-оор давхардлыг шүүнэ.
 */
(function () {
  var CFG = (typeof FIREBASE_CONFIG !== 'undefined') ? FIREBASE_CONFIG : null;
  var PID = CFG && CFG.projectId;
  var KEY = CFG && CFG.apiKey;
  var BASE = PID
    ? 'https://firestore.googleapis.com/v1/projects/' + PID + '/databases/(default)/documents'
    : null;
  var COLL = 'datasetViews';

  var LS_KEY = 'eh-views';
  var remoteOk = !!BASE;      // эхний алдаа гартал найдвартай гэж үзнэ
  var remote = {};            // slug -> дундын тоо (мэдэгдсэн үед)
  var listeners = [];

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeLocal(map) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch (e) {}
  }
  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  // Firestore REST: update + updateTransforms хосыг нэг бичилтэд явуулна.
  // Хоосон updateMask нь байгаа талбаруудыг арчихгүй, харин updateTransforms
  // нь increment хийж, баримт байхгүй бол ШИНЭЭР үүсгэнэ. Хариу нь
  // нэмэгдсэний дараах утгыг буцаадаг тул нэг л дуудалтаар шинэ тоог авна.
  function remoteIncrement(slug) {
    if (!remoteOk) return Promise.resolve(null);
    var body = {
      writes: [{
        update: { name: BASE + '/' + COLL + '/' + encodeURIComponent(slug), fields: {} },
        updateMask: { fieldPaths: [] },
        updateTransforms: [{ fieldPath: 'count', increment: { integerValue: '1' } }]
      }]
    };
    return fetch(BASE + ':commit?key=' + KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('commit ' + r.status);
      return r.json();
    }).then(function (j) {
      var tr = j && j.writeResults && j.writeResults[0] && j.writeResults[0].transformResults;
      var v = tr && tr[0] && tr[0].integerValue;
      return v == null ? null : parseInt(v, 10);
    }).catch(function (e) {
      // Firestore идэвхжээгүй / дүрэм хаасан бол чимээгүй локал горимд үлдэнэ.
      remoteOk = false;
      console.info('[ErtHub] Үзэлтийн дундын тоолуур ажиллахгүй байна, локал тоо ашиглана:', e.message);
      return null;
    });
  }

  function remoteFetch(slug) {
    if (!remoteOk) return Promise.resolve(null);
    return fetch(BASE + '/' + COLL + '/' + encodeURIComponent(slug) + '?key=' + KEY)
      .then(function (r) {
        if (r.status === 404) return null;          // хараахан үзээгүй датасэт
        if (!r.ok) throw new Error('get ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var v = j && j.fields && j.fields.count && j.fields.count.integerValue;
        return v == null ? null : parseInt(v, 10);
      })
      .catch(function () { remoteOk = false; return null; });
  }

  window.datasetViews = {
    /* Датасэт нээгдэхэд дуудна. Нэг session-д нэг удаа л тоолно. */
    track: function (slug) {
      if (!slug) return;
      var once = 'eh-viewed:' + slug;
      var already = false;
      try { already = !!sessionStorage.getItem(once); } catch (e) {}
      if (!already) {
        try { sessionStorage.setItem(once, '1'); } catch (e) {}
        var map = readLocal();
        map[slug] = (map[slug] || 0) + 1;
        writeLocal(map);
        notify();
        remoteIncrement(slug).then(function (n) {
          if (n != null) { remote[slug] = n; notify(); }
        });
      } else if (remote[slug] == null) {
        remoteFetch(slug).then(function (n) {
          if (n != null) { remote[slug] = n; notify(); }
        });
      }
    },
    /* Хамгийн сайн мэдэгдэж буй тоо: дундын нь мэдэгдсэн бол тэр, үгүй бол локал. */
    get: function (slug) {
      if (remote[slug] != null) return remote[slug];
      var map = readLocal();
      return map[slug] || 0;
    },
    /* Дундын тоо эсэхийг UI-д мэдэгдэхэд ашиглана. */
    isShared: function (slug) { return remote[slug] != null; },
    subscribe: function (fn) { listeners.push(fn); }
  };
})();

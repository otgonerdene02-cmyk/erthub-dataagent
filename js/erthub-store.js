/*
 * ErtHub — Firestore дата давхарга (REST)
 * ========================================
 * Хэрэглэгчийн үүсгэсэн бүх датаг (профайл, үнэлгээ, сэтгэгдэл, дагалт)
 * Cloud Firestore-т хадгална.
 *
 * Яагаад SDK биш REST вэ?
 *   `js/dataset-views.js` аль хэдийн энэ замыг сонгосон — firestore-compat
 *   SDK нь ~300KB, харин бидний хэрэглэх үйлдлүүд нь энгийн CRUD. Auth SDK
 *   аль хэдийн ачаалагдсан тул ID token-оо түүнээс авч, `Authorization`
 *   толгойд явуулна. Ингэснээр Security Rules доторх `request.auth` бүрэн
 *   ажиллана.
 *
 * Firestore идэвхжээгүй, эсвэл дүрэм хаасан үед бүх функц алдаа шидэхгүй,
 * `null` буцаана — UI нь demo горимдоо үлдэнэ.
 *
 * Датаны бүтэц:
 *   users/{uid}                      профайл (зөвхөн эзэн нь уншина)
 *   items/{itemId}                   нэгтгэсэн тоонууд (бүгд уншина)
 *   items/{itemId}/ratings/{uid}     нэг хүн нэг үнэлгээ
 *   items/{itemId}/reviews/{autoId}  сэтгэгдэл
 *   items/{itemId}/follows/{uid}     дагалт
 *
 * itemId нь `dataset__<slug>`, `doc__<slug>` гэх мэт. `itemKey()`-г үзнэ үү.
 */
(function () {
  var CFG = (typeof FIREBASE_CONFIG !== 'undefined') ? FIREBASE_CONFIG : null;
  var PID = CFG && CFG.projectId;
  var KEY = CFG && CFG.apiKey;
  var BASE = PID
    ? 'https://firestore.googleapis.com/v1/projects/' + PID + '/databases/(default)/documents'
    : null;

  var enabled = !!BASE;   // эхний бүтэлгүйтэл хүртэл найдвартай гэж үзнэ

  function off(e) {
    // Firestore идэвхжээгүй — чимээгүй demo горимд буцна.
    enabled = false;
    console.info('[ErtHub] Firestore ажиллахгүй байна, локал горимд шилжлээ:', e && e.message);
    return null;
  }

  /* ---- Firestore REST-ийн төрөлтэй утгыг хөрвүүлэх ---- */

  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    if (typeof v === 'object') return { mapValue: { fields: encFields(v) } };
    return { stringValue: String(v) };
  }

  function encFields(obj) {
    var out = {};
    for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = enc(obj[k]); }
    return out;
  }

  function dec(v) {
    if (!v) return null;
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return v.doubleValue;
    if ('timestampValue' in v) return new Date(v.timestampValue);
    if ('stringValue' in v) return v.stringValue;
    if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(dec);
    if ('mapValue' in v) return decFields(v.mapValue && v.mapValue.fields);
    return null;
  }

  function decFields(fields) {
    var out = {};
    for (var k in fields) { if (Object.prototype.hasOwnProperty.call(fields, k)) out[k] = dec(fields[k]); }
    return out;
  }

  /* ---- Auth ---- */

  function uid() {
    var u = window.auth && window.auth.currentUser;
    return u ? u.uid : null;
  }

  // Нэвтэрсэн бол ID token-той, үгүй бол токенгүй хүсэлт (нээлттэй уншилтад).
  function token() {
    var u = window.auth && window.auth.currentUser;
    if (!u) return Promise.resolve(null);
    return u.getIdToken().catch(function () { return null; });
  }

  function req(method, path, body, params) {
    if (!enabled) return Promise.resolve(null);
    return token().then(function (t) {
      var url = BASE + path + '?key=' + KEY + (params ? '&' + params : '');
      var headers = { 'Content-Type': 'application/json' };
      if (t) headers['Authorization'] = 'Bearer ' + t;
      return fetch(url, {
        method: method, headers: headers,
        body: body ? JSON.stringify(body) : undefined
      });
    }).then(function (r) {
      if (r.status === 404) {
        // 404 нь хоёр өөр утгатай:
        //   (а) баримт байхгүй — хэвийн, хоосон утга буцаана;
        //   (б) Firestore өгөгдлийн сан төсөлд огт үүсээгүй — энэ үед бүх
        //       дуудлага дэмий тул бүхэлд нь унтраах ёстой. Эс тэгвээс UI
        //       нь "бодит дата ирлээ" гэж андуурч, хоосон жагсаалт харуулна.
        return r.text().then(function (t) {
          if (t.indexOf('does not exist for project') >= 0) {
            return off(new Error('Firestore өгөгдлийн сан үүсээгүй байна'));
          }
          return null;
        });
      }
      if (r.status === 403 || r.status === 401) {
        // Дүрэм татгалзлаа. Тохиргооны алдаа байж болох тул бүхэлд нь
        // унтраахгүй — зөвхөн энэ дуудлагыг амжилтгүй гэж үзнэ.
        console.info('[ErtHub] Firestore дүрэм татгалзав:', method, path);
        return null;
      }
      if (!r.ok) throw new Error(method + ' ' + path + ' -> ' + r.status);
      return r.json();
    }).catch(off);
  }

  /* ---- Объектын түлхүүр ---- */

  // Гарчиг өөрчлөгдөхөд дата тасрахгүйн тулд аль болох тогтвортой slug өг.
  function itemKey(type, slug) {
    return type + '__' + String(slug).toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  }

  /* ---- Профайл ---- */

  function saveProfile(data) {
    var u = uid();
    if (!u) return Promise.resolve(null);
    var payload = Object.assign({}, data, { updatedAt: new Date() });
    return req('PATCH', '/users/' + u, { fields: encFields(payload) });
  }

  function loadProfile() {
    var u = uid();
    if (!u) return Promise.resolve(null);
    return req('GET', '/users/' + u).then(function (j) {
      return j && j.fields ? decFields(j.fields) : null;
    });
  }

  /* ---- Нэгтгэсэн тоолуур ---- */

  // Нэг бичилтээр хэд хэдэн талбарыг increment хийнэ. Баримт байхгүй бол
  // updateTransforms нь шинээр үүсгэнэ (dataset-views.js-тэй ижил заль).
  function bump(itemId, deltas) {
    if (!enabled) return Promise.resolve(null);
    var transforms = [];
    for (var f in deltas) {
      if (!deltas[f]) continue;
      transforms.push({ fieldPath: f, increment: { integerValue: String(deltas[f]) } });
    }
    if (!transforms.length) return Promise.resolve(null);
    var body = {
      writes: [{
        update: { name: BASE + '/items/' + itemId, fields: {} },
        updateMask: { fieldPaths: [] },
        updateTransforms: transforms
      }]
    };
    return token().then(function (t) {
      var headers = { 'Content-Type': 'application/json' };
      if (t) headers['Authorization'] = 'Bearer ' + t;
      return fetch(BASE + ':commit?key=' + KEY, {
        method: 'POST', headers: headers, body: JSON.stringify(body)
      });
    }).then(function (r) {
      if (!r.ok) throw new Error('commit ' + r.status);
      return r.json();
    }).catch(function (e) {
      console.info('[ErtHub] Тоолуур шинэчлэгдсэнгүй:', e.message);
      return null;
    });
  }

  function stats(itemId) {
    return req('GET', '/items/' + itemId).then(function (j) {
      var f = (j && j.fields) ? decFields(j.fields) : {};
      return {
        followerCount: f.followerCount || 0,
        ratingSum: f.ratingSum || 0,
        ratingCount: f.ratingCount || 0,
        reviewCount: f.reviewCount || 0,
        avgRating: f.ratingCount ? (f.ratingSum / f.ratingCount) : 0
      };
    });
  }

  /* ---- Үнэлгээ ---- */

  // Баримтын ID нь uid — давхар үнэлгээ өгөх боломжгүй. Өмнөх утгыг нь
  // уншаад зөрүүгээр нь нэгтгэлийг залруулна.
  function rate(itemId, stars) {
    var u = uid();
    if (!u) return Promise.resolve(null);
    stars = Math.max(1, Math.min(5, parseInt(stars, 10) || 0));
    var path = '/items/' + itemId + '/ratings/' + u;
    return req('GET', path).then(function (prev) {
      var old = (prev && prev.fields) ? dec(prev.fields.stars) : null;
      return req('PATCH', path, { fields: encFields({ stars: stars, at: new Date() }) })
        .then(function (res) {
          if (!res) return null;
          return bump(itemId, {
            ratingSum: stars - (old || 0),
            ratingCount: (old == null) ? 1 : 0
          }).then(function () { return { stars: stars, wasFirst: old == null }; });
        });
    });
  }

  function myRating(itemId) {
    var u = uid();
    if (!u) return Promise.resolve(null);
    return req('GET', '/items/' + itemId + '/ratings/' + u).then(function (j) {
      return (j && j.fields) ? dec(j.fields.stars) : null;
    });
  }

  /* ---- Сэтгэгдэл ---- */

  function addReview(itemId, text, stars, byName) {
    var u = uid();
    if (!u) return Promise.resolve(null);
    text = String(text || '').trim();
    if (!text) return Promise.resolve(null);
    var doc = {
      uid: u,
      byName: byName || 'Танилцуулаагүй хэрэглэгч',
      text: text.slice(0, 1000),
      stars: Math.max(0, Math.min(5, parseInt(stars, 10) || 0)),
      at: new Date(),
      hidden: false
    };
    return req('POST', '/items/' + itemId + '/reviews', { fields: encFields(doc) })
      .then(function (res) {
        if (!res) return null;
        return bump(itemId, { reviewCount: 1 }).then(function () { return doc; });
      });
  }

  function listReviews(itemId, limit) {
    return req('GET', '/items/' + itemId + '/reviews', null,
      'pageSize=' + (limit || 50) + '&orderBy=' + encodeURIComponent('at desc')
    ).then(function (j) {
      var docs = (j && j.documents) || [];
      return docs.map(function (d) {
        var o = decFields(d.fields);
        o._id = String(d.name).split('/').pop();
        return o;
      }).filter(function (o) { return !o.hidden; });
    });
  }

  /* ---- Дагах ---- */

  function isFollowing(itemId) {
    var u = uid();
    if (!u) return Promise.resolve(false);
    return req('GET', '/items/' + itemId + '/follows/' + u).then(function (j) { return !!j; });
  }

  // Буцаах утга: дагасан бол true, болисон бол false, боломжгүй бол null.
  function toggleFollow(itemId, notifyOnUpdate) {
    var u = uid();
    if (!u) return Promise.resolve(null);
    var path = '/items/' + itemId + '/follows/' + u;
    return req('GET', path).then(function (existing) {
      if (existing) {
        return req('DELETE', path).then(function () {
          return bump(itemId, { followerCount: -1 }).then(function () { return false; });
        });
      }
      return req('PATCH', path, {
        fields: encFields({ at: new Date(), notifyOnUpdate: notifyOnUpdate !== false })
      }).then(function (res) {
        if (!res) return null;
        return bump(itemId, { followerCount: 1 }).then(function () { return true; });
      });
    });
  }

  window.erthubStore = {
    get available() { return enabled; },
    itemKey: itemKey,
    uid: uid,
    saveProfile: saveProfile,
    loadProfile: loadProfile,
    stats: stats,
    rate: rate,
    myRating: myRating,
    addReview: addReview,
    listReviews: listReviews,
    isFollowing: isFollowing,
    toggleFollow: toggleFollow
  };
})();

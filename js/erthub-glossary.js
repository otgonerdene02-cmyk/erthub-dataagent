/* ErtHub — ДОМЭЙНЫ ТОЛЬ (glossary) ба графикийн sanity шалгалтын НЭГ эх сурвалж.

   ЯАГААД: "Орон нутаг" (ОН) нь feed-д дотоодын нислэг гэсэн утгатай ирдэг ч
   код тус бүрдээ `f.ou==='ОУ'` гэж шууд харьцуулж, танихгүй утгыг чимээгүй
   "дотоод" эсвэл "хаягдсан" болгодог байв. Ангиллын нэр, шошго, шалгалтыг
   ЭНД нэг газар төвлөрүүлнэ — chart бүр, агент бүр энэ модулийг ашиглана.

   Цэвэр функцүүд (DOM-гүй) — tests/run.js DG* бүлэг шууд шалгана. */
(function (root) {
  'use strict';

  /* Латин/кирилл ижил харагддаг үсгийг кирилл болгож, том үсэг, зайгүй болгоно.
     Латин үсгээр хольж бичсэн ОУ ба кирилл ОУ нэг ангилал гэж танигдах ёстой. */
  var LATIN_TO_CYR = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
  function norm(v) {
    var s = String(v == null ? '' : v).replace(/[\s .]+/g, '').toUpperCase();
    return s.replace(/[A-Z]/g, function (c) { return LATIN_TO_CYR[c] || c; });
  }

  /* Нислэгийн төрлийн ангилал. Түлхүүр нь norm() хийсэн хэлбэр. */
  var AIR_KIND = {
    'ОУ': 'intl', 'ОЛОНУЛС': 'intl', 'ОЛОНУЛСЫН': 'intl', 'INTERNATIONAL': 'intl',
    'ОН': 'dom', 'ОРОННУТАГ': 'dom', 'ДОТООД': 'dom', 'ДОТООДЫН': 'dom', 'DOMESTIC': 'dom'
  };
  /* Хэрэглэгчид харагдах нэр. "Орон нутаг" нь дотоодын нислэг — "дотоод" гэж харуулна. */
  var KIND_LABEL = {
    intl: 'Олон улсын',
    dom: 'Дотоод (орон нутаг)'
  };

  /* 'intl' | 'dom' | 'unknown' — танихгүй утгыг "unknown" гэж ИЛ буцаана. */
  function airFlightKind(v) {
    var raw = String(v == null ? '' : v).replace(/[\s .]+/g, '').toUpperCase();
    /* Латин үгийг (INTERNATIONAL) эхлээд шууд, дараа нь латин→кирилл хөрвүүлж хайна. */
    return AIR_KIND[raw] || AIR_KIND[norm(v)] || 'unknown';
  }

  /* Бусад салбарын ижил төрлийн хос (rail: ОН/ОУ галт тэрэг, вагон: дотоод/гадаад).
     Одоогоор ангиллыг нэг утга руу буулгах хэрэгцээ л байгаа тул шошгыг л нэгтгэв. */
  var SECTOR_PAIRS = {
    rail_pax: { dom: 'Орон нутаг (ОН)', intl: 'Олон улс (ОУ)' },
    rail_wagon: { dom: 'Дотоод', intl: 'Гадаад' }
  };

  /* ── Sanity шалгалт ───────────────────────────────────────────────
     parts: [{key,label,value}] — харьцааны (share/donut) хэсгүүд.
     Буцаах: {ok, issues:[{code,msg}], total, shares:[{key,pct}]}.
     Шалгалтууд: (1) нийлбэр 100%  (2) ганц ангилал  (5) танигдаагүй ангилал. */
  function ratioSanity(parts, opts) {
    opts = opts || {};
    var issues = [];
    var list = (parts || []).map(function (p) { return { key: p.key, label: p.label, value: +p.value || 0 }; });
    var total = list.reduce(function (t, p) { return t + p.value; }, 0);
    var shares = list.map(function (p) { return { key: p.key, pct: total > 0 ? p.value / total * 100 : 0 }; });
    if (total <= 0) {
      issues.push({ code: 'empty', msg: 'Харьцааны нийт дүн 0 — өгөгдөл олдсонгүй.' });
    } else {
      var sum = shares.reduce(function (t, s) { return t + s.pct; }, 0);
      if (Math.abs(sum - 100) > 0.05) issues.push({ code: 'sum', msg: 'Хувийн нийлбэр 100% биш (' + sum.toFixed(2) + '%).' });
      var nonZero = list.filter(function (p) { return p.value > 0; });
      var expected = opts.expected || list.length;
      if (expected >= 2 && nonZero.length === 1) {
        issues.push({ code: 'single', msg: '«' + nonZero[0].label + '» ганц ангилал 100% болсон — нөгөө ангилал алга эсвэл шүүгдсэн байж болзошгүй.' });
      }
    }
    if (opts.unknown && opts.unknown > 0) {
      issues.push({ code: 'unknown', msg: 'Танигдаагүй ангиллын ' + opts.unknown + ' мөр байна — чимээгүй хаяхгүй.' });
    }
    return { ok: issues.length === 0, issues: issues, total: total, shares: shares };
  }

  /* (3) Хэсэгчилсэн хугацаа: сарын цуваан дахь сүүлийн цэг одоогийн сар мөн эсэх.
     Буцаах: true бол тэр цэг "дуусаагүй". `now` — UTC мс (УБ = +8). */
  function isCurrentMonth(year, month, now) {
    var ub = new Date((now == null ? Date.now() : now) + 8 * 3600000);
    return +year === ub.getUTCFullYear() && +month === ub.getUTCMonth() + 1;
  }

  /* (4) Гарчиг ↔ нэгж: гарчиг/нэгжийн шошго хоосон байж болохгүй. */
  function unitTitleOk(title, unit) {
    return !!(String(title || '').trim() && String(unit || '').trim());
  }

  /* ОУ / дотоодын зорчигчийн харьцааны эх тоо. «Төрөл» (type) шүүлтээс ҮЛ ХАМААРНА:
     ОУ-аар шүүгдсэн үед дотоодыг хасаад 100% ОУ гэж зурвал "дотоодын нислэг
     байхгүй" мэт худал уншигдана. Он/сар/бүс/чиглэлийн шүүлт хэвээр үйлчилнэ.
     flights: [{ou,pax,month,dir,region}], filters: {dir,region,monthFrom,monthTo}.
     Танигдаагүй ОУ/ОН утга unknown-д орно (чимээгүй хаягдахгүй). */
  function airPaxSplit(flights, filters) {
    var fl = filters || {};
    var out = { intl: 0, dom: 0, intlFlights: 0, domFlights: 0, unknown: 0, unknownFlights: 0 };
    (flights || []).forEach(function (f) {
      var m = f.month || 1;
      if (fl.dir === 'dep' && f.dir !== '1') return;
      if (fl.dir === 'arr' && f.dir !== '0') return;
      if (fl.region && fl.region !== 'all' && f.region !== fl.region) return;
      if (fl.monthFrom != null && m < fl.monthFrom) return;
      if (fl.monthTo != null && m > fl.monthTo) return;
      var pax = f.pax || 0, k = airFlightKind(f.ou);
      if (k === 'intl') { out.intl += pax; out.intlFlights++; }
      else if (k === 'dom') { out.dom += pax; out.domFlights++; }
      else { out.unknown += pax; out.unknownFlights++; }
    });
    return out;
  }

  /* Шүүлтийн стандарт (FL): датасэтийн ангилалтай багана бүрийн боломжит утгыг
     ДАТААС авна. Утгыг стандартчлахгүй — зөвхөн trim + хоосныг хасна.
     rows: [{col: value}], cols: ['багана', ...] → {багана: ['утга', ...]} (өсөхөөр). */
  function filterDimensions(rows, cols) {
    var out = {};
    (cols || []).forEach(function (c) {
      var seen = {}, vals = [];
      (rows || []).forEach(function (r) {
        var v = r == null || r[c] == null ? '' : String(r[c]).trim();
        if (!v || seen[v]) return;
        seen[v] = true; vals.push(v);
      });
      out[c] = vals.sort();
    });
    return out;
  }

  /* Стандартын багана датасэтэд байхгүй бол тэдгээрийг буцаана (FL шалгалт). */
  function missingFilterCols(datasetCols, standardCols) {
    var have = {};
    (datasetCols || []).forEach(function (c) { have[c] = true; });
    return (standardCols || []).filter(function (c) { return !have[c]; });
  }
  /* DS_SCHEMA мөрийн нүдний ХАРАГДАХ утга. СҮҮЛИЙН багана нь "ok:Ачилттай"
     хэлбэрийн төлөв — хүснэгтэд ":"-ийн дараах шошго харагддаг тул шүүлт ч
     тэр шошгоор (статус чипийн Хэвийн/Анхаарах бүлэг биш, датаас ирсэн утга). */
  function cellText(row, i) {
    var v = row == null || row[i] == null ? '' : String(row[i]);
    if (Array.isArray(row) && +i === row.length - 1) {
      var p = v.indexOf(':');
      if (p !== -1) v = v.slice(p + 1);
    }
    return v.trim();
  }

  /* Датасэтийн хүснэгтийн (DS_SCHEMA) шүүлтийн багануудыг сонгоно.
     rows нь массив мөр. Ангилалтай багана гэдэг нь:
       - types[i]==='enum' (зарласан ангилал, СҮҮЛИЙН төлөвийн багана ч) — 2+ утгатай, эсвэл
       - types[i]==='string' бөгөөд 2..maxDistinct ялгаатай утгатай, ялгаатай
         утгын тоо дүүргэгдсэн мөрөөс цөөн (мөр бүр өвөрмөц = ID/нэр, шүүлт биш).
     opts.exclude — нэрээр хасах багана (жиш. нэгдсэн шүүлт аль хэдийн шүүдэг).
     maxDistinct (анх. 200) — агаарын Хот 157 утгатай ч ангилал; Нислэгийн код
     (500+) ба Аяллын дугаар (мөр бүр) нь ID тул орохгүй.
     → [{index, name, kind, values, counts}] (values: датаас, trim + давхардалгүй,
     өсөхөөр; counts[утга] = мөрийн тоо — олон утгатай баганыг давтамжаар товчлоход).

     Шүүлтийн ХЭЛБЭР (kind) — олон улсын нээлттэй өгөгдлийн порталын жишгээр
     (OpenDataSoft/CKAN facet, Socrata «filter»): багана бүрд өөрийн төрөлд нь
     тохирох удирдлага, бүх утгыг chip-ээр дэлгэхгүй.
       'chips'  — ≤ opts.chipMax (12) утга: нэг товшилтоор, олныг зэрэг сонгоно
       'search' — олон утга (Хот 157, Өртөө 45): бичиж хайгаад санал болгосноос
                  сонгоно — 100+ chip-ийн хана биш, жагсаалт ч удаашрахгүй
       'range'  — тоон багана (opts.ranges): доод–дээд хязгаар (min ≤ x ≤ max)
       'daterange' — огнооны багана (opts.dateIndex = түүхий мөрийн татах цонхны
                  багана): бүх огноог утга болгохгүй, ЭХЛЭХ–ДУУСАХ огноо (from ≤ d ≤ to).
                  Сервер энэ баганыг from/to-оор шүүдэг тул бүтэн датад үйлчилнэ.
     opts.facets/opts.keys — серверийн facet ({түлхүүр: {kind:'cat', values:[[утга,
       тоо]]} | {kind:'range', min, max}}): ЦОНХНЫ БҮТЭН датаас. Ачаалсан мөр нь
       сүүлийн 5,000 л байх тул түүнээс утга гаргавал цонхонд ороогүй утга (МТЗ —
       сүүлийн бичлэг 2026-02-01) огт сонгогдохгүй байв (2026-10-20).
     opts.dedupe — утга бүрийн мөрийн тоо ЯГ ижил хуваалттай багана (Тээвэрлэгч ↔
       Тээвэрлэгчийн нэр ↔ Байгууллага) нэг л шүүлт болно — эхнийх нь үлдэнэ. */
  function numOf(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    var s = String(v).replace(/[\s, ]/g, '');
    return s === '' ? NaN : Number(s);
  }
  function filterColumns(head, types, rows, opts) {
    opts = opts || {};
    var maxDistinct = opts.maxDistinct || 200, chipMax = opts.chipMax || 12, skip = {};
    var facets = opts.facets || null, keys = opts.keys || null;
    (opts.exclude || []).forEach(function (n) { skip[n] = true; });
    var out = [], seenSig = {}, n = (head || []).length;
    for (var i = 0; i < n; i++) {
      var t = (types || [])[i], name = head[i];
      if (skip[name]) continue;
      var fc = facets && keys && keys[i] ? facets[keys[i]] : null;
      if (opts.ranges && t === 'date' && opts.dateIndex != null && +opts.dateIndex === i) {
        var d0 = '', d1 = '';
        (rows || []).forEach(function (r) {
          var d = dayOf(r == null ? null : r[i]);
          if (!d) return;
          if (!d0 || d < d0) d0 = d;
          if (!d1 || d > d1) d1 = d;
        });
        /* Facet-тэй (цонхны бүтэн дата) бол шүүсэн хариу хоосон ч шүүлт үлдэнэ */
        if (facets || (d0 && d0 < d1)) out.push({ index: i, name: name, kind: 'daterange', min: d0, max: d1 });
        continue;
      }
      if (opts.ranges && (t === 'int' || t === 'float')) {
        var lo = Infinity, hi = -Infinity;
        if (fc && fc.kind === 'range') { lo = +fc.min; hi = +fc.max; }
        else if (!facets) {
          (rows || []).forEach(function (r) {
            var x = numOf(r == null ? null : r[i]);
            if (!isFinite(x)) return;
            if (x < lo) lo = x;
            if (x > hi) hi = x;
          });
        }
        if (isFinite(lo) && isFinite(hi) && lo < hi) out.push({ index: i, name: name, kind: 'range', min: lo, max: hi });
        continue;
      }
      if (t !== 'enum' && t !== 'string') continue;
      var vals = [], filled = 0, counts = {};
      if (facets && keys && keys[i]) {
        /* Сервер ангилал гэж үзээгүй (ID, чөлөөт текст) багана шүүлтэд орохгүй */
        if (!fc || fc.kind !== 'cat') continue;
        fc.values.forEach(function (p) { var v = String(p[0]).trim(); if (v && counts[v] == null) { counts[v] = +p[1] || 0; vals.push(v); } });
        vals.sort();
        if (vals.length < 2) continue;
      } else {
        (rows || []).forEach(function (r) {
          var v = cellText(r, i);
          if (!v) return;
          filled++;
          if (!counts[v]) { counts[v] = 0; vals.push(v); }
          counts[v]++;
        });
        vals.sort();
        if (t === 'string' && (vals.length < 2 || vals.length > maxDistinct || vals.length >= filled)) continue;
        if (t === 'enum' && vals.length < 2) continue;
      }
      if (opts.dedupe) {
        var sig = vals.map(function (v) { return counts[v]; }).sort(function (a, b) { return b - a; }).join(',');
        if (seenSig[sig]) continue;
        seenSig[sig] = true;
      }
      out.push({ index: i, name: name, kind: vals.length > chipMax ? 'search' : 'chips', values: vals, counts: counts });
    }
    return out;
  }

  /* Нэг нүдний харагдах утга сонголтод (cond) таарах эсэх. cond:
       'утга'            — тэнцүү (хуучин хэлбэр, агаарын тест FL13)
       {in:['а','б']}    — аль нэгтэй нь тэнцүү (chip / хайлтаас олныг сонгосон)
       {min:n, max:m}    — тоон хүрээ, хил оролцоно; тоо биш нүд таарахгүй
       {from:d, to:d}    — огнооны хүрээ ('YYYY-MM-DD', хил оролцоно); огноо биш нүд таарахгүй
     Сервер (backend whereOf) ЯГ ижил дүрмээр шүүдэг — хоёр талд давтан шүүхэд үр
     дүн өөрчлөгдөхгүй. */
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function dayOf(v) { var d = v == null ? '' : String(v).trim().slice(0, 10); return DAY_RE.test(d) ? d : ''; }
  function condActive(cond) {
    if (cond == null || cond === '') return false;
    if (typeof cond !== 'object') return true;
    return (Array.isArray(cond.in) && cond.in.length > 0) || isFinite(numOf(cond.min)) || isFinite(numOf(cond.max))
      || !!dayOf(cond.from) || !!dayOf(cond.to);
  }
  function condMatch(text, cond) {
    if (!condActive(cond)) return true;
    var v = text == null ? '' : String(text).trim();
    if (typeof cond !== 'object') return v === String(cond).trim();
    if (Array.isArray(cond.in) && cond.in.length && cond.in.indexOf(v) === -1) return false;
    var lo = numOf(cond.min), hi = numOf(cond.max);
    if (isFinite(lo) || isFinite(hi)) {
      var x = numOf(v);
      if (!isFinite(x) || (isFinite(lo) && x < lo) || (isFinite(hi) && x > hi)) return false;
    }
    var df = dayOf(cond.from), dt = dayOf(cond.to);
    if (df || dt) {
      var d = dayOf(v);
      if (!d || (df && d < df) || (dt && d > dt)) return false;
    }
    return true;
  }

  /* Мөр баганын сонголтод таарах эсэх. sel = {баганын индекс: cond}; хоосон
     утга = "Бүгд". filterColumns-тэй ижил cellText-ээр харьцуулна. */
  function rowMatchesCols(row, sel) {
    for (var k in (sel || {})) {
      if (!Object.prototype.hasOwnProperty.call(sel, k) || !condActive(sel[k])) continue;
      if (!condMatch(cellText(row, k), sel[k])) return false;
    }
    return true;
  }

  /* Хайлтын хэлбэрийн шүүлтийн санал: бичсэн текстийг АГУУЛСАН утгууд (том/жижиг
     үсэг ялгахгүй), мөрийн тоогоор буурахаар, сонгогдсоныг хасна. Текст хоосон
     бол хамгийн олон мөртэй утгууд (OpenDataSoft-ийн facet-ийн «top values»). */
  function facetSuggest(values, counts, typed, picked, limit) {
    var q = String(typed || '').trim().toLowerCase(), skip = {};
    (picked || []).forEach(function (v) { skip[v] = true; });
    var hit = (values || []).filter(function (v) { return !skip[v] && (!q || v.toLowerCase().indexOf(q) !== -1); });
    hit.sort(function (a, b) {
      /* Эхлэлээрээ таарсныг түрүүлнэ («дар» → «Дархан» нь «Сайндархан»-аас өмнө) */
      var pa = q && a.toLowerCase().indexOf(q) === 0 ? 0 : 1, pb = q && b.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      return pa - pb || ((counts || {})[b] || 0) - ((counts || {})[a] || 0) || (a < b ? -1 : a > b ? 1 : 0);
    });
    return { total: hit.length, list: hit.slice(0, limit || 8), all: hit };
  }

  /* (5) Графикийн хугацаа — диаграм бүр ЯГ ямар хугацааны датаг харуулж буйг
     гарчгийн доор нэг мөрөөр хэлнэ: «Хугацаа: 2022-01 — 2026-08 · 44 сар».
     keys = 'YYYY-MM' сарууд (шүүлтээр орсон). Хугацаа нь эхний ба сүүлийн сараас
     тооцогдоно; дутуу сар байвал partialTo (сүүлийн өдөр)-ээр тэмдэглэнэ.
     Сарын түлхүүр хоосон бол хугацаа ЗОХИОХГҮЙ — "мэдээлэл алга". */
  function periodSpan(keys, opts) {
    var o = opts || {};
    var w = Object.assign({ prefix: 'Хугацаа', months: 'сар', partial: 'дутуу сар', through: 'хүртэл', none: 'мэдээлэл алга', dropped: 'дутуу сар хасагдсан', last: 'сүүлийнх', day: 'сүүлийн бүрэн хоног', days: 'хоног' }, o.words || {});
    /* Нэг хоногийн агшин (жиш. вагоны «Салбарын бүтэц» = сүүлийн бүрэн хоногийн
       станцын задаргаа) — сарын хүрээ БИШ тул тусад нь нэрлэнэ. */
    if (o.asOf) return { from: o.asOf, to: o.asOf, count: 0, text: w.prefix + ': ' + o.asOf + ' · ' + w.day };
    /* Хоногийн муж (7 хоногийн тайлан, 30 хоногийн цуваа) — сарын хүрээ БИШ:
       «Хугацаа: 2026-10-12 — 2026-10-18 · 7 хоног». Тоо нь календарийн хоног. */
    if (o.dayFrom || o.dayTo) {
      var re = /^\d{4}-\d{2}-\d{2}$/;
      var a = String(o.dayFrom || o.dayTo).slice(0, 10), b = String(o.dayTo || o.dayFrom).slice(0, 10);
      if (!re.test(a) || !re.test(b)) return { from: '', to: '', count: 0, text: w.prefix + ': ' + w.none };
      if (a > b) { var t = a; a = b; b = t; }
      var nd = Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
      return { from: a, to: b, count: nd,
        text: w.prefix + ': ' + (a === b ? a : a + ' — ' + b) + ' · ' + nd + ' ' + (w.days || 'хоног') };
    }
    var list = (keys || []).map(function (k) { return String(k).slice(0, 7); })
      .filter(function (k) { return /^\d{4}-\d{2}$/.test(k); }).sort();
    if (!list.length) return { from: '', to: '', count: 0, text: w.prefix + ': ' + w.none };
    var from = list[0], to = list[list.length - 1];
    var count = (+to.slice(0, 4) * 12 + +to.slice(5, 7)) - (+from.slice(0, 4) * 12 + +from.slice(5, 7)) + 1;
    var span = from === to ? from : from + ' — ' + to;
    var parts = [w.prefix + ': ' + span, count + ' ' + w.months];
    /* Хэд хэдэн дутуу сар (жиш. вагон: эх сурвалжийн цоорхой + одоогийн сар) —
       ганц «дутуу сар» гэвэл зөвхөн сүүлийн сар дутуу мэт уншигдана. */
    var pn = +o.partialCount || 0;
    if (pn > 1) parts.push(pn + ' ' + w.partial + (o.partialTo ? ' (' + w.last + ' ' + o.partialTo + ' ' + w.through + ')' : ''));
    else if (o.partialTo) parts.push(w.partial + ' (' + o.partialTo + ' ' + w.through + ')');
    else if (pn) parts.push(w.partial);
    if (o.dropped) parts.push(w.dropped);
    return { from: from, to: to, count: count, text: parts.join(' · ') };
  }

  /* (5б) 7 хоногийн графикийн хугацаа — сарын бус, ӨДРИЙН муж: «Хугацаа: 2026-08-24 —
     2026-10-18 · 8 долоо хоног». from/to = 'YYYY-MM-DD' (эхний Даваа, сүүлийн Ням).
     Огноо буруу/хоосон бол хугацаа ЗОХИОХГҮЙ — "мэдээлэл алга". */
  function weekSpan(from, to, nWeeks, opts) {
    var o = opts || {};
    var w = Object.assign({ prefix: 'Хугацаа', weeks: 'долоо хоног', none: 'мэдээлэл алга' }, o.words || {});
    var ok = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); };
    if (!ok(from) || !ok(to) || !(nWeeks > 0)) return { from: '', to: '', count: 0, text: w.prefix + ': ' + w.none };
    return { from: from, to: to, count: nWeeks, text: w.prefix + ': ' + from + ' — ' + to + ' · ' + nWeeks + ' ' + w.weeks };
  }

  /* (5в) Картын хугацааны мөр — сайт (index.html chartPeriodText) ба админы preview
     ХОЁУЛАА ЭНИЙГ дуудна: загвар m = {periodKeys, partialTo, partialN, asOf, asOfWord,
     dayFrom, dayTo, nWeeks, partialDropped}; T(түлхүүр, fallback) = content.json
     site.chart.<түлхүүр>. Нэг газар — preview ба сайт өөр үгээр бичихгүй. */
  function chartPeriod(m, T) {
    var t = typeof T === 'function' ? T : function (k, fb) { return fb; };
    var W = { prefix: t('period_prefix', 'Хугацаа'), months: t('scope_months', 'сар'), partial: t('period_partial', 'дутуу сар'),
      through: t('period_through', 'хүртэл'), none: t('period_none', 'мэдээлэл алга'), dropped: t('period_dropped', 'дутуу сар хасагдсан'),
      last: t('period_last', 'сүүлийнх'), day: (m && m.asOfWord) || t('period_day', 'сүүлийн бүрэн хоног'), days: t('period_days', 'хоног') };
    if (m && m.nWeeks > 0) return weekSpan(m.dayFrom, m.dayTo, m.nWeeks,
      { words: { prefix: W.prefix, weeks: t('period_weeks', 'долоо хоног'), none: W.none } }).text;
    return periodSpan((m && m.periodKeys) || [], { partialTo: m && m.partialTo, partialCount: m && m.partialN, asOf: m && m.asOf,
      dayFrom: m && m.dayFrom, dayTo: m && m.dayTo, dropped: !!(m && m.partialDropped), words: W }).text;
  }

  /* (5г) Нүүрний «Салбарын харьцаа» (d05) — салбарын нэгтгэлээс (/api/sectors/total/history)
     салбар бүрийн НИЙТЛЭГ нэгжийн дүн. Сайт (sectorShareFromTotal) ба админы preview
     ХОЁУЛАА ЭНИЙГ дуудна — preview ба сайт өөр хувь, өөр хугацаа зурахгүй.
     weekly[measure].ytd байвал оны эхнээс өссөн дүн (идэвхтэй салбар бүр ИЖИЛ огноогоор);
     алга бол хамгийн сүүлийн оны сарын нэгтгэл (sectorTotalModel-ийн ижил дүрэм: зөвхөн
     api.sectors-ийн салбар, утга ба өдөртэй сар). T(түлхүүр, fallback) = site.sector_total.
     Буцаана: {meas, by:{салбар:дүн}, unit, period (тэмдэглэлийн текст), periodModel
     (chartPeriod-ийн загвар)} эсвэл null (нэгтгэл алга — тоо ЗОХИОХГҮЙ). */
  function sectorShare(apiRes, measure, T) {
    var t = typeof T === 'function' ? T : function (k, fb) { return fb; };
    if (!(apiRes && apiRes.status === 'ok')) return null;
    var meas = measure === 'freight_tonnes' ? 'freight_tonnes' : 'passengers';
    var W = apiRes.weekly && apiRes.weekly[meas], by = {}, period, model;
    if (W && W.ytd && W.ytd.by_sector) {
      Object.keys(W.ytd.by_sector).forEach(function (k) { var b = W.ytd.by_sector[k]; if (b && b.value != null) by[k] = +b.value; });
      var md = function (s) { return String(s || '').slice(5).replace('-', '.'); };
      period = t('d05_period_ytd', '{year} оны эхнээс ({from}–{to})').replace('{year}', W.ytd.year)
        .replace('{from}', md(W.ytd.from)).replace('{to}', md(W.ytd.to));
      model = { dayFrom: W.ytd.from, dayTo: W.ytd.to };
    } else {
      var months = Array.isArray(apiRes.months) ? apiRes.months : [];
      var y = 0;
      months.forEach(function (r) { var v = +String(r.month).slice(0, 4); if (v > y) y = v; });
      if (!y) return null;
      var secs = {}, dayKey = meas === 'passengers' ? 'passenger_days' : 'freight_days', seen = {}, keys = [];
      (apiRes.sectors || []).forEach(function (s) { secs[s.sector] = 1; });
      months.forEach(function (r) {
        var m = String(r.month);
        if (m.slice(0, 4) !== String(y)) return;
        if (!seen[m]) { seen[m] = 1; keys.push(m); }
        if (!secs[r.sector] || r[meas] === null || r[meas] === undefined || !(+r[dayKey])) return;
        by[r.sector] = (by[r.sector] || 0) + (+r[meas] || 0);
      });
      period = t('d05_period_year', '{year} он (сарын нэгтгэл)').replace('{year}', y);
      model = { periodKeys: keys };
    }
    return { meas: meas, by: by, unit: meas === 'passengers' ? t('unit_pax', 'зорчигч') : t('unit_tonne', 'тонн'), periodModel: model,
      period: period + ' · ' + (meas === 'passengers' ? t('by_pax', 'зорчигчоор') : t('by_freight', 'ачаагаар (тонн)')) };
  }

  var api = {
    airPaxSplit: airPaxSplit, norm: norm, airFlightKind: airFlightKind, KIND_LABEL: KIND_LABEL, AIR_KIND: AIR_KIND,
    SECTOR_PAIRS: SECTOR_PAIRS, ratioSanity: ratioSanity, isCurrentMonth: isCurrentMonth, unitTitleOk: unitTitleOk,
    filterDimensions: filterDimensions, missingFilterCols: missingFilterCols,
    filterColumns: filterColumns, rowMatchesCols: rowMatchesCols, periodSpan: periodSpan, weekSpan: weekSpan, chartPeriod: chartPeriod,
    sectorShare: sectorShare, condActive: condActive, condMatch: condMatch, dayOf: dayOf, facetSuggest: facetSuggest, numOf: numOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EHGlossary = api;
})(typeof window !== 'undefined' ? window : globalThis);

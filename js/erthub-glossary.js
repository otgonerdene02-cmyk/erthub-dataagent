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

  /* (5е) Hero «ЗОРЧИГЧ / ӨДӨР» (hero_px) — салбарын нэгтгэлийн 7 хоногийн тайлангаас
     (/api/sectors/total/history → weekly.passengers) СҮҮЛИЙН БҮТЭН долоо хоног (Да–Ня).
     Сайт (heroPxStat) ба админы ticker preview ХОЁУЛАА ЭНИЙГ дуудна — өөр тоо, өөр хугацаа
     зурахгүй. mk = metric_registry.json → widgets.hero_px.metric:
       total.daily_pax_avg — keys салбарын (null бол weekly.sectors бүгд) нийлбэр ÷ 7; 02-р
         хэсгийн «Долоо хоногийн нийт зорчигч» (w2p)-тэй ИЖИЛ долоо хоног → sum = w2p-ийн нийт
       <салбар>.weekly_pax — тухайн салбарын долоо хоногийн нийлбэр (÷ 1)
     Салбар бичлэггүй (missing — 0 гэж тооцохгүй), эх сурвалжийн цоорхойтой (gaps
     {салбар:[{from,to}]}) эсвэл 7-оос цөөн хоногтой (short) бол БҮРТГЭГДСЭН утгын нийлбэр нь
     ДООД хязгаар → lower, «≥», тэмдэглэлд салбарыг нэрлэнэ — w2p-ийн «≥» баганатай (#106,
     weekSectorReport.partial) ИЖИЛ дүрэм. Долоо хоног бүхэлдээ бичлэггүй (missing), нэг ч
     салбар бүртгэлгүй, эсвэл мэдэгдэхгүй метрик бол null — тоо ЗОХИОХГҮЙ («—»).
     T(түлхүүр, fallback) = site.hero. */
  function heroPax(apiRes, mk, keys, gaps, T) {
    var t = typeof T === 'function' ? T : function (k, fb) { return fb; };
    var W = apiRes && apiRes.status === 'ok' && apiRes.weekly && apiRes.weekly.passengers;
    if (!(W && Array.isArray(W.weeks) && W.weeks.length)) return null;
    var avail = W.sectors || [], per, ks, m = /^([a-z]+)\.weekly_pax$/.exec(String(mk || ''));
    if (mk === 'total.daily_pax_avg') { per = 7; ks = keys ? keys.slice() : avail.slice(); }
    else if (m) { per = 1; ks = [m[1]]; }
    else return null;
    ks = ks.filter(function (k) { return avail.indexOf(k) >= 0; });
    var x = W.weeks[W.weeks.length - 1];
    if (!ks.length || !x || x.missing) return null;
    var num = function (v) { return (v === null || v === undefined || v === '' || !isFinite(+v)) ? null : +v; };
    var gapIn = function (k) { return !!(gaps && Array.isArray(gaps[k]) && gaps[k].some(function (g) {
      return g && g.from <= x.week_end && g.to >= x.week_start; })); };
    /* used — бүтэн орсон (цоорхойгүй) салбар = w2p-ийн partialKeys; gap — цоорхойтой ч
       бүртгэгдсэн хэсэг нь нийлбэрт орсон; short — цоорхойгүй ч 7-оос цөөн хоногтой */
    var used = [], miss = [], gap = [], short = [], sum = 0;
    ks.forEach(function (k) {
      var b = x.by_sector && x.by_sector[k], v = b ? num(b.value) : null;
      if (v === null) { miss.push(k); return; }
      sum += v;
      if (gapIn(k)) { gap.push(k); return; }
      used.push(k);
      if (b.days != null && +b.days < 7) short.push(k);
    });
    if (!used.length && !gap.length) return null;
    var names = {};
    (apiRes.sectors || []).forEach(function (s) { if (s && s.sector) names[s.sector] = s.name || s.sector; });
    var off = ks.filter(function (k) { return used.indexOf(k) < 0 || short.indexOf(k) >= 0; }), value = Math.round(sum / per);
    var md = function (s) { return String(s || '').slice(5).replace('-', '.'); };
    var note = (per === 7 ? t('px_period', '{from}–{to} · 7 хоногийн дундаж') : t('px_period_week', '{from}–{to}'))
      .replace('{from}', md(x.week_start)).replace('{to}', md(x.week_end));
    if (off.length) note += ' · ' + t('px_partial', '{names} — мэдээлэл дутуу')
      .replace('{names}', off.map(function (k) { return names[k] || k; }).join(', '));
    return { value: value, sum: sum, per: per, lower: off.length > 0, display: (off.length ? '≥ ' : '') + value.toLocaleString('en-US'),
      note: note, from: x.week_start, to: x.week_end, keys: ks, used: used, missing: miss, gap: gap, short: short };
  }

  /* (5з) Нүүрний 01-р хэсэг «Үндсэн үзүүлэлт» ба «Салбарын харьцаа» (d05) — НЭГДСЭН шүүлтийн
     ОГНООНЫ мужаар салбар бүрийн НЭГ хэмжүүр (зорчигч эсвэл ачаа тонн), НЭГ хугацаа, НЭГ
     харьцуулалт. Эх: салбарын нэгтгэлийн өдрийн мөр (/api/datasets/sector-total/rows —
     gold.sector_daily_total). Сайт (livestrip, buildDonut) ба админы ls/d05 preview ХОЁУЛАА
     ЭНИЙГ дуудна. 2026-10-27 хэрэглэгчийн шаардлага: «нэг карт нь цаг хугацааны шугамтай,
     нөгөө нь шугамгүй — салбар бүр нэг логик, нэг хугацааны дата харуул» (өмнө нь авто —
     хоногийн үзлэг, төмөр зам — хоногийн вагон, агаар — сарын нислэг байв). tests/run.js HK. */
  var DAY_MS = 86400000;
  function isoAdd(s, n) { var d = new Date(String(s).slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function isoDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS); }
  /* Нэг жилийн өмнөх ижил огноо (2024-02-29 → 2023-02-28) */
  function isoYearBack(s) {
    var y = +s.slice(0, 4) - 1, m = s.slice(5, 7), d = +s.slice(8, 10);
    var dim = new Date(Date.UTC(y, +m, 0)).getUTCDate();
    return y + '-' + m + '-' + String(Math.min(d, dim)).padStart(2, '0');
  }
  /* /rows хариу → [{date, sector, passengers, freight_tonnes}] (багана нэрээр — дараалал
     өөрчлөгдсөн ч эвдрэхгүй). Утга null = тухайн хэмжүүрийн эх сурвалж алга (0 БИШ). */
  function stDailyRows(res) {
    if (!(res && res.status === 'ok' && Array.isArray(res.columns) && Array.isArray(res.rows))) return null;
    var ix = {};
    res.columns.forEach(function (c, i) { if (c && c.key) ix[c.key] = i; });
    if (ix.record_date == null || ix.sector_code == null) return null;
    var num = function (v) { return (v === null || v === undefined || v === '' || !isFinite(+v)) ? null : +v; };
    return res.rows.map(function (r) {
      return { date: dayOf(r[ix.record_date]), sector: String(r[ix.sector_code] || ''),
        passengers: ix.passengers == null ? null : num(r[ix.passengers]),
        freight_tonnes: ix.freight_tonnes == null ? null : num(r[ix.freight_tonnes]) };
    }).filter(function (r) { return r.date && r.sector; });
  }
  /* Мөрүүд → {by:{огноо:{салбар:{passengers,freight_tonnes}}}, first, last}. VIEW-д (огноо, салбар)
     давтагдашгүй — хэд хэдэн хэсгээр (жилээр) татахад давхцсан мөр НЭМЭГДЭХГҮЙ, сүүлийнх нь үлдэнэ. */
  function stDailyIndex(rows) {
    var by = {}, first = null, last = null;
    (rows || []).forEach(function (r) {
      var d = by[r.date] || (by[r.date] = {});
      d[r.sector] = { passengers: r.passengers, freight_tonnes: r.freight_tonnes };
      if (!first || r.date < first) first = r.date;
      if (!last || r.date > last) last = r.date;
    });
    return { by: by, first: first, last: last };
  }
  /* Шүүлтийн бэлэн муж. anchor = сүүлийн БҮТЭН өдөр (нэгтгэлийн weekly[хэмжүүр].week_end — 02-р
     хэсэг, hero-той ижил; бүх салбар бүтэн мэдээтэй). Өгөгдмөл 'ytd' — d05 ба газрын зураг
     (оны эхнээс) хоёртой ИЖИЛ хугацаа. */
  var HOME_PRESETS = ['7d', '30d', '90d', 'mtd', 'ytd', '12m'];
  function homeRange(preset, anchor) {
    if (!DAY_RE.test(String(anchor || ''))) return null;
    var a = String(anchor).slice(0, 10);
    var from = preset === '7d' ? isoAdd(a, -6) : preset === '30d' ? isoAdd(a, -29) : preset === '90d' ? isoAdd(a, -89)
      : preset === 'mtd' ? a.slice(0, 8) + '01' : preset === '12m' ? isoAdd(a, -364) : a.slice(0, 4) + '-01-01';
    return { from: from, to: a, preset: HOME_PRESETS.indexOf(preset) >= 0 ? preset : 'ytd' };
  }
  /* Харьцуулах хугацаа: ≤92 хоног → өмнөх ИЖИЛ урттай хугацаа (WoW/MoM-ийн ерөнхий хэлбэр);
     түүнээс урт → өмнөх оны мөн үе (улирлын хэлбэлзэлтэй тээврийн тоог урт мужид өмнөх
     хугацаатай харьцуулбал худал өсөлт/уналт гарна). */
  function rangeCompare(from, to) {
    var n = isoDiff(from, to) + 1;
    if (n <= 92) return { mode: 'prev', from: isoAdd(from, -n), to: isoAdd(from, -1), n: n };
    var f = isoYearBack(from), t = isoYearBack(to);
    return { mode: 'yoy', from: f, to: t, n: isoDiff(f, t) + 1 };
  }
  /* Spark-ийн хувиар: ≤92 хоног — өдөр, ≤731 — 7 хоног, түүнээс урт — 30 хоног. Хувиарыг
     ТӨГСГӨЛӨӨС (to) хойш тоолно — сүүлийн цэг үргэлж сонгосон өдрөөр дуусна; эхний дутуу
     хэсэг spark-д орохгүй (нийт дүнд орно). Аль нэг өдөр нь мэдээгүй хувиар null — дутуу
     нийлбэрийг бүтэн мэт зурахгүй (DG). */
  function stBuckets(from, to, size) {
    var out = [], end = to;
    while (isoDiff(from, end) + 1 >= size) { out.unshift({ from: isoAdd(end, -(size - 1)), to: end }); end = isoAdd(end, -size); }
    return out;
  }
  /* idx — stDailyIndex; o = {from, to, measure, keys, gaps {салбар:[{from,to}]}}.
     Салбар бүр: value — мужид бүртгэгдсэн нийлбэр; days — мэдээтэй (цоорхойд ороогүй) өдөр;
     lower — days < n (≥, доод хязгаар); харьцуулалт — хоёр тал БҮТЭН бол нийлбэрээр, хоёулаа
     ≥90% бол ӨДРИЙН ДУНДЖААР (basis:'avg' — ил хэлнэ), эс бөгөөс pct=null + шалтгаан (reason).
     Мэдээгүй салбар value=null — 0 ЗОХИОХГҮЙ. */
  function periodStrip(idx, o) {
    o = o || {};
    if (!(idx && idx.by) || !DAY_RE.test(String(o.from || '')) || !DAY_RE.test(String(o.to || '')) || o.from > o.to) return null;
    var meas = o.measure === 'freight_tonnes' ? 'freight_tonnes' : 'passengers';
    var n = isoDiff(o.from, o.to) + 1, cmp = rangeCompare(o.from, o.to);
    var size = n <= 92 ? 1 : n <= 731 ? 7 : 30;
    var gaps = o.gaps || {};
    var inGap = function (k, d) { return !!(Array.isArray(gaps[k]) && gaps[k].some(function (g) { return g && g.from <= d && g.to >= d; })); };
    var cell = function (k, d) { var x = idx.by[d] && idx.by[d][k]; return x && x[meas] !== null && x[meas] !== undefined ? x[meas] : null; };
    var span = function (k, from, to) {
      var v = 0, any = false, days = 0, last = null;
      for (var d = from; d <= to; d = isoAdd(d, 1)) {
        var c = cell(k, d);
        if (c === null) continue;
        v += c; any = true; last = d;
        if (!inGap(k, d)) days++;
      }
      return { value: any ? v : null, days: days, n: isoDiff(from, to) + 1, last: last };
    };
    var series = function (k, from, to) {
      return stBuckets(from, to, size).map(function (b) { var s = span(k, b.from, b.to);
        return { from: b.from, to: b.to, v: s.days === s.n ? s.value : null, rec: s.value }; });
    };
    var sectors = {}, total = 0, any = false;
    (o.keys || []).forEach(function (k) {
      var c = span(k, o.from, o.to), p = span(k, cmp.from, cmp.to);
      var pct = null, basis = null, reason = null, rec = c.value;
      /* Мужийн талаас бага өдөр мэдээтэй бол бүртгэгдсэн нийлбэрийг «тухайн хугацааны дүн» гэж
         харуулахгүй (жиш. авто 2023-05–06: 5/61 хоног → «≥21 зорчигч» худал сэтгэгдэл) — rec-д үлдэнэ */
      if (c.value !== null && c.days < c.n * 0.5) { reason = 'thin'; c = { value: null, days: c.days, n: c.n, last: c.last }; }
      else if (c.value === null) reason = 'none';
      else if (p.value === null) reason = 'no_prev';
      else if (c.days === c.n && p.days === p.n && p.value > 0) { pct = (c.value / p.value - 1) * 100; basis = 'sum'; }
      else if (c.days >= c.n * 0.9 && p.days >= p.n * 0.9 && p.value > 0 && c.days > 0 && p.days > 0) {
        pct = ((c.value / c.days) / (p.value / p.days) - 1) * 100; basis = 'avg';
      } else reason = c.days < c.n * 0.9 ? 'short' : 'prev_short';
      if (c.value !== null) { total += c.value; any = true; }
      sectors[k] = { key: k, value: c.value, rec: rec, days: c.days, n: c.n, lower: c.value !== null && c.days < c.n, last: c.last,
        prev: p.value, prevDays: p.days, prevN: p.n, pct: pct, basis: basis, reason: reason,
        series: c.value === null ? [] : series(k, o.from, o.to), prevSeries: c.value === null ? [] : series(k, cmp.from, cmp.to) };
    });
    return { from: o.from, to: o.to, n: n, cmp: cmp, measure: meas, bucket: size, keys: (o.keys || []).slice(), sectors: sectors,
      total: any ? total : null, hasData: any };
  }
  /* Spark зам — нэг масштабаар одоогийн (line) ба харьцуулах (prevLine) хугацаа; null цэг
     шугамыг тасална. hits — цэг бүрийн hover муж (x, w) + tip (HV: нэр — утга). ЦЭВЭР. */
  function sparkPaths(cur, prev, o) {
    o = o || {};
    var w = o.w || 120, h = o.h || 32, pad = o.pad == null ? 3 : o.pad;
    var vals = (cur || []).concat(prev || []).map(function (p) { return p && p.v; }).filter(function (v) { return v !== null && v !== undefined && isFinite(v); });
    var n = Math.max((cur || []).length, (prev || []).length);
    if (!vals.length || n < 2) return { line: '', prevLine: '', area: '', hits: [], dot: null };
    var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals), rng = (mx - mn) || 1;
    var X = function (i) { return pad + i * (w - pad * 2) / (n - 1); };
    var Y = function (v) { return h - pad - (h - pad * 2) * ((v - mn) / rng); };
    var path = function (list) {
      var s = '', pen = false;
      (list || []).forEach(function (p, i) {
        if (!p || p.v === null || p.v === undefined) { pen = false; return; }
        s += (pen ? ' L' : (s ? ' M' : 'M')) + X(i).toFixed(1) + ',' + Y(p.v).toFixed(1); pen = true;
      });
      return s;
    };
    var line = path(cur), lastI = -1;
    (cur || []).forEach(function (p, i) { if (p && p.v !== null && p.v !== undefined) lastI = i; });
    var bw = (w - pad * 2) / (n - 1);
    var hits = (cur || []).map(function (p, i) {
      return { x: Math.max(0, X(i) - bw / 2).toFixed(1), w: Math.max(1, Math.min(bw, w)).toFixed(1), i: i };
    });
    return { line: line, prevLine: path(prev), hits: hits,
      dot: lastI >= 0 ? { cx: X(lastI).toFixed(1), cy: Y(cur[lastI].v).toFixed(1) } : null };
  }
  /* 01-р зурвасын нүдний ТЕКСТ (тоо, өөрчлөлтийн хувь, тайлбар) — сайт (lsStripCell) ба админы
     strip5 preview НЭГ функц. T(key, fb) — content.json site.home_range; o.noData — мэдээгүй үеийн
     үг. «≥» — мужийн зарим өдөр мэдээгүй (доод хязгаар). ЦЭВЭР. */
  function periodCell(hs, k, T, o) {
    o = o || {};
    var x = (hs && hs.sectors && hs.sectors[k]) || null;
    var noData = o.noData || T('no_data', 'мэдээлэл алга');
    var fmt = function (v) { return Math.round(v).toLocaleString('en-US'); };
    if (!(x && x.value !== null)) {
      return { live: false, value: '—', delta: '—', dir: 'flat', pct: null,
        note: (x && x.reason === 'thin') ? T('thin', 'мэдээ дутуу — {d}/{n} хоног').replace('{d}', x.days).replace('{n}', x.n) : noData };
    }
    var cmpW = hs.cmp.mode === 'yoy' ? T('cmp_yoy_short', 'Өмнөх оны мөн үе') : T('cmp_prev_short', 'Өмнөх {n} хоног').replace('{n}', hs.cmp.n);
    var note = x.reason === 'no_prev' ? cmpW + ' — ' + noData
      : x.reason === 'prev_short' ? T('prev_short', '{cmp}: мэдээ дутуу ({d}/{n} хоног) — харьцуулахгүй').replace('{cmp}', cmpW).replace('{d}', x.prevDays).replace('{n}', x.prevN)
      : x.reason === 'short' ? T('short', 'мэдээтэй {d}/{n} хоног — харьцуулахгүй').replace('{d}', x.days).replace('{n}', x.n)
      : cmpW + ': ' + fmt(x.prev) + (x.basis === 'avg' ? ' · ' + T('basis_avg', 'өдрийн дунджаар') : '');
    if (x.lower && x.reason !== 'short') note = T('days', '{d}/{n} хоног мэдээтэй').replace('{d}', x.days).replace('{n}', x.n) + ' · ' + note;
    var pct = x.pct;
    return { live: true, value: (x.lower ? '≥' : '') + fmt(x.value),
      delta: pct === null ? '—' : (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1) + '%',
      dir: pct === null ? 'flat' : pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', pct: pct, note: note };
  }
  /* Spark-ийн нэг цэгийн хугацааны үг (periodStrip.bucket) — widgets.ls.foot-ийн «{bucket}» */
  function bucketWord(size, T) {
    return size === 1 ? T('bucket_day', '1 өдөр') : size === 7 ? T('bucket_week', '7 хоног')
      : size === 30 ? T('bucket_30', '30 хоног') : T('bucket_month', '1 сар');
  }
  /* Хувийн харьцааны текст — 0-ээс их ч 0.05%-иас бага хувийг «0.0%» гэж бичвэл «огт
     тээвэр хийгээгүй» мэт уншигдана (2026-10-27: агаарын ачаа 8,521 тн = нийтийн 0.03%). d05 (сайт,
     админ). digits — бутархайн орон (төвийн том тоо 0, жагсаалт 1). */
  function shareText(pct, digits) {
    if (pct === null || pct === undefined || !isFinite(pct)) return '—';
    var d = digits == null ? 1 : digits, step = Math.pow(10, -Math.max(1, d));
    if (pct <= 0) return '0%';
    if (pct < step) return '<' + step.toFixed(Math.max(1, d)) + '%';
    if (pct < 100 && pct > 100 - step) return '>' + (100 - step).toFixed(Math.max(1, d)) + '%';
    if (d === 0 && (pct < 0.5 || (pct > 99.5 && pct < 100))) return pct.toFixed(1) + '%';
    return pct.toFixed(d) + '%';
  }
  /* Нумын ХАРАГДАХ хувь — 0-ээс их хувь бүр дор хаяж minPct (өгөгдмөл 1.5) өнцөгтэй, бусад нь
     хувь тэнцүүлэн багасна (нийлбэр 100). Шошго/tooltip ЖИНХЭНЭ хувийг бичнэ; энэ нь зөвхөн нум
     харагдахгүй болж «тээвэр алга» гэж ойлгогдохоос сэргийлнэ. 0 / мэдээгүй → 0. ЦЭВЭР. */
  function shareArcs(values, minPct) {
    var m = minPct == null ? 1.5 : minPct;
    var pos = (values || []).map(function (v) { return (v > 0 && isFinite(v)) ? +v : 0; });
    var tot = pos.reduce(function (a, b) { return a + b; }, 0);
    if (!tot) return pos.map(function () { return 0; });
    var pct = pos.map(function (v) { return v / tot * 100; });
    var small = pct.map(function (p) { return p > 0 && p < m; });
    var need = 0, big = 0;
    pct.forEach(function (p, i) { if (small[i]) need += m - p; else big += p; });
    if (!need || !big) return pct;
    return pct.map(function (p, i) { return p <= 0 ? 0 : small[i] ? m : p - need * (p / big); });
  }

  /* (5д) Авто тээврийн зорчигчийн САРЫН цуваа (/api/sectors/road/passengers/history) →
     sectorSummaryToSeries()-ийн ИЖИЛ хэлбэр {unit, year, counts, lastMonth, partial,
     partialValue, prev} + partials. Нүүрний t05/k04 (сайт) ба админы t05 preview ХОЁУЛАА
     ЭНИЙГ дуудна. Эх сурвалж ЦОНХООР ачаалагддаг тул сард цоорхой байж болно:
     хамрагдсан хоногийн дундаж × сарын хоног = сарын эквивалент (06-р хэсгийн
     roadPaxMonthSeries-тэй ижил дүрэм), partials[i] = {days, dim} — tooltip-д ИЛ.
     - Явагдаж буй (УБ) сар цуваанд орохгүй → partial/partialValue (бодит дүн, hollow цэг).
     - Сүүлийн мэдээтэй оны 1-р сараас ЗАВСАРГҮЙ; мэдээгүй сар (хоног 0) завсарт байвал
       null — хэсэгчилж зурахгүй, тоо зохиохгүй. 2-оос цөөн сар бол null. */
  function roadPaxSeries(h, now) {
    if (!(h && h.status === 'ok' && Array.isArray(h.months))) return null;
    var ub = new Date((now == null ? Date.now() : now) + 8 * 3600000);
    var curKey = ub.getUTCFullYear() * 100 + (ub.getUTCMonth() + 1);
    var by = {}, partial = null, partialValue = null, partialDay = null, partialDim = null, maxKey = 0;
    h.months.forEach(function (m) {
      if (!m || !/^\d{4}-\d{2}$/.test(String(m.month))) return;
      var y = +m.month.slice(0, 4), mo = +m.month.slice(5, 7), k = y * 100 + mo;
      var days = +m.days || 0;
      if (days <= 0) return;
      var dim = +m.days_in_month || new Date(Date.UTC(y, mo, 0)).getUTCDate();
      if (k >= curKey) {
        if (k === curKey) {
          partial = m.month; partialValue = +m.passengers || 0;
          /* Мэдээ ХҮРСЭН сүүлийн өдөр (өнөөдөр БИШ — ETL хоцорч болно): шошгон дээр «1–N» */
          var ld = /^\d{4}-\d{2}-(\d{2})/.exec(String(m.last_date || ''));
          partialDay = ld ? +ld[1] : null; partialDim = dim;
        }
        return;
      }
      var v = days >= dim ? (+m.passengers || 0)
        : (m.passengers_covered != null ? +m.passengers_covered : (+m.passengers || 0)) / days * dim;
      by[k] = { v: Math.round(v), days: Math.min(days, dim), dim: dim };
      if (k > maxKey) maxKey = k;
    });
    if (!maxKey) return null;
    var year = Math.floor(maxKey / 100), counts = [], partials = [];
    for (var mo = 1; mo <= maxKey % 100; mo++) {
      var r = by[year * 100 + mo];
      if (!r) return null;
      counts.push(r.v);
      partials.push(r.days < r.dim ? { days: r.days, dim: r.dim } : null);
    }
    if (counts.length < 2) return null;
    var prevCounts = [], prevPartials = [];
    for (var pm = 1; pm <= 12; pm++) {
      var p = by[(year - 1) * 100 + pm];
      prevCounts.push(p ? p.v : null);
      prevPartials.push(p && p.days < p.dim ? { days: p.days, dim: p.dim } : null);
    }
    var prev = prevCounts.some(function (v) { return v != null; }) ? { year: year - 1, counts: prevCounts, partials: prevPartials } : null;
    /* Одоогийн сарын hollow цэг нь графикийн ДАРААГИЙН слот (counts.length+1) дээр зурагддаг —
       цуваа түүнээс өмнө тасарсан бол (жиш. 4–9-р сар мэдээгүй) өөр сарын нэрээр гарна → хаяна. */
    var adj = partial && curKey === year * 100 + counts.length + 1;
    return { unit: 'зорчигч', year: year, counts: counts, partials: partials, lastMonth: counts.length,
      partial: adj ? partial : null, partialValue: adj ? partialValue : null,
      partialDay: adj ? partialDay : null, partialDim: adj ? partialDim : null, prev: prev };
  }

  /* (5е) Нүүрний 02-р хэсэг «7 хоногийн тайлан» — нэгтгэлийн weekly[measure]-ээс ЗӨВХӨН `keys`
     салбараар (бүртгэлд холбогдсон, backend-д бий). Сайт (index.html weekSectorTotal → buildWeek)
     ба админы w2p/w2c preview ХОЁУЛАА ЭНИЙГ дуудна (2026-10-27: preview цоорхойтой долоо хоногийг
     өөрийн хуулбар логикоор АЛГАСЧ, сайт «≥» баганаар зурж байв). tests/run.js WK бүлэг.
     - weeks[].value: долоо хоногийн нийлбэр; аль нэг салбар бичлэггүй бол null (дутуу
       нийлбэрийг бүтэн мэт харуулахгүй, 0 зохиохгүй)
     - wow: сүүлийн хоёр долоо хоног хоёулаа бүтэн үед л; салбар бүрд ч мөн адил
     - ytd: оны эхнээс keys-ийн нийлбэр; yoy: зөвхөн comparable ∩ keys салбараар
     - gaps {салбар:[{from,to}]} — эх сурвалжийн цоорхой (авто тээвэр: road history
       coverage.gaps). Цоорхойтой давхцсан салбар-долоо хоног бичлэггүйтэй адил (null) —
       хожуу орсон цөөн билетийг бүтэн долоо хоног мэт нийлүүлэхгүй (DG: дутуу ≠ бүтэн).
       ytdGapKeys — оны эхнээс хүрээнд цоорхойтой салбар (дуудагч ИЛ нэрлэнэ).
     - partial — нийт бүрдээгүй (цоорхой/бичлэггүй салбартай) долоо хоногт БҮРТГЭГДСЭН бүх
       утгын нийлбэр (доод хязгаар «≥», бүтэн нийт БИШ) — цоорхойтой салбарын бүртгэгдсэн
       хэсэг ч орно (2026-10-27: 09.14–09.20-нд авто тээврийн 7 хоногоос 5 нь бүтэн, 21,298
       зорчигч байхад бүхэлд нь хасаж «≥82.2K» гэж харуулж байв); partialKeys — бүтэн орсон
       салбарууд. parts — салбар бүрийн бүртгэгдсэн утга ба цоорхойтой хоног (давхарласан багана).
     null бол дуудагч агаарын хуучин замаар (weeklyAirStats). */
  function weekReport(w, keys, gaps, lastBy) {
    if (!(w && Array.isArray(w.weeks) && w.weeks.length)) return null;
    var avail = w.sectors || [];
    var ks = (keys || []).filter(function (k) { return avail.indexOf(k) >= 0; });
    if (!ks.length) return null;
    var num = function (v) { return (v === null || v === undefined || v === '' || !isFinite(+v)) ? null : +v; };
    var gapIn = function (k, from, to) {
      return !!(gaps && Array.isArray(gaps[k]) && from && to && gaps[k].some(function (g) { return g && g.from <= to && g.to >= from; }));
    };
    var val = function (b, k) { return (b && b[k]) ? num(b[k].value) : null; };
    /* Мэдээтэй хоног (backend by_sector[k].days) 7-оос цөөн = эх сурвалжийн цоорхой — авто тээврийн
       coverage.gaps-тай ИЖИЛ дүрэм, САЛБАРААС ҮЛ ХАМААРНА (2026-10-28: УБТЗ-ийн ачаа 10-23…10-25
       бичлэггүй байхад 4 хоногийн дүнг бүтэн 7 хоног мэт «−32.1%» гэж харуулж байв). days алга
       (хуучин backend) бол урьдын шигээ. */
    var daysOf = function (b, k) { return (b && b[k]) ? num(b[k].days) : null; };
    var shortW = function (x, k) { var d = daysOf(x.by_sector, k); return d !== null && d < 7 && val(x.by_sector, k) !== null; };
    var gapW = function (x, k) { return gapIn(k, x.week_start, x.week_end) || shortW(x, k); };
    var valW = function (x, k) { return gapW(x, k) ? null : val(x.by_sector, k); };
    var sumK = function (b, list) { var t = 0; for (var i = 0; i < list.length; i++) { var v = val(b, list[i]); if (v === null) return null; t += v; } return t; };
    var sumW = function (x) { var t = 0; for (var i = 0; i < ks.length; i++) { var v = valW(x, ks[i]); if (v === null) return null; t += v; } return t; };
    var pct = function (a, b) { return (a !== null && b !== null && b > 0) ? (a / b - 1) * 100 : null; };
    var DAY = 86400000, iso = function (s) { return Date.parse(String(s).slice(0, 10) + 'T00:00:00Z'); };
    var gapDays = function (k, from, to) {
      if (!(gaps && Array.isArray(gaps[k]) && from && to)) return 0;
      var n = 0;
      gaps[k].forEach(function (g) {
        if (!g || !(g.from <= to && g.to >= from)) return;
        n += Math.round((Math.min(iso(g.to), iso(to)) - Math.max(iso(g.from), iso(from))) / DAY) + 1;
      });
      return Math.min(7, n);
    };
    var parts = function (x) {
      return ks.map(function (k) {
        return { key: k, value: x.missing ? null : val(x.by_sector, k), gap: gapW(x, k),
          gapDays: Math.max(gapDays(k, x.week_start, x.week_end), shortW(x, k) ? 7 - daysOf(x.by_sector, k) : 0) };
      });
    };
    var part = function (x, ps) {
      if (x.missing) return null;
      var rec = ps.filter(function (p) { return p.value !== null; });
      return rec.length ? { value: rec.reduce(function (t, p) { return t + p.value; }, 0),
        keys: ps.filter(function (p) { return p.value !== null && !p.gap; }).map(function (p) { return p.key; }) } : null;
    };
    var weeks = w.weeks.map(function (x) {
      var v = x.missing ? null : sumW(x), ps = parts(x), p = v === null ? part(x, ps) : null;
      return { start: x.week_start, end: x.week_end, value: v,
        gap: ks.filter(function (k) { return gapW(x, k); }),
        partial: p ? p.value : null, partialKeys: p ? p.keys : [], parts: ps };
    });
    var last = w.weeks[w.weeks.length - 1], prev = w.weeks.length > 1 ? w.weeks[w.weeks.length - 2] : null;
    var bySector = {};
    ks.forEach(function (k) {
      var v = last.missing ? null : valW(last, k), p = (prev && !prev.missing) ? valW(prev, k) : null;
      /* partial — цоорхойтой долоо хоногт БҮРТГЭГДСЭН утга (доод хязгаар «≥»), days — тэр долоо
         хоногт мэдээтэй хоног. Карт «— мэдээлэл алга» биш «≥N · 4/7 хоног» гэж харуулна. */
      var gp = (!last.missing && v === null && gapW(last, k)) ? val(last.by_sector, k) : null;
      var ld = daysOf(last.by_sector, k);
      bySector[k] = { value: v, prev: p, wow: pct(v, p), partial: gp,
        days: gp === null ? null : (ld !== null && ld < 7 ? ld : 7 - gapDays(k, last.week_start, last.week_end)) };
    });
    var total = weeks[weeks.length - 1].value, prevTotal = weeks.length > 1 ? weeks[weeks.length - 2].value : null;
    var cmp = ks.filter(function (k) { return (w.comparable || []).indexOf(k) >= 0; });
    var yCur = (cmp.length && w.ytd) ? sumK(w.ytd.by_sector, cmp) : null;
    var yPrev = (cmp.length && w.prev_ytd) ? sumK(w.prev_ytd.by_sector, cmp) : null;
    /* Оны эхнээс: мэдээтэй хоног хүрээний хоногоос цөөн салбар (УБТЗ-ийн ачаа 298-аас 294) —
       дүн нь доод хязгаар, өмнөх онтой харьцуулалт бодитоос БАГА гарна → дуудагч ил нэрлэнэ. */
    var span = function (p) { return (p && p.from && p.to) ? Math.round((iso(p.to) - iso(p.from)) / DAY) + 1 : null; };
    var shortY = function (p, k) { var d = p ? daysOf(p.by_sector, k) : null, n = span(p); return d !== null && n !== null && d < n; };
    return { keys: ks, weeks: weeks, total: total, prevTotal: prevTotal, wow: pct(total, prevTotal), bySector: bySector,
      ytd: w.ytd ? sumK(w.ytd.by_sector, ks) : null, ytdYear: w.ytd ? w.ytd.year : null,
      yoy: pct(yCur, yPrev), yoyKeys: cmp, weekStart: last.week_start, weekEnd: last.week_end,
      yoyGapKeys: (w.ytd && w.prev_ytd) ? cmp.filter(function (k) { return shortY(w.ytd, k) && !shortY(w.prev_ytd, k); }) : [],
      stale: (w.stale || []).filter(function (k) { return ks.indexOf(k) >= 0; }),
      gapKeys: ks.filter(function (k) { return weeks.some(function (x) { return x.gap.indexOf(k) >= 0; }); }),
      ytdGapKeys: w.ytd ? ks.filter(function (k) { return gapIn(k, w.ytd.from, w.ytd.to) || shortY(w.ytd, k); }) : [],
      lag: weekLag(w.week_end, w.max_date, ks, lastBy) };
  }

  /* Дараагийн долоо хоног яагаад тайланд ороогүйг тайлбарлана: хамгийн сүүлийн огноо
     (max_date) тайлангийн долоо хоногоос хойш байхад тэр долоо хоногийг (Да–Ня) бүрэн
     хамраагүй салбарууд. lastBy {салбар:'YYYY-MM-DD'} (sectors[].passengers_last). */
  function weekLag(weekEnd, maxDate, keys, lastBy) {
    if (!weekEnd || !maxDate || !(maxDate > weekEnd) || !lastBy) return null;
    var add = function (s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    var from = add(weekEnd, 1), to = add(weekEnd, 7);
    /* Дараагийн долоо хоногийг ядаж нэг салбар БҮРЭН хамарсан үед л хоцрогдол — эс бөгөөс тэр
       долоо хоног өөрөө дуусаагүй (2026-10-27: Да 10.26-нд «бүгд 10.25 хүртэл ирсэн тул
       10.26–11.01 бүрдээгүй» гэж явагдаж буй долоо хоногийг хоцрогдол мэт хэлж байв). */
    if (maxDate < to) return null;
    var behind = (keys || []).filter(function (k) { return lastBy[k] && lastBy[k] < to; })
      .map(function (k) { return { key: k, last: lastBy[k] }; });
    return behind.length ? { from: from, to: to, maxDate: maxDate, sectors: behind } : null;
  }

  /* 7 хоногийн баганын Y тэнхлэгийн хүрээ (tests/run.js BE47 — гараар бодсон фикстур).
     ЯАГААД: алхам нь урьд `/50` гэж ХАТУУ бичигдсэн байв. Зорчигчийн мянгад тохирно ч
     ачааны тонн (13–44) дээр хэтэрхий бүдүүн: тэнхлэг -50…50 болж бүх багана дээд гуравны
     нэгд шахагдаж, хөл бичигт "тэнхлэг -50-с эхэлнэ" гэж СӨРӨГ тонн зарладаг байв. Одоо
     алхам нь УТГЫН МАСШТАБААС гарна (buildTrendChart-ийн niceStep-тэй ижил зарчим). */
  function weekAxis(vals) {
    if (!vals || !vals.length) return { base: 0, top: 0, step: 1 };
    var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals);
    /* Бүх утга тэнцүү бол хүрээг утгын ӨӨРИЙНХ нь хэмжээнээс гаргана (0 бол 1) — эс тэгвэл
       span=0 болж алхам тодорхойгүй болно. */
    var span = (mx - mn) || Math.abs(mx) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(span / 2))) || 1;
    var base = Math.floor((mn - span * 0.6) / step) * step;
    var top = Math.ceil((mx + span * 0.15) / step) * step;
    /* Хүн, тонн зэрэг СӨРӨГ БАЙЖ ЧАДАХГҮЙ хэмжигдэхүүнд тэнхлэг 0-ээс (DG): 5,000-аас эхэлсэн
       тэнхлэг 7 хоног хоорондын ялгааг хэтрүүлж, датасэтийн ижил графикаас (0-ээс) өөр
       хэлбэр зурдаг байв. */
    if (mn >= 0) base = 0;
    return { base: base, top: top, step: step };
  }

  /* (5ж) 02-р хэсгийн 7 хоногийн БАГАНА — сайт (index.html buildWeek) ба админы w2p/w2c preview
     ХОЁУЛАА ЭНИЙГ дуудна: ижил утга, өндөр, «≥» дутуу долоо хоног, салбараар давхарласан хэсэг,
     tooltip, легенд. o = {vals, labels, rep (weekReport эсвэл null — агаарын өдрийн багана), unit,
     T(зам, fallback) — content.json site.<зам>, name(салбар) — нэр, color(салбар) — өнгө}.
     - Нийт бүрдээгүй долоо хоног «—» хоосон үлдэхгүй: бүртгэгдсэн дүн «≥» (DG: дутуу ≠ бүтэн);
       тэнхлэгт багтана, дундаж/оргилд ОРОХГҮЙ. Бичлэггүй (null) долоо хоног тэнхлэгт орохгүй.
     - segs — салбар бүр өөрийн өнгөөр (2026-10-27 регресс: «≥» багана тунгалаг тасархай хүрээ
       байсан тул бүтэн мэдээтэй салбарууд байхад ХООСОН мэт уншигдаж байв); дутуу салбар оройд
       зураастай (≥8px: мэдээ бага/алга ч харагдана). rep алга бол segs/legend хоосон.
     - valueShort — гар утсанд (571K); бүтэн тоо ширээний дэлгэц ба tooltip-д. */
  var WEEK_SEG_KEYS = ['air', 'road', 'rail'];
  function weekHatch(c) { return 'background:repeating-linear-gradient(135deg,' + c + ' 0 3px,' + c + '2e 3px 6px);min-height:8px;'; }
  /* ≥10K бүхэл мянгаар (86K) — 8 багана ~31px-д «≥86.4K» гэх 6 тэмдэгт хөрш шошготой давхцдаг байв
     (2026-10-27, 390px); бүтэн тоо tooltip-д. tests/run.js WK. */
  function weekShort(v) {
    return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'K' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v));
  }
  function weekBars(o) {
    var T = typeof o.T === 'function' ? o.T : function (k, fb) { return fb; };
    var name = typeof o.name === 'function' ? o.name : function (k) { return k; };
    var color = typeof o.color === 'function' ? o.color : function () { return '#828EA8'; };
    var rep = o.rep || null, unit = o.unit || '', vals = o.vals || [], labels = o.labels || [];
    var has = function (v) { return v !== null && v !== undefined; };
    var ok = vals.filter(has), hasBars = ok.length > 0;
    var bmax = hasBars ? Math.max.apply(null, ok) : 0;
    var parts = rep ? rep.weeks.map(function (x) { return x.partial; }) : vals.map(function () { return null; });
    var ax = weekAxis(ok.concat(parts.filter(function (v) { return v !== null; })));
    var base = ax.base, top = ax.top;
    var hPct = function (v) { return (top === base ? 50 : (v - base) / (top - base) * 100).toFixed(1) + '%'; };
    var md = function (s) { return String(s || '').slice(5).replace('-', '.'); };
    var nm = function (keys) { return keys.map(name).join(' + '); };
    var noData = T('status.no_data', 'мэдээлэл алга');
    var peakI = vals.indexOf(bmax);
    var segsOf = function (wk, rng) {
      var ps = wk.parts.filter(function (p) { return p.gap || p.value === null || p.value > 0; })
        .sort(function (a, c) {
          return ((a.gap || a.value === null) - (c.gap || c.value === null)) || (WEEK_SEG_KEYS.indexOf(a.key) - WEEK_SEG_KEYS.indexOf(c.key));
        });
      var tot = ps.reduce(function (t, p) { return t + (p.value || 0); }, 0) || 1;
      return ps.map(function (p) {
        var c = color(p.key), dutuu = !!(p.gap || p.value === null);
        return { key: p.key, h: ((p.value || 0) / tot * 100).toFixed(2) + '%', style: dutuu ? weekHatch(c) : 'background:' + c + ';', dutuu: dutuu,
          tip: rng + ' · ' + name(p.key) + ' — ' + (p.value === null ? noData : Math.round(p.value).toLocaleString() + ' ' + unit) +
            (p.gap ? ' · ' + T('week.seg_gap', '7-оос {n} хоногт мэдээ дутуу (эх сурвалжийн цоорхой)').replace('{n}', p.gapDays) : '') };
      });
    };
    var bars = vals.map(function (v, i) {
      var wk = rep ? rep.weeks[i] : null, rng = wk ? md(wk.start) + '–' + md(wk.end) : labels[i], b;
      if (has(v)) b = { label: labels[i], value: (rep ? Math.round(v) : v).toLocaleString(), valueShort: weekShort(v), heightPct: hPct(v) };
      else if (parts[i] !== null) {
        b = { label: labels[i], value: '≥' + Math.round(parts[i]).toLocaleString(), valueShort: '≥' + weekShort(parts[i]),
          heightPct: hPct(parts[i]), partial: true };
      } else b = { label: labels[i], value: '—', valueShort: '—', heightPct: '0%', empty: true };
      b.isPeak = i === peakI;
      b.segs = (wk && b.value !== '—') ? segsOf(wk, rng) : [];
      if (b.partial) {
        var full = wk.partialKeys, miss = rep.keys.filter(function (k) { return full.indexOf(k) < 0; });
        b.tip = rng + ' — ' + b.value + ' ' + unit + (full.length ? ' · ' + nm(full) : '') + ' · ' +
          T('week.partial_tip', '{names}: мэдээ дутуу (эх сурвалжийн цоорхой) — нийт бүрэн биш').replace('{names}', nm(miss));
      } else {
        var gk = wk ? wk.gap : [];
        b.tip = rng + ' — ' + (b.value === '—'
          ? (gk.length ? T('week.gap_tip', '{names}: эх сурвалжийн цоорхой — дутуу').replace('{names}', nm(gk)) : noData)
          : b.value + ' ' + unit);
      }
      return b;
    });
    var yTicks = [0, 0.5, 1].map(function (fr) { return { pct: (fr * 100).toFixed(1) + '%', label: Math.round(base + fr * (top - base)).toLocaleString() }; });
    var avgVal = hasBars ? ok.reduce(function (a, v) { return a + v; }, 0) / ok.length : 0;
    var avg = { pct: (top === base ? 50 : (avgVal - base) / (top - base) * 100).toFixed(1) + '%',
      label: hasBars ? (T('range.average', 'дундаж') + ' ' + Math.round(avgVal).toLocaleString()) : noData };
    var legend = !rep ? [] : WEEK_SEG_KEYS.filter(function (k) { return rep.keys.indexOf(k) >= 0; })
      .map(function (k) { return { key: k, label: name(k), sw: 'background:' + color(k) + ';' }; })
      .concat(bars.some(function (b) { return b.segs.some(function (s) { return s.dutuu; }); })
        ? [{ key: 'gap', label: T('week.legend_gap', 'мэдээ дутуу (эх сурвалжийн цоорхой)'), sw: weekHatch('#828EA8') }] : []);
    return { bars: bars, yTicks: yTicks, avg: avg, base: base, top: top, legend: legend, hasBars: hasBars };
  }

  /* (5ж) Сарын чиг хандлагын МОДЕЛЬ (+3 сарын таамаг, итгэлцлийн зурвас, оргил, дундаж, дутуу
     сарын hollow цэг). Сайтын buildTrendChart() (нүүрийн t05, датасэтийн «чиг хандлага») ба
     админы t05 preview ХОЁУЛАА ЭНИЙГ дуудна — 2026-10-29-өөс өмнө зөвхөн index.html-д байсан тул
     preview өөрийн хялбар шугамыг зурж, сайттай зөрдөг байв. Координат нь 600×170 (pad 46/12/14/26);
     дэлгэцэнд EHChartKit.trendFrame() тогтмол өндөртэй frame болгоно (CH).
     DG: Y тэнхлэг 0-ээс (тоо сөрөг байж чадахгүй), алхам 1·2·2.5·5×10^k; дутуу сар шугам/таамагт
     ОРОХГҮЙ, тусдаа цэг. M = сарын нэрс (content.json site.months), T = stxt(path, fallback). */
  function trendModel(data, off, partial, noForecast, pday, M, T) {
    /* Цуваа ХООСОН байж болно (эх сурвалжаас ирээгүй) — Math.max.apply(null,[]) = -Infinity болж
       нурахаас сэргийлж хавтгай 0 цуваа; «мэдээлэл алга»-г дуудагч тал ӨӨРИЙН шошгоор хэлнэ. */
    if (!Array.isArray(data) || !data.length) data = new Array(12).fill(0);
    off = off || 0;
    var w = 600, h = 170, padL = 46, padR = 12, padT = 14, padB = 26;
    var FC = 3;   /* таамгийн алхам */
    var n = data.length;
    var f1 = function (v) { return v.toFixed(1); };
    var pt = function (p) { return f1(p[0]) + ',' + f1(p[1]); };
    /* Сүүлийн 6 цэгийн шугаман регресс → таамаг */
    var tail = data.slice(-6), tn = tail.length;
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    tail.forEach(function (v, i) { sx += i; sy += v; sxy += i * v; sxx += i * i; });
    var slope = (tn * sxy - sx * sy) / (tn * sxx - sx * sx || 1), intercept = (sy - slope * sx) / tn;
    var fcast = []; for (var fi = 0; fi < FC; fi++) fcast.push(intercept + slope * (tn - 1 + fi + 1));
    var resid = Math.sqrt(tail.reduce(function (a, v, i) { return a + Math.pow(v - (intercept + slope * i), 2); }, 0) / tn) || Math.abs(slope) || 1;
    var all = data.concat(fcast);
    var hi = all.map(function (v, i) { return i < n ? v : v + resid * 1.9 * (i - n + 1); });
    /* Таамгийн доод хязгаар 0-оос доош орохгүй — хавтгай 0 цувааны тэнхлэг −6…6 болж байв */
    var lo = all.map(function (v, i) { return Math.max(0, i < n ? v : v - resid * 1.9 * (i - n + 1)); });
    /* Дутуу сарын цэг — шугам/таамагт ОРОХГҮЙ, гэвч Y хүрээнд багтана */
    var pv = (partial != null && isFinite(partial) && partial >= 0) ? partial : null;
    var rawMax = Math.max.apply(null, hi.concat(pv != null ? [pv] : [])), rawMin = Math.min.apply(null, lo.concat(pv != null ? [pv] : []));
    var lo0 = rawMin >= 0 ? 0 : rawMin, st0 = ((rawMax - lo0) || 1) / 4;
    var mg = Math.pow(10, Math.floor(Math.log10(st0))), fq = st0 / mg;
    var step = (fq <= 1 ? 1 : fq <= 2 ? 2 : fq <= 2.5 ? 2.5 : fq <= 5 ? 5 : 10) * mg;
    var niceMax = Math.ceil(rawMax / step - 1e-9) * step || step;
    var niceMin = rawMin >= 0 ? 0 : Math.floor(rawMin / step) * step;
    var range = (niceMax - niceMin) || 1;
    var stepX = (w - padL - padR) / (n + FC - 1);
    var X = function (i) { return padL + i * stepX; }, Y = function (v) { return padT + (h - padT - padB) * (1 - (v - niceMin) / range); };

    var xy = data.map(function (v, i) { return [X(i), Y(v)]; });
    var line = 'M' + xy.map(pt).join(' L');
    var area = line + ' L' + f1(X(n - 1)) + ',' + f1(h - padB) + ' L' + f1(X(0)) + ',' + f1(h - padB) + ' Z';
    var fxy = [[X(n - 1), Y(data[n - 1])]].concat(fcast.map(function (v, i) { return [X(n + i), Y(v)]; }));
    var fline = 'M' + fxy.map(pt).join(' L');
    var upper = [[X(n - 1), Y(data[n - 1])]].concat(fcast.map(function (v, i) { return [X(n + i), Y(v + resid * 1.9 * (i + 1))]; }));
    var lower = fcast.map(function (v, i) { return [X(n + i), Y(v - resid * 1.9 * (i + 1))]; }).reverse().concat([[X(n - 1), Y(data[n - 1])]]);
    var band = 'M' + upper.concat(lower).map(pt).join(' L') + ' Z';

    var yTicks = [];
    for (var val = niceMin; val <= niceMax + step * 1e-6; val += step) {
      var yv = Y(val);
      yTicks.push({ y: f1(yv), gy: f1(yv), v: val, label: (+val.toFixed(6)).toLocaleString('en-US'), fx: 0, fy: f1(yv - 7) });
    }
    var every = data.length > 8 ? 2 : 1;
    var xTicks = data.map(function (v, i) { return { x: f1(X(i)), label: M[i + off] || '', fx: f1(X(i) - 19), fy: f1(h - padB + 6) }; })
      .filter(function (_, i) { return i % every === 0; });
    /* Цэг бүр ЯГ ТЭР сарын тоотой (HV: «Сар — тоо») */
    var dotPts = xy.map(function (p, i) {
      return { cx: f1(p[0]), cy: f1(p[1]), r: '2.6', dash: 'none',
        tip: (M[i + off] ? M[i + off] + ' — ' : '') + Math.round(data[i]).toLocaleString('en-US') };
    });

    var pi = data.indexOf(Math.max.apply(null, data));
    var peak = { cx: f1(X(pi)), cy: f1(Y(data[pi])),
      lx: f1(Math.min(Math.max(X(pi) - 58, padL + 2), w - padR - 120)), ly: f1(Math.max(Y(data[pi]) - 38, 2)),
      label: (M[pi + off] || '') + ' · ' + T('chart.peak', 'оргил'), value: data[pi].toLocaleString() };
    var fcLabel = { x: f1(X(n) + 4), y: f1(padT + 4),
      text: T('chart.forecast_prefix', 'AI прогноз +') + FC + ' ' + T('chart.forecast_suffix', 'сар'),
      delta: ((fcast[FC - 1] - data[n - 1]) / (data[n - 1] || 1) * 100) };
    var avgVal = data.reduce(function (a, v) { return a + v; }, 0) / data.length, avgY = f1(Y(avgVal));
    var pY = pv != null ? Y(pv) : 0;
    /* Дутуу сар = ОДООГИЙН сар. pday — эх сурвалжийн мэдээ ХҮРСЭН өдөр ({day,dim}); мэдэгдвэл
       түүгээр (ETL хоцорвол өнөөдрийн огноо «1–26» гэж худал хэлнэ), эс бөгөөс УБ-ийн өнөөдөр. */
    var upToDay = (pday && pday.day > 0) ? pday.day : new Date(Date.now() + 8 * 3600000).getUTCDate();
    var pDays = (pday && pday.day > 0 && pday.dim > 0) ? ' · ' + T('chart.partial_days', '{d}/{m} хоногоор').replace('{d}', pday.day).replace('{m}', pday.dim) : '';
    var pAvg = (pv != null && upToDay > 0) ? ' · ' + T('chart.partial_daily_avg', 'өдрийн дундаж') + ' ' + Math.round(pv / upToDay).toLocaleString('en-US') : '';
    var partialLabel = pv != null ? (M[n + off] || '') + ' (1–' + upToDay + ' ' + T('chart.partial_upto', 'хүртэл') + pDays + '): ' +
      Math.round(pv).toLocaleString('en-US') + ' · ' + T('chart.partial_mark', 'дутуу') + ' ' + T('chart.partial_word', 'сар (хэсэгчилсэн)') + pAvg +
      ' · ' + T('chart.partial_joins', 'сар дуусахад шугамд нэмэгдэнэ') : '';
    /* Богино шошго (легендэд); бүтэн текст нь tooltip-д. «1–N» — бага цэгийг «уналт» гэж уншихаас сэргийлнэ */
    var partialShort = pv != null ? (M[n + off] || '') + ' 1–' + upToDay + ' · ' + Math.round(pv).toLocaleString('en-US') + ' · ' + T('chart.partial_mark', 'дутуу') : '';
    /* Легенд — зөвхөн ЗУРАГДСАН цувааг нэрлэнэ */
    var legend = [{ key: 'actual', label: T('chart.legend_actual', 'Бодит (бүтэн сар)'), lineStyle: 'solid' }]
      .concat(pv != null ? [{ key: 'partial', label: T('chart.legend_partial', 'Хэсэгчилсэн (одоогийн сар)'), lineStyle: 'dotted' }] : [])
      .concat(noForecast ? [] : [{ key: 'forecast', label: T('chart.legend_forecast', 'Таамаг'), lineStyle: 'dashed' }]);
    /* noForecast — прогнозын шугам/зурвасгүй (загварын таамгийг бодит дата мэт харуулахгүй) */
    return { line: line, area: area, fline: noForecast ? '' : fline, band: noForecast ? '' : band, yTicks: yTicks, xTicks: xTicks,
      dotPts: dotPts, peak: peak, fcLabel: fcLabel, legend: legend,
      hasPartial: pv != null, partialCx: f1(X(n)), partialCy: f1(pY),
      partialLy: f1(Math.max(pY - 9, padT + 8)), partialLabel: partialLabel, partialShort: partialShort,
      partialFx: f1(X(n) - 90), partialFy: f1(Math.max(pY - 9, padT + 8) - 7.6),
      fcSplitX: f1(X(n - 1)), fcEndX: f1(X(n + FC - 1)),
      fcDeltaLabel: (fcLabel.delta > 0 ? '+' : '') + fcLabel.delta.toFixed(1) + '%',
      avgY: avgY, avgYLabel: Math.max(0, avgY - 15).toFixed(1), avgLabel: T('range.average', 'дундаж') + ' ' + Math.round(avgVal).toLocaleString(),
      w: w, h: h, padL: padL, padR: padR, padT: padT, padB: padB, axisX1: padL, axisX2: w - padR, axisY: f1(h - padB) };
  }

  /* (5з) 06-р хэсгийн индекс (i06/r06) — авто тээврийн зорчигчийн сарын цуваа (roadPax түүх),
     `year` оны 1…`months` сар. Эх сурвалж ЦОНХООР ачаалагддаг тул дутуу сарын НИЙТИЙГ бүтэн
     сартай харьцуулбал худал уналт гарна: хамрагдсан хоногийн дундаж × сарын хоног = сарын
     эквивалент, partial=true (hollow цэг, tooltip-д N/M хоног). Хамрагдсан хоног 0 бол v=null —
     шугам тасарна, тоо зохиохгүй. Сайт (index.html roadPaxMonthSeries) ба админы i06 preview
     ХОЁУЛАА ЭНИЙГ дуудна. tests/run.js RI бүлэг. */
  function roadPaxMonthSeries(h, year, months) {
    if (!h || h.status !== 'ok' || !Array.isArray(h.months) || !year || !(months > 0)) return null;
    var by = {};
    h.months.forEach(function (m) { if (m && m.month) by[m.month] = m; });
    var out = [];
    for (var i = 0; i < months; i++) {
      var m = by[year + '-' + String(i + 1).padStart(2, '0')];
      var dim = (m && +m.days_in_month) || new Date(Date.UTC(year, i + 1, 0)).getUTCDate();
      var days = m ? (+m.days || 0) : 0;
      if (days <= 0) { out.push({ v: null, partial: false, days: 0, dim: dim }); continue; }
      if (days >= dim) out.push({ v: +m.passengers || 0, partial: false, days: days, dim: dim });
      else out.push({ v: (m.passengers_covered != null ? +m.passengers_covered : (+m.passengers || 0)) / days * dim, partial: true, days: days, dim: dim });
    }
    return out.some(function (x) { return x.v != null; }) ? out : null;
  }

  var api = {
    weekReport: weekReport, weekLag: weekLag, weekAxis: weekAxis, weekBars: weekBars,
    roadPaxSeries: roadPaxSeries, trendModel: trendModel, roadPaxMonthSeries: roadPaxMonthSeries,
    airPaxSplit: airPaxSplit, norm: norm, airFlightKind: airFlightKind, KIND_LABEL: KIND_LABEL, AIR_KIND: AIR_KIND,
    SECTOR_PAIRS: SECTOR_PAIRS, ratioSanity: ratioSanity, isCurrentMonth: isCurrentMonth, unitTitleOk: unitTitleOk,
    filterDimensions: filterDimensions, missingFilterCols: missingFilterCols,
    filterColumns: filterColumns, rowMatchesCols: rowMatchesCols, periodSpan: periodSpan, weekSpan: weekSpan, chartPeriod: chartPeriod,
    stDailyRows: stDailyRows, stDailyIndex: stDailyIndex, homeRange: homeRange, HOME_PRESETS: HOME_PRESETS,
    rangeCompare: rangeCompare, periodStrip: periodStrip, sparkPaths: sparkPaths, isoAdd: isoAdd, isoDiff: isoDiff,
    periodCell: periodCell, bucketWord: bucketWord, shareText: shareText, shareArcs: shareArcs,
    sectorShare: sectorShare, heroPax: heroPax, condActive: condActive, condMatch: condMatch, dayOf: dayOf, facetSuggest: facetSuggest, numOf: numOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EHGlossary = api;
})(typeof window !== 'undefined' ? window : globalThis);

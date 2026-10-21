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
     → [{index, name, values, counts}] (values: датаас, trim + давхардалгүй, өсөхөөр;
     counts[утга] = мөрийн тоо — олон утгатай баганыг давтамжаар товчлоход). */
  function filterColumns(head, types, rows, opts) {
    opts = opts || {};
    var maxDistinct = opts.maxDistinct || 200, skip = {};
    (opts.exclude || []).forEach(function (n) { skip[n] = true; });
    var out = [], n = (head || []).length;
    for (var i = 0; i < n; i++) {
      var t = (types || [])[i], name = head[i];
      if (skip[name] || (t !== 'enum' && t !== 'string')) continue;
      var vals = [], filled = 0, counts = {};
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
      out.push({ index: i, name: name, values: vals, counts: counts });
    }
    return out;
  }

  /* Мөр баганын сонголтод таарах эсэх. sel = {баганын индекс: утга}; хоосон
     утга = "Бүгд". filterColumns-тэй ижил cellText-ээр харьцуулна. */
  function rowMatchesCols(row, sel) {
    for (var k in (sel || {})) {
      if (!Object.prototype.hasOwnProperty.call(sel, k) || !sel[k]) continue;
      if (cellText(row, k) !== sel[k]) return false;
    }
    return true;
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

  var api = {
    airPaxSplit: airPaxSplit, norm: norm, airFlightKind: airFlightKind, KIND_LABEL: KIND_LABEL, AIR_KIND: AIR_KIND,
    SECTOR_PAIRS: SECTOR_PAIRS, ratioSanity: ratioSanity, isCurrentMonth: isCurrentMonth, unitTitleOk: unitTitleOk,
    filterDimensions: filterDimensions, missingFilterCols: missingFilterCols,
    filterColumns: filterColumns, rowMatchesCols: rowMatchesCols, periodSpan: periodSpan, weekSpan: weekSpan
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EHGlossary = api;
})(typeof window !== 'undefined' ? window : globalThis);

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

  var api = {
    airPaxSplit: airPaxSplit, norm: norm, airFlightKind: airFlightKind, KIND_LABEL: KIND_LABEL, AIR_KIND: AIR_KIND,
    SECTOR_PAIRS: SECTOR_PAIRS, ratioSanity: ratioSanity, isCurrentMonth: isCurrentMonth, unitTitleOk: unitTitleOk
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EHGlossary = api;
})(typeof window !== 'undefined' ? window : globalThis);

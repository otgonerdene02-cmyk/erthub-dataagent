/* ErtHub — АМЬД FEED-ИЙН ТЕСТИЙН ФИКСТУР (зөвхөн тест/аудитад).

   Яагаад: CI болон локал аудитад etransport-backend (portal.mrt.gov.mn) ба
   нислэгийн feed (github.io) хүрэхгүй үед датасэтийн дэлгэрэнгүй хуудас
   "мэдээлэл алга" төлөвтэй зурагдаж, график/хүснэгт/картын мөрүүд ОГТ
   үүсдэггүй. Тиймээс layout-audit "тэгш бус өндөртэй карт", "хагас өргөнтэй
   хүснэгт" зэргийг хэзээ ч барьж чаддаггүй байв (галт тэрэгний хуудас
   өгөгдөлтэй үед эвдэрхий харагдаж байсан ч аудит ногоон).

   Энэ файл хуудасны ӨМНӨ ачаалагдаж window.fetch-ийг ороож, дээрх хоёр эх
   сурвалжийн хариуг ТОГТМОЛ (детерминист) фикстураар өгнө. Амьд сайтад
   ХЭЗЭЭ Ч ачаалагдахгүй — зөвхөн `?fx=1` хаягаар тест сервер (layout-audit,
   `node scripts/serve.js --fixtures`) тарьж өгнө.

   Тоонууд нь ЗОХИОМОЛ туршилтын утга — сайт дээр харагдахгүй, зөвхөн
   харагдацын бүтцийг (мөр, багана, өндөр) шалгахад хэрэглэнэ. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__EH_FEED_FIXTURES__) return;
  window.__EH_FEED_FIXTURES__ = true;

  var pad = function (n) { return String(n).padStart(2, '0'); };
  var dim = function (y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  /* УБ цагийн өнөөдөр — сүүлийн сар нь ДУТУУ (явагдаж буй) сар байна */
  var ub = new Date(Date.now() + 8 * 3600000);
  var Y = ub.getUTCFullYear(), M = ub.getUTCMonth() + 1, D = ub.getUTCDate();
  /* Өмнөх оны 1-р сараас өнөөдрийн сар хүртэлх сарууд */
  function months() {
    var out = [], y = Y - 1, m = 1;
    while (y < Y || (y === Y && m <= M)) {
      out.push({ y: y, m: m, key: y + '-' + pad(m), partial: y === Y && m === M,
        days: (y === Y && m === M) ? Math.max(1, D - 1) : dim(y, m), dim: dim(y, m) });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  var wave = function (i, base, amp) { return Math.round(base + amp * Math.sin(i * 0.9) + (i * 37) % 997); };

  function railHistory() {
    return { status: 'ok',
      months: months().map(function (x, i) {
        var pax = wave(i, 125000, 30000), k = x.partial ? x.days / x.dim : 1;
        pax = Math.round(pax * k);
        var intl = Math.round(pax * 0.02);
        return { month: x.key, passengers: pax, trips: Math.round((340 + i) * k), domestic: pax - intl,
          international: intl, days: x.days, days_in_month: x.dim };
      }),
      /* Бодит хариутай ижил ХЭМЖЭЭ (2026-10: 24 чиглэл, 6 суваг, 2 төрөл) —
         урт жагсаалт мөрийн өндрийг хэрхэн түлхэхийг аудит харах ёстой */
      by_route: ['ЗАМЫН-ҮҮД', 'СҮХБААТАР', 'ЭРДЭНЭТ', 'САЙНШАНД', 'ДАРХАН', 'ЧОЙР', 'БАГАНУУР', 'ЗҮҮНБАЯН', 'ШАРЫН ГОЛ',
        'ЭРЭЭН', 'БЭЭЖИН', 'МОСКВА', 'ИРКУТСК', 'УЛААН-ҮДЭ', 'ХӨХХОТ', 'ТАЛ', 'БОР-ӨНДӨР', 'СЭЛЭНГЭ', 'ХАРХОРИН',
        'МАНДАЛ', 'ЖАРГАЛАНТ', 'ДОРНОГОВЬ', 'ТЭРЭЛЖ', 'ХАНГАЙ'].map(function (r, i) {
        return { route: 'УЛААНБААТАР - ' + r, trips: 680 - i * 25, passengers: 580000 - i * 23000 }; }),
      by_channel: [{ channel: 'kass', passengers: 1285500 }, { channel: 'kiosk', passengers: 17153 },
        { channel: 'web', passengers: 650209 }, { channel: 'sms', passengers: 223951 },
        { channel: 'phone', passengers: 209889 }, { channel: 'tapa', passengers: 493300 }],
      channel_covered: 2880002,
      by_type: [{ type: 'ОН', trips: 6811, passengers: 2810144 }, { type: 'ОУ', trips: 1132, passengers: 69858 }] };
  }
  function railSummary() {
    return { status: 'ok', unit: 'зорчигч',
      data: railHistory().months.map(function (m) {
        return { month: m.month + '-01T00:00:00.000Z', total_volume: String(m.passengers) };
      }).reverse() };
  }
  var STATIONS = [['Улаанбаатар', '01'], ['Замын-Үүд', '02'], ['Сүхбаатар', '03'], ['Дархан', '04'], ['Эрдэнэт', '05'], ['Чойр', '06']];
  function wagonLoading() {
    /* Сүүлийн станц тухайн хоногт ЗӨВХӨН буулгалттай (loaded=0) — бодит хариунд
       ийм станц байдаг; «Төлөв» багана 2 утгатай болж шүүлтийн бүрдлийн
       шалгалт (FL11) хоосон өнгөрөхгүй. */
    var bs = STATIONS.map(function (s, i) { var z = i === STATIONS.length - 1;
      return { station: s[0], code: s[1], loaded: z ? 0 : 400 - i * 55, unloaded: 360 - i * 40,
        loaded_domestic: z ? 0 : 300 - i * 40, loaded_foreign: z ? 0 : 100 - i * 15 }; });
    return { status: 'ok', date: Y + '-' + pad(M) + '-' + pad(Math.max(1, D - 1)), unit: 'вагон',
      count: bs.reduce(function (a, r) { return a + r.loaded; }, 0),
      unloaded_count: bs.reduce(function (a, r) { return a + r.unloaded; }, 0),
      station_count: bs.length, by_station: bs };
  }
  function wagonHistory() {
    return { status: 'ok',
      months: months().map(function (x, i) {
        var ld = wave(i, 30000, 6000);
        return { month: x.key, loaded: ld, unloaded: Math.round(ld * 0.9), loaded_domestic: Math.round(ld * 0.7),
          loaded_foreign: Math.round(ld * 0.3), days: x.days };
      }),
      by_station: STATIONS.map(function (s, i) { return { station: s[0], code: s[1], loaded: 90000 - i * 12000, unloaded: 80000 - i * 10000 }; }),
      by_wagon_type: [{ type: 'covered', loaded: 120000, unloaded: 100000 }, { type: 'gondola', loaded: 90000, unloaded: 85000 },
        { type: 'tank', loaded: 50000, unloaded: 48000 }, { type: 'other', loaded: 20000, unloaded: 19000 }] };
  }
  var AIMAG = ['Улаанбаатар', 'Дархан-Уул', 'Орхон', 'Сэлэнгэ', 'Төв', 'Дорнод', 'Хэнтий', 'Өмнөговь'];
  var CATS = function (k) { return { general: 30 * k, brake: 20 * k, steering: 8 * k, light: 15 * k, emission: 25 * k, noise: 5 * k }; };
  function roadInspections() {
    var byDay = [];
    for (var i = 29; i >= 1; i--) {
      var d = new Date(Date.UTC(Y, M - 1, D - i));
      byDay.push({ date: d.toISOString().slice(0, 10), count: 900 + (i * 53) % 300, failed: 90 + (i * 17) % 60 });
    }
    return { status: 'ok', date: byDay[byDay.length - 1].date, unit: 'үзлэг', count: 1040, passed: 930, passed_minor: 40,
      failed: 110, vehicle_count: 1010, unchecked_emission: 12, failed_by_category: CATS(1), by_day: byDay,
      /* Сүүлийн аймагт тэнцээгүй үзлэг алга (failed=0) — «Төлөв» 2 утгатай (FL11) */
      by_aimag: AIMAG.map(function (a, i) { return { aimag: a, count: 400 - i * 40, failed: i === AIMAG.length - 1 ? 0 : 40 - i * 4 }; }) };
  }
  function roadHistory() {
    return { status: 'ok',
      months: months().map(function (x, i) {
        var t = wave(i, 26000, 5000);
        return { month: x.key, days: x.days, days_in_month: x.dim, partial: x.partial, total: t,
          failed: Math.round(t * 0.11), passed: Math.round(t * 0.89), failed_by_category: CATS(20 + i) };
      }),
      by_aimag: AIMAG.map(function (a, i) { return { aimag: a, total: 90000 - i * 9000, failed: i === AIMAG.length - 1 ? 0 : 9000 - i * 800 }; }),
      by_weekday: [0, 1, 2, 3, 4, 5, 6].map(function (w) { return { weekday: w, days: 60, total: 50000 + w * 3000, avg: 830 + w * 50 }; }) };
  }
  /* Ачаа тээврийн мэдээ (/api/sectors/rail/freight/:org/history) — УБТЗ 4 чиглэл,
     МТЗ зөвхөн экспорт + дотоод (бодит хариутай ижил бүтэц). УБТЗ-ийн өртөө 14,
     ачаа 15 — урт жагсаалт мөрийн өндрийг хэрхэн түлхэхийг аудит харна. */
  var FR_ST = ['Улаанбаатар', 'Дархан-II', 'Замын-Үүд МЧ-1', 'Сүхбаатар', 'Эрдэнэт', 'Багахангай', 'Шарын гол', 'Салхит',
    'Айраг', 'Сайншанд', 'Зүүнхараа', 'Бор-Өндөр', 'Тэрэлж', 'Аршаант'];
  var FR_CG = ['Нүүрс', 'Төмрийн хүдэр', 'Медь /конц/', 'Нефть, нефтийн бүтээгдэхүүн', 'Барилгын ачаа', 'Цемент', 'Үр тариа',
    'Хүнсний ачаа', 'Мод, модон материал', 'Химийн бордоо', 'Жонш', 'Хар төмөр', 'Их даацын ачаатай чингэлэг', 'Машин механизм', 'Бусад'];
  function freightHistory(org) {
    var mtz = org === 'mtz';
    var dirs = mtz ? ['export', 'domestic'] : ['transit', 'export', 'import', 'domestic'];
    var all = ['transit', 'export', 'import', 'domestic'];
    var row = function (o, k) { all.forEach(function (d) {
      var on = dirs.indexOf(d) >= 0, t = on ? Math.round(k * (d === 'export' ? 1.6 : d === 'domestic' ? 1.2 : 0.6)) : 0;
      o[d + '_tonnes'] = t; o[d + '_wagons'] = on ? Math.round(t / 42) : 0; });
      o.tonnes = all.reduce(function (a, d) { return a + o[d + '_tonnes']; }, 0);
      o.wagons = all.reduce(function (a, d) { return a + o[d + '_wagons']; }, 0); return o; };
    var base = mtz ? 120000 : 900000;
    return { status: 'ok', org: org, unit: 'тонн', directions: all,
      months: months().map(function (x, i) {
        var k = wave(i, base, base * 0.2) * (x.partial ? x.days / x.dim : 1);
        return row({ month: x.key, days: x.days, days_in_month: x.dim, rows: mtz ? 90 : 2600,
          last_date: x.key + '-' + pad(x.days) }, k); }),
      by_station: (mtz ? ['Цогтцэций', 'Төмөртэй'] : FR_ST).map(function (s, i) {
        return row({ station: s, rows: 900 - i * 50 }, base * 6 / (i + 1)); }),
      by_cargo: (mtz ? FR_CG.slice(0, 6) : FR_CG).map(function (c, i) {
        return row({ cargo: c, rows: 700 - i * 40 }, base * 5 / (i + 1.5)); }) };
  }
  /* НЭГТГЭЛ (/api/sectors/rail/freight/all/history) — УБТЗ + МТЗ-ийн нийлбэр (backend-ийн
     VIEW-тэй ижил: сар/өртөө/ачаа нь хоёулангийнх) + by_org, org_months, weekly (сүүлийн
     бүтэн 8 долоо хоног, Даваа–Ням). */
  function freightTotal() {
    var u = freightHistory('ubtz'), m = freightHistory('mtz');
    var all = ['transit', 'export', 'import', 'domestic'];
    var keys = all.reduce(function (a, d) { return a.concat([d + '_tonnes', d + '_wagons']); }, ['tonnes', 'wagons', 'rows']);
    var merge = function (a, b) { var o = Object.assign({}, a); keys.forEach(function (k) { o[k] = (+a[k] || 0) + (+(b && b[k]) || 0); }); return o; };
    var byName = function (arr, nk) { var idx = {}, out = []; arr.forEach(function (r) {
      if (idx[r[nk]]) { var j = out.indexOf(idx[r[nk]]); out[j] = idx[r[nk]] = merge(idx[r[nk]], r); }
      else { idx[r[nk]] = Object.assign({}, r); out.push(idx[r[nk]]); } });
      return out.sort(function (a, b) { return b.tonnes - a.tonnes; }); };
    var sum = function (arr) { return arr.reduce(function (a, r) { return merge(a, r); }, {}); };
    var orgs = [['УБТЗ', 'Улаанбаатар төмөр зам ХНН', u], ['МТЗ', 'Монголын төмөр зам ТӨХК', m]];
    var lastDay = new Date(Date.UTC(Y, M - 1, D - 1));
    var we = new Date(lastDay.getTime() - (lastDay.getUTCDay() % 7) * 864e5);   // Ням ≤ сүүлийн өдөр
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    var weeks = [];
    for (var i = 7; i >= 0; i--) {
      var ws = new Date(we.getTime() - (i * 7 + 6) * 864e5), wend = new Date(we.getTime() - i * 7 * 864e5);
      var byOrg = {}, w = { week_start: iso(ws), week_end: iso(wend), missing: false, days: 7, rows: 700 };
      all.forEach(function (d) { w[d + '_tonnes'] = 0; w[d + '_wagons'] = 0; });
      orgs.forEach(function (o, k) {
        var base = k ? 26000 : 230000, t = 0, wg = 0;
        all.forEach(function (d) {
          var on = !k || d === 'export' || d === 'domestic';
          var v = on ? Math.round(wave(i + k, base, base * 0.15) * (d === 'domestic' ? 0.55 : d === 'export' ? 0.3 : 0.075)) : 0;
          w[d + '_tonnes'] += v; w[d + '_wagons'] += Math.round(v / 42); t += v; wg += Math.round(v / 42); });
        byOrg[o[0]] = { tonnes: t, wagons: wg }; });
      w.tonnes = all.reduce(function (a, d) { return a + w[d + '_tonnes']; }, 0);
      w.wagons = all.reduce(function (a, d) { return a + w[d + '_wagons']; }, 0);
      w.by_org = byOrg; weeks.push(w);
    }
    var ytdOrg = function (f) { var b = {}, t = 0; orgs.forEach(function (o, k) { var v = Math.round((k ? 1.1e6 : 2.6e7) * f); b[o[0]] = { tonnes: v, wagons: Math.round(v / 42) }; t += v; });
      return { by_org: b, tonnes: t, wagons: Math.round(t / 42) }; };
    var y = +iso(we).slice(0, 4);
    return { status: 'ok', org: 'all', unit: 'тонн', directions: all, view: 'gold.rail_freight_total',
      months: u.months.map(function (x) { var mm = m.months.filter(function (z) { return z.month === x.month; })[0];
        var o = merge(x, mm); o.days = x.days; o.days_in_month = x.days_in_month; o.last_date = x.last_date; o.month = x.month; return o; }),
      by_station: u.by_station.concat(m.by_station),
      by_cargo: byName(u.by_cargo.concat(m.by_cargo), 'cargo'),
      by_org: orgs.map(function (o) { var t = sum(o[2].months); return Object.assign({ org: o[0], name: o[1],
        first_date: o[2].months[0].month + '-01', last_date: o[2].months[o[2].months.length - 1].last_date }, t); }),
      org_months: orgs.reduce(function (a, o) { return a.concat(o[2].months.map(function (x) {
        return { month: x.month, org: o[0], rows: x.rows, tonnes: x.tonnes, wagons: x.wagons }; })); }, []),
      weekly: { max_date: iso(lastDay), week_end: iso(we), weeks: weeks,
        ytd: Object.assign({ year: y, from: y + '-01-01', to: iso(we) }, ytdOrg(1)),
        prev_ytd: Object.assign({ year: y - 1, from: (y - 1) + '-01-01', to: (y - 1) + iso(we).slice(4) }, ytdOrg(0.88)) } };
  }
  /* САЛБАРЫН НЭГТГЭЛ (/api/sectors/total/history, gold.sector_daily_total) — агаар
     (flights фикстураас), төмөр зам (зорчигч = railHistory, ачаа = freightTotal); авто —
     эх сурвалжгүй (толинд бий, мөргүй). weekly — хэмжүүр бүрээр сүүлийн бүтэн 8 долоо хоног. */
  var ST_NAMES = { air: 'Агаарын тээвэр', road: 'Авто тээвэр', rail: 'Төмөр зам' };
  function sectorTotal(u) {
    var mf = (u || '').match(/[?&]from=(\d{4}-\d{2})/), mt = (u || '').match(/[?&]to=(\d{4}-\d{2})/);
    var rows = [], idx = {};
    var row = function (month, sec, dimv) { var k = month + '|' + sec; if (!idx[k]) { idx[k] = { month: month, sector: sec,
      days_in_month: dimv, passengers: null, freight_tonnes: null, passenger_days: 0, freight_days: 0, passenger_last: null, freight_last: null };
      rows.push(idx[k]); } return idx[k]; };
    [Y - 1, Y].forEach(function (y) {
      var by = {};
      flights(y).flights.forEach(function (f) { var k = y + '-' + pad(f.month);
        var o = by[k] || (by[k] = { p: 0, c: 0, d: {}, ld: 0 }); o.p += f.pax; o.c += (f.cargoKg || 0) / 1000; o.d[f.day] = 1; o.ld = Math.max(o.ld, f.day); });
      Object.keys(by).forEach(function (k) { var o = by[k], r = row(k, 'air', dim(+k.slice(0, 4), +k.slice(5, 7)));
        var nd = Object.keys(o.d).length;
        r.passengers = o.p; r.passenger_days = nd; r.passenger_last = k + '-' + pad(o.ld);
        r.freight_tonnes = Math.round(o.c * 1000) / 1000; r.freight_days = nd; r.freight_last = r.passenger_last; });
    });
    railHistory().months.forEach(function (m) { var r = row(m.month, 'rail', m.days_in_month);
      r.passengers = m.passengers; r.passenger_days = m.days; r.passenger_last = m.month + '-' + pad(m.days); });
    freightTotal().months.forEach(function (m) { var r = row(m.month, 'rail', m.days_in_month);
      r.freight_tonnes = m.tonnes; r.freight_days = m.days; r.freight_last = m.last_date; });
    rows.sort(function (a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : (a.sector < b.sector ? -1 : 1); });
    if (mf || mt) rows = rows.filter(function (r) { return (!mf || r.month >= mf[1]) && (!mt || r.month <= mt[1]); });
    var edge = function (sec, k, first) { var rs = rows.filter(function (r) { return r.sector === sec && r[k] !== null; });
      if (!rs.length) return null; var r = first ? rs[0] : rs[rs.length - 1];
      return first ? r.month + '-01' : r[k === 'passengers' ? 'passenger_last' : 'freight_last']; };
    var sectors = ['air', 'road', 'rail'].map(function (s) { var pl = edge(s, 'passengers'), fl = edge(s, 'freight_tonnes');
      var tot = function (k) { var rs = rows.filter(function (r) { return r.sector === s && r[k] !== null; });
        return rs.length ? rs.reduce(function (a, r) { return a + r[k]; }, 0) : null; };
      return { sector: s, name: ST_NAMES[s], passengers_first: edge(s, 'passengers', true), passengers_last: pl,
        freight_first: edge(s, 'freight_tonnes', true), freight_last: fl, has_passengers: !!pl, has_freight: !!fl,
        passengers: tot('passengers'), freight_tonnes: tot('freight_tonnes') }; });
    var out = { sector: 'total', metric: 'sector_total_history', status: rows.length ? 'ok' : 'no_data', view: 'gold.sector_daily_total',
      units: { passengers: 'зорчигч', freight_tonnes: 'тонн' }, sectors: sectors, months: rows };
    if (!mf && !mt) {
      var lastDay = new Date(Date.UTC(Y, M - 1, D - 1));
      var we = new Date(lastDay.getTime() - (lastDay.getUTCDay() % 7) * 864e5);
      var iso = function (d) { return d.toISOString().slice(0, 10); };
      var y = +iso(we).slice(0, 4);
      var wk = function (k, base) {
        var weeks = [];
        for (var i = 7; i >= 0; i--) {
          var ws = new Date(we.getTime() - (i * 7 + 6) * 864e5), wend = new Date(we.getTime() - i * 7 * 864e5);
          var b = { air: { value: wave(i, base[0], base[0] * 0.12), days: 7 }, rail: { value: wave(i + 2, base[1], base[1] * 0.1), days: 7 } };
          weeks.push({ week_start: iso(ws), week_end: iso(wend), missing: false, value: b.air.value + b.rail.value, by_sector: b });
        }
        var ytd = { air: { value: base[0] * 41, days: 280 }, rail: { value: base[1] * 41, days: 280 } };
        var prev = { air: { value: Math.round(base[0] * 38.5), days: 280 }, rail: { value: Math.round(base[1] * 40.2), days: 280 } };
        return { measure: k, max_date: iso(lastDay), ref_date: iso(lastDay), week_end: iso(we), sectors: ['air', 'rail'], stale: [], weeks: weeks,
          ytd: { year: y, from: y + '-01-01', to: iso(we), value: ytd.air.value + ytd.rail.value, by_sector: ytd },
          prev_ytd: { year: y - 1, from: (y - 1) + '-01-01', to: (y - 1) + iso(we).slice(4), by_sector: prev },
          comparable: ['air', 'rail'], yoy_cur: ytd.air.value + ytd.rail.value, yoy_prev: prev.air.value + prev.rail.value };
      };
      out.weekly = { passengers: wk('passengers', [28000, 29000]), freight_tonnes: wk('freight_tonnes', [180, 520000]) };
    }
    return out;
  }
  function flightsIndex() { return { years: [{ year: Y }, { year: Y - 1 }] }; }
  function flights(year) {
    var carr = ['MIAT', 'Airchina', 'Hunnu Air', 'Aero Mongolia'];
    var cities = [['Хонг Конг', 'ХонгКонг', 'Ази', 'ОУ'], ['Турк', 'Истанбул', 'Европ', 'ОУ'], ['Япон', 'Токио/Нарита', 'Ази', 'ОУ'],
      ['Хятад', 'Бээжин', 'Ази', 'ОУ'], ['Монгол', 'Ханбумбат', 'Монгол', 'ОН'], ['Герман', 'Франкфурт', 'Европ', 'ОУ']];
    var out = [], id = 90000, lastM = year === Y ? M : 12;
    for (var mo = 1; mo <= lastM; mo++) {
      var lastD = (year === Y && mo === M) ? Math.max(1, D - 1) : 28;
      for (var d = 1; d <= lastD; d++) for (var k = 0; k < 2; k++) {
        var c = cities[(mo + d + k) % cities.length];
        out.push({ year: year, month: mo, day: d, unixtimestamp: Date.UTC(year, mo - 1, d, k) / 1000,
          carr: carr[(d + k) % 4], flight: 'OM' + (100 + ((d * 7 + k) % 900)), city: c[1], cntry: c[0],
          dir: k % 2 ? '1' : '2', category: 'P', pax: 120 + ((d * 13 + k * 7) % 140), cargoKg: (d * 131) % 2400,
          id: String(id++), ou: c[3], flightType: 'Тогтмол', region: c[2], continent: c[2] === 'Монгол' ? 'Ази' : c[2] });
      }
    }
    return { flights: out };
  }

  /* /history?from=YYYY-MM-DD&to=YYYY-MM-DD — backend шиг сараар шүүнэ (сайт нь хүрээний
     хариуны сарын нийлбэр = сонгосон сарын нийлбэр байхыг шалгадаг; таарахгүй бол задаргааг
     харуулахгүй). Задаргааг (аймаг/станц/гариг) хүрээний нийлбэрт ЯГ тааруулна. */
  function ranged(u, h, key, parts) {
    var mf = u.match(/[?&]from=(\d{4}-\d{2})/), mt = u.match(/[?&]to=(\d{4}-\d{2})/);
    if (!mf && !mt) return h;
    var f = mf ? mf[1] : '0000-00', t = mt ? mt[1] : '9999-99';
    h.months = h.months.filter(function (m) { return m.month >= f && m.month <= t; });
    var tot = h.months.reduce(function (a, m) { return a + (+m[key] || 0); }, 0);
    (parts || []).forEach(function (pk) {
      var arr = h[pk[0]]; if (!arr || !arr.length) return;
      var w = arr.reduce(function (a, x) { return a + (+x[pk[1]] || 0); }, 0) || 1, acc = 0;
      arr.forEach(function (x, i) {
        var v = i === arr.length - 1 ? tot - acc : Math.round(tot * (+x[pk[1]] || 0) / w);
        acc += v; x[pk[1]] = v;
      });
    });
    return h;
  }
  /* /api/datasets/:key/rows — backend-ийн гэрээтэй ижил хэлбэр (columns + rows).
     from/to-гоор огноогоор шүүнэ. */
  function datasetRows(u) {
    var key = (u.match(/\/api\/datasets\/([^/]+)\/rows/) || [])[1];
    var mf = u.match(/[?&]from=(\d{4}-\d{2}-\d{2})/), mt = u.match(/[?&]to=(\d{4}-\d{2}-\d{2})/);
    var days = [];
    for (var i = 1; i <= 40; i++) {
      var d = new Date(Date.UTC(Y, M - 1, D - i)).toISOString().slice(0, 10);
      if ((!mf || d >= mf[1]) && (!mt || d <= mt[1])) days.push(d);
    }
    var columns, rows = [];
    if (key === 'rail-wagon') {
      columns = [['record_date', 'Огноо', 'date'], ['station_code', 'Өртөөний код', 'string'], ['station_name', 'Өртөөний нэр', 'string'],
        ['loaded_mtd_domestic', 'Сарын эхнээс ачсан (дотоод)', 'int'], ['loaded_covered_domestic', 'Ачсан битүү вагон (дотоод)', 'int'],
        ['loaded_tank_foreign', 'Ачсан цистерн (гадаад)', 'int'], ['unloaded_covered_domestic', 'Буусан битүү вагон (дотоод)', 'int']];
      days.slice(0, 10).forEach(function (d, j) { STATIONS.forEach(function (s, i) {
        rows.push([d, s[1], s[0], 400 - i * 50 + j, 12 + i, (i * 3 + j) % 7, 9 + (i + j) % 5]); }); });
    } else if (key === 'rail-pax') {
      columns = [['record_date', 'Огноо', 'date'], ['source_record_id', 'Бичлэгийн ID', 'string'], ['train_no', 'Галт тэрэгний дугаар', 'string'],
        ['train_type', 'Төрөл (ОН/ОУ)', 'string'], ['line_name', 'Чиглэл', 'string'], ['passenger_count', 'Зорчигч', 'int'],
        ['sales_kass', 'Касс', 'int'], ['sales_web', 'Вэб', 'int']];
      days.slice(0, 10).forEach(function (d, j) { [['276', 'ОН', 'УЛААНБААТАР - ЗАМЫН-ҮҮД'], ['263', 'ОН', 'УЛААНБААТАР - СҮХБААТАР'],
        ['4', 'ОУ', 'УЛААНБААТАР - БЭЭЖИН']].forEach(function (t, i) {
        var p = 600 - i * 150 + j * 3; rows.push([d, String(180000 + j * 10 + i), t[0], t[1], t[2], p, Math.round(p * 0.6), p - Math.round(p * 0.6)]); }); });
    } else if (key === 'road-inspections') {
      columns = [['record_date', 'Үзлэгийн огноо', 'date'], ['source_record_id', 'Үзлэгийн дугаар', 'string'], ['branch_aimag', 'Аймаг, нийслэл', 'string'],
        ['branch_name', 'Салбар', 'string'], ['result_raw', 'Дүгнэлт', 'string'], ['failed_brake', 'Тоормос', 'string'], ['failed_count', 'Тэнцээгүй хэсэг', 'int']];
      days.slice(0, 5).forEach(function (d, j) { AIMAG.forEach(function (a, i) {
        rows.push([d, String(5000000 + j * 100 + i), a, 'PC1' + pad(i) + ' салбар', i % 4 ? 'Тэнцсэн' : 'Тэнцээгүй', i % 4 ? 'pass' : 'fail', i % 4 ? 0 : 1]); }); });
    } else if (key === 'rail-freight-ubtz' || key === 'rail-freight-mtz' || key === 'rail-freight-all') {
      var mz = key === 'rail-freight-mtz', fa = key === 'rail-freight-all';
      columns = [['record_date', 'Огноо', 'date'], ['source_record_id', 'Бичлэгийн ID', 'string'], ['organization', 'Байгууллага', 'string'],
        ['station_name', 'Өртөө', 'string'], ['cargo_name', 'Ачааны нэр', 'string'],
        ['export_wagons', 'Экспорт (вагон)', 'int'], ['export_tonnes', 'Экспорт (тонн)', 'float'],
        ['domestic_wagons', 'Дотоод (вагон)', 'int'], ['domestic_tonnes', 'Дотоод (тонн)', 'float']];
      if (!mz) columns.splice(5, 0, ['transit_wagons', 'Транзит (вагон)', 'int'], ['transit_tonnes', 'Транзит (тонн)', 'float'],
        ['import_wagons', 'Импорт (вагон)', 'int'], ['import_tonnes', 'Импорт (тонн)', 'float']);
      var sts = mz ? ['Цогтцэций', 'Төмөртэй'] : FR_ST.slice(0, 5);
      days.slice(0, 10).forEach(function (d, j) { sts.forEach(function (s, i) {
        var e = 12 + i + j, t = e * 61.5, dw = 3 + (i + j) % 6;
        var r = [d, String(1833091747960000 + j * 10 + i), mz ? 'Монголын төмөр зам ТӨХК' : 'УБТЗ', s, FR_CG[(i + j) % FR_CG.length]];
        if (!mz) r.push(i % 2, i % 2 ? 41.2 : 0, (j + i) % 3, ((j + i) % 3) * 38.5);
        r.push(e, Math.round(t * 100) / 100, dw, Math.round(dw * 44.4 * 100) / 100);
        rows.push(r); }); });
      /* Нэгтгэл: VIEW-ийн байгууллагын багана (огнооны дараа) + МТЗ-ийн мөр */
      if (fa) {
        columns.splice(1, 0, ['org_code', 'Тээвэрлэгч', 'string'], ['org_name', 'Тээвэрлэгчийн нэр', 'string']);
        rows = rows.map(function (r) { return [r[0], 'УБТЗ', 'Улаанбаатар төмөр зам ХНН'].concat(r.slice(1)); });
        days.slice(0, 4).forEach(function (d, j) { ['Цогтцэций', 'Төмөртэй'].forEach(function (s, i) {
          rows.push([d, 'МТЗ', 'Монголын төмөр зам ТӨХК', String(1844091747960000 + j * 10 + i), 'Монголын төмөр зам ТӨХК', s, 'Нүүрс',
            null, null, null, null, 0, 0, 20 + i, Math.round((20 + i) * 66.1 * 100) / 100]); }); });
      }
    } else if (key === 'sector-total') {
      columns = [['record_date', 'Огноо', 'date'], ['sector_code', 'Салбарын код', 'string'], ['sector_name', 'Салбар', 'string'],
        ['passengers', 'Зорчигч', 'int'], ['freight_tonnes', 'Ачаа (тонн)', 'float'], ['passenger_records', 'Зорчигчийн эх бичлэг', 'int'],
        ['freight_records', 'Ачааны эх бичлэг', 'int'], ['sources', 'Эх сурвалж', 'string']];
      days.slice(0, 20).forEach(function (d, j) {
        rows.push([d, 'air', 'Агаарын тээвэр', 5200 + j * 37, Math.round((26 + (j % 5)) * 1000) / 1000 + 20, 40 + j % 6, 40 + j % 6, 'Агаарын тээврийн статистик (ИНЕГ)']);
        rows.push([d, 'rail', 'Төмөр зам', 4100 + j * 21, 78000 + j * 311.5, 28 + j % 4, 2400 + j * 3, 'Ачаа тээврийн мэдээ (УБТЗ, МТЗ), Зорчигчийн галт тэрэгний мэдээ (УБТЗ)']); });
    } else return 404;
    return { status: rows.length ? 'ok' : 'no_data', dataset: key, total: rows.length, truncated: false,
      columns: columns.map(function (c) { return { key: c[0], label: c[1], type: c[2] }; }), rows: rows };
  }
  function route(url) {
    var u = String(url);
    if (u.indexOf('/api/datasets/') >= 0) return datasetRows(u);
    if (u.indexOf('/api/sectors/road/inspections/history') >= 0)
      return ranged(u, roadHistory(), 'total', [['by_aimag', 'total']]);
    if (u.indexOf('/api/sectors/rail/wagon-loading/history') >= 0)
      return ranged(u, wagonHistory(), 'loaded', [['by_station', 'loaded']]);
    var fo = u.match(/\/api\/sectors\/rail\/freight\/([a-z]+)\/history/);
    if (fo) return ranged(u, fo[1] === 'all' ? freightTotal() : freightHistory(fo[1]), 'tonnes', []);
    if (u.indexOf('/api/sectors/rail/passengers/history') >= 0)
      return ranged(u, railHistory(), 'passengers', [['by_route', 'passengers']]);
    if (u.indexOf('/api/sectors/total/history') >= 0) return sectorTotal(u);
    if (u.indexOf('/api/sectors/rail/passengers/history') >= 0) return railHistory();
    if (u.indexOf('/api/sectors/rail/summary') >= 0) return railSummary();
    if (u.indexOf('/api/sectors/rail/wagon-loading/history') >= 0) return wagonHistory();
    if (u.indexOf('/api/sectors/rail/wagon-loading') >= 0) return wagonLoading();
    if (u.indexOf('/api/sectors/road/inspections/history') >= 0) return roadHistory();
    if (u.indexOf('/api/sectors/road/inspections') >= 0) return roadInspections();
    if (/flights-index\.json/.test(u)) return flightsIndex();
    var fm = u.match(/flights-(\d{4})\.json/);
    if (fm) return flights(+fm[1]);
    if (u.indexOf('portal.mrt.gov.mn') >= 0) return 404;
    return null;
  }
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var hit = route(url);
    if (hit === 404) return Promise.resolve(new Response('', { status: 404 }));
    if (hit) return Promise.resolve(new Response(JSON.stringify(hit), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch алга'));
  };
})();

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
    if (u.indexOf('/api/sectors/rail/passengers/history') >= 0)
      return ranged(u, railHistory(), 'passengers', [['by_route', 'passengers']]);
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

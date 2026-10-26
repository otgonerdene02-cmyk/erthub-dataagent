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
        return row({ station: s, rows: 900 - i * 50 }, base * 6 / (i + 1)); }).concat(mtz ? [] :
        /* Транзит мөрийн «Өртөө» нь улсын нэр (амьд хариутай ижил) — нүүрийн олон улсын газрын зураг */
        [['Хятад', 8208], ['ОХУ', 5737], ['Белорус', 2323]].map(function (c) {
          return { station: c[0], rows: 120, transit_wagons: c[1], transit_tonnes: c[1] * 31, export_wagons: 0, export_tonnes: 0,
            import_wagons: 0, import_tonnes: 0, domestic_wagons: 0, domestic_tonnes: 0, wagons: c[1], tonnes: c[1] * 31 }; })),
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
  /* АВТО ТЭЭВРИЙН ЗОРЧИГЧ (/api/sectors/road/passengers/history, migrations/024) — 4
     тээврийн төрөл; өмнөх оны 1–7-р сар мэдээгүй (эх сурвалжийн цоорхой — харьцуулалт
     «мэдээ дутуу» болохыг харуулна), weekly — сүүлийн бүтэн 8 долоо хоног. */
  var RP_TYPES = ['Хот хооронд', 'Улс хооронд', 'Аймаг хооронд', 'Орон нутаг'];
  var RP_BASE = [180000, 18000, 900, 300];
  function roadPaxHistory() {
    var ms = months().filter(function (x) { return x.y === Y || x.m >= 8; });
    var mrows = ms.map(function (x, i) {
      var bt = {}, rt = {}, pax = 0, ref = 0;
      RP_TYPES.forEach(function (t, k) { var v = Math.round(wave(i + k, RP_BASE[k], RP_BASE[k] * 0.15) * x.days / x.dim);
        bt[t] = v; rt[t] = Math.round(v * 0.11); pax += v; ref += rt[t]; });
      return { month: x.key, days: x.days, days_in_month: x.dim, last_date: x.key + '-' + pad(x.days), tickets: pax + ref + 40,
        passengers: pax, refunded: ref, deleted: 40, by_type: bt, refunded_by_type: rt, partial: x.partial };
    });
    var tot = mrows.reduce(function (a, m) { return a + m.passengers; }, 0);
    var share = function (list) { var w = list.reduce(function (a, r) { return a + r[1]; }, 0); var acc = 0;
      return list.map(function (r, i) { var v = i === list.length - 1 ? tot - acc : Math.round(tot * r[1] / w); acc += v;
        return Object.assign({ name: r[0], passengers: v }, r[2] ? { route_type: r[2] } : {}); }); };
    var out = { sector: 'road', metric: 'road_passengers_history', status: 'ok', unit: 'зорчигч', dataset_id: 'road.veritech.passengers',
      types: RP_TYPES.slice(), months: mrows,
      totals: { passengers: tot },
      by_type: RP_TYPES.map(function (t) { return { type: t, passengers: mrows.reduce(function (a, m) { return a + m.by_type[t]; }, 0) }; }),
      by_route: share([['Да.Дархан - УБ - Да.Дархан', 9, 'Хот хооронд'], ['Ор.Баян Өндөр - УБ - Ор.Баян Өндөр', 8, 'Хот хооронд'],
        ['Хө.Мөрөн - УБ - Хө.Мөрөн', 6, 'Хот хооронд'], ['Эрээн хот/БНХАУ/ - Дг.Замын-Үүд - Эрээн хот/БНХАУ/', 5, 'Улс хооронд'], ['Улаан-Үд/ОХУ/ - УБ - Улаан-Үд/ОХУ/', 1, 'Улс хооронд'],
        ['Өм.Цогтцэций - УБ - Өм.Цогтцэций', 4, 'Хот хооронд'], ['Бн.Баянхонгор - УБ - Бн.Баянхонгор', 4, 'Хот хооронд'],
        ['До.Хэрлэн - УБ - До.Хэрлэн', 3, 'Хот хооронд'], ['Өв.Арвайхээр - УБ - Өв.Арвайхээр', 3, 'Хот хооронд'],
        ['Ар.Эрдэнэбулган - УБ - Ар.Эрдэнэбулган', 3, 'Хот хооронд'], ['Тө.Зуунмод - УБ - Тө.Зуунмод', 2, 'Хот хооронд'],
        ['Дархан-Уул - Орхон - Дархан-Уул', 0.3, 'Аймаг хооронд'], ['Бу.Булган - Ор.Баян-Өндөр - Бу.Булган', 0.1, 'Орон нутаг']]),
      by_company: share([['Хараацайн жигүүр ХХК', 9], ['Эрдэмтранс ХХК', 6], ['Баянчандмань хурд Хоршоо', 5], ['Атибус ХХК', 5],
        ['Нөхөрлөлзам ХХК', 4], ['Дэлгэрэхтээх ХХК', 4], ['ЛОТОТ ХХК', 4], ['Шарзам ирээдүй', 4], ['Баянхонгортээвэрчин ХХК', 3],
        ['Ач буян трэвел ХХК', 3], ['Аман авто транс ХХК', 2]]),
      by_channel: share([['Онлайн', 66], ['Касс', 28], ['Тапатрип', 5], ['Гэрэгэ', 0.4], [null, 0.1]]),
      by_vehicle: share([['Том автобус', 91], ['Бага оврын автобус', 4.4], ['Суудлын машин', 2.9], ['Дунд оврын автобус', 1.6]]),
      by_passenger_type: share([['Том хүн', 94], ['Хүүхэд', 6]]),
      upcoming: { passengers: 5321, from: Y + '-' + pad(M) + '-' + pad(D), to: Y + '-' + pad(M) + '-' + pad(Math.min(28, D + 20)) } };
    var lastDay = new Date(Date.UTC(Y, M - 1, D - 1));
    var we = new Date(lastDay.getTime() - (lastDay.getUTCDay() % 7) * 864e5);
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    var weeks = [];
    for (var i = 7; i >= 0; i--) {
      var ws = new Date(we.getTime() - (i * 7 + 6) * 864e5), wend = new Date(we.getTime() - i * 7 * 864e5), bt = {}, p = 0;
      RP_TYPES.forEach(function (t, k) { var v = Math.round(wave(i + k * 3, RP_BASE[k] / 4.3, RP_BASE[k] / 30)); bt[t] = v; p += v; });
      weeks.push({ week_start: iso(ws), week_end: iso(wend), missing: false, days: 7, passengers: p, by_type: bt });
    }
    var yy = +iso(we).slice(0, 4);
    var ytdBt = {}, ytdP = 0, pyBt = {}, pyP = 0;
    RP_TYPES.forEach(function (t, k) { ytdBt[t] = RP_BASE[k] * 9; ytdP += ytdBt[t]; pyBt[t] = Math.round(weeks[7].by_type[t] * 0.93); pyP += pyBt[t]; });
    var pw0 = new Date(Date.parse(weeks[7].week_start) - 364 * 864e5), pw1 = new Date(Date.parse(weeks[7].week_end) - 364 * 864e5);
    out.weekly = { max_date: iso(lastDay), week_end: iso(we), types: RP_TYPES.slice(), weeks: weeks,
      ytd: { year: yy, from: yy + '-01-01', to: iso(we), passengers: ytdP, days: 280, by_type: ytdBt },
      prev_ytd: { year: yy - 1, from: (yy - 1) + '-01-01', to: (yy - 1) + iso(we).slice(4), passengers: Math.round(ytdP * 0.3), days: 84,
        by_type: {}, comparable: false },
      prev_year_week: { week_start: iso(pw0), week_end: iso(pw1), passengers: pyP, days: 7, by_type: pyBt, comparable: true } };
    return out;
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
    /* Авто тээвэр — билеттэй зорчигч (migrations/024-ийн UNION) */
    roadPaxHistory().months.forEach(function (m) { var r = row(m.month, 'road', m.days_in_month);
      r.passengers = m.passengers; r.passenger_days = m.days; r.passenger_last = m.last_date; });
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
      /* Авто тээврийн зорчигч — roadPaxHistory-ийн 7 хоногоос (өмнөх оны мөн үе дутуу → comparable-д ороогүй) */
      var rw = roadPaxHistory().weekly, P = out.weekly.passengers;
      P.sectors = ['air', 'road', 'rail'];
      P.weeks.forEach(function (w, i) { var v = rw.weeks[i].passengers; w.by_sector.road = { value: v, days: 7 }; w.value += v; });
      P.ytd.by_sector.road = { value: rw.ytd.passengers, days: 280 }; P.ytd.value += rw.ytd.passengers;
      P.prev_ytd.by_sector.road = { value: rw.prev_ytd.passengers, days: 84 };
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
        /* МТЗ-ийн мөр УБТЗ-ийнхээс ХУУЧИН огноотой (амьд дата: МТЗ сүүлийн бичлэг
           2026-02-01) — таслагдсан эхний хуудсанд ордоггүй, зөвхөн серверийн
           шүүлтээр (in.org_code=МТЗ) гарна (FX_ROWS_CAP, FL19). */
        days.slice(14, 18).forEach(function (d, j) { ['Цогтцэций', 'Төмөртэй'].forEach(function (s, i) {
          rows.push([d, 'МТЗ', 'Монголын төмөр зам ТӨХК', String(1844091747960000 + j * 10 + i), 'Монголын төмөр зам ТӨХК', s, 'Нүүрс',
            null, null, null, null, 0, 0, 20 + i, Math.round((20 + i) * 66.1 * 100) / 100]); }); });
      }
    } else if (key === 'road-passengers') {
      columns = [['trip_date', 'Хөдлөх огноо', 'date'], ['source_record_id', 'Билетийн ID', 'string'], ['departure_at', 'Хөдлөх цаг', 'string'],
        ['route_type', 'Тээврийн төрөл', 'string'], ['route_name', 'Чиглэл', 'string'], ['start_stop', 'Суух буудал', 'string'],
        ['end_stop', 'Буух буудал', 'string'], ['company_name', 'Тээвэрлэгч', 'string'], ['vehicle_type', 'Тээврийн хэрэгслийн төрөл', 'string'],
        ['vehicle_plate', 'Улсын дугаар', 'string'], ['passenger_type', 'Зорчигчийн ангилал', 'string'], ['sales_channel', 'Борлуулалтын суваг', 'string'],
        ['ticket_status', 'Билетийн төлөв', 'string'], ['status_updated_at', 'Төлөв өөрчлөгдсөн цаг', 'string'], ['registered_date', 'Бүртгэсэн огноо', 'date']];
      var RR = [['Хот хооронд', 'Да.Дархан - УБ - Да.Дархан', 'УБ.Сонгинохайрхан /Драгон/', 'Да.Дархан', 'Эрдэмтранс ХХК', 'Том автобус', '12-34 УБА'],
        ['Хот хооронд', 'Хө.Мөрөн - УБ - Хө.Мөрөн', 'Хө.Мөрөн', 'УБ.Сонгинохайрхан /Драгон/', 'Минтранс ХХК', 'Том автобус', '44-46 УБЯ'],
        ['Улс хооронд', 'Эрээн хот/БНХАУ/ - Дг.Замын-Үүд - Эрээн хот/БНХАУ/', 'Дг.Замын-Үүд', 'БНХАУ.Эрээн', 'Дэлгэрэхтээх ХХК', 'Том автобус', '77-19 ДГС'],
        ['Аймаг хооронд', 'Дархан-Уул - Орхон - Дархан-Уул', 'Да.Дархан', 'Ор.Баян-Өндөр /аймгийн төв/', 'ББ-ОД ХХК-ОРОН НУТАГ', 'Суудлын машин', '46-77 ОРН'],
        ['Орон нутаг', 'Бу.Булган - Ор.Баян-Өндөр - Бу.Булган', 'Бу.Булган', 'Ор.Баян-Өндөр /аймгийн төв/', 'Эрдэнэт Арслан ХХК-ОРОН НУТАГ', 'Суудлын машин', '02-82 ОРА']];
      days.slice(0, 12).forEach(function (d, j) { RR.forEach(function (r, i) {
        rows.push([d, String(26600000 + j * 10 + i), d + ' ' + pad(7 + i * 2) + ':00', r[0], r[1], r[2], r[3], r[4], r[5], r[6],
          (i + j) % 7 ? 'Том хүн' : 'Хүүхэд', ['Онлайн', 'Касс', 'Тапатрип'][(i + j) % 3], (i + j) % 9 ? 'Хэвийн' : 'Буцаасан', d + ' 06:1' + i, d]); }); });
    } else if (key === 'sector-total') {
      columns = [['record_date', 'Огноо', 'date'], ['sector_code', 'Салбарын код', 'string'], ['sector_name', 'Салбар', 'string'],
        ['passengers', 'Зорчигч', 'int'], ['freight_tonnes', 'Ачаа (тонн)', 'float'], ['passenger_records', 'Зорчигчийн эх бичлэг', 'int'],
        ['freight_records', 'Ачааны эх бичлэг', 'int'], ['sources', 'Эх сурвалж', 'string']];
      days.slice(0, 20).forEach(function (d, j) {
        rows.push([d, 'air', 'Агаарын тээвэр', 5200 + j * 37, Math.round((26 + (j % 5)) * 1000) / 1000 + 20, 40 + j % 6, 40 + j % 6, 'Агаарын тээврийн статистик (ИНЕГ)']);
        rows.push([d, 'rail', 'Төмөр зам', 4100 + j * 21, 78000 + j * 311.5, 28 + j % 4, 2400 + j * 3, 'Ачаа тээврийн мэдээ (УБТЗ, МТЗ), Зорчигчийн галт тэрэгний мэдээ (УБТЗ)']); });
    } else return 404;
    return rowsContract(u, key, columns, rows);
  }
  /* Backend-ийн гэрээ (etransport-backend datasetRows.js): баганын шүүлт in./min./max.,
     facets=1 → цонхны БҮТЭН мөрөөс (шүүлтгүй) ангилал [[утга, тоо]] ба тоон {min,max},
     огноогоор буурах эрэмбэ, limit-ээр таслана. Нэгтгэлийн датасэт (rail-freight-all)
     амьд дээрх шиг ТАСЛАГДСАН (5,000 / 148,196) — хуудас ачаалсан мөрөөсөө биш
     facet-ээс шүүлтийн сонголт гаргахыг шалгана. */
  var FX_ROWS_CAP = { 'rail-freight-all': 50 };
  function rowsContract(u, key, columns, rows) {
    var qs = (String(u).split('?')[1] || '').split('&').filter(Boolean).map(function (p) {
      var i = p.indexOf('=');
      return [decodeURIComponent(i < 0 ? p : p.slice(0, i)), decodeURIComponent(i < 0 ? '' : p.slice(i + 1))];
    });
    var keys = columns.map(function (c) { return c[0]; });
    var inF = {}, lo = {}, hi = {}, any = false;
    qs.forEach(function (kv) {
      var m = /^(in|min|max)\.(.+)$/.exec(kv[0]);
      var ci = m ? keys.indexOf(m[2]) : -1;
      if (ci < 0 || kv[1] === '') return;
      any = true;
      if (m[1] === 'in') (inF[ci] = inF[ci] || []).push(kv[1].trim());
      else (m[1] === 'min' ? lo : hi)[ci] = +kv[1];
    });
    var txt = function (v) { return v == null ? '' : String(v).trim(); };
    var out = rows.filter(function (r) {
      for (var a in inF) if (inF[a].indexOf(txt(r[a])) < 0) return false;
      for (var b in lo) if (r[b] == null || +r[b] < lo[b]) return false;
      for (var c in hi) if (r[c] == null || +r[c] > hi[c]) return false;
      return true;
    }).sort(function (x, y) { return x[0] < y[0] ? 1 : x[0] > y[0] ? -1 : 0; });
    var cap = FX_ROWS_CAP[key] || 5000, lim = +((qs.find(function (kv) { return kv[0] === 'limit'; }) || [])[1]) || 5000;
    var page = out.slice(0, Math.min(cap, lim));
    var res = { status: rows.length ? 'ok' : 'no_data', dataset: key, total: out.length, truncated: page.length < out.length,
      columns: columns.map(function (c) { return { key: c[0], label: c[1], type: c[2] }; }), rows: page };
    if (any) { res.filtered = true; res.status = 'ok'; }
    if (qs.some(function (kv) { return kv[0] === 'facets' && kv[1] === '1'; })) {
      var fz = {};
      columns.forEach(function (c, i) {
        if (c[2] === 'string') {
          var n = {}, filled = 0;
          rows.forEach(function (r) { var v = txt(r[i]); if (!v) return; filled++; n[v] = (n[v] || 0) + 1; });
          var vs = Object.keys(n);
          if (vs.length >= 2 && vs.length <= 1000 && vs.length < filled)
            fz[c[0]] = { kind: 'cat', values: vs.sort(function (a, b) { return n[b] - n[a] || (a < b ? -1 : 1); }).map(function (v) { return [v, n[v]]; }) };
        } else if (c[2] === 'int' || c[2] === 'float') {
          var nums = rows.map(function (r) { return r[i]; }).filter(function (v) { return v != null && v !== ''; }).map(Number);
          if (nums.length && Math.min.apply(null, nums) < Math.max.apply(null, nums))
            fz[c[0]] = { kind: 'range', min: Math.min.apply(null, nums), max: Math.max.apply(null, nums) };
        }
      });
      res.facets = fz;
    }
    return res;
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
    if (u.indexOf('/api/sectors/road/passengers/history') >= 0) {
      var rp = ranged(u, roadPaxHistory(), 'passengers', [['by_route', 'passengers'], ['by_company', 'passengers'],
        ['by_channel', 'passengers'], ['by_vehicle', 'passengers'], ['by_passenger_type', 'passengers']]);
      if (/[?&](from|to)=/.test(u)) delete rp.weekly; /* backend: weekly зөвхөн шүүлтгүй дуудлагад */
      return rp;
    }
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

/*
 * ErtHub — Чарт бүтээгчийн дундын давхарга (талбарын каталог + нэгтгэл)
 * =====================================================================
 * ЗОРИЛГО: Power BI / Tableau-гийн "field well" (X тэнхлэг · Y тэнхлэг ·
 * нэгтгэл · чартын төрөл) загварыг ЭНЭ сайтад авчрах. Ингэснээр админ
 * КОД БИЧИХГҮЙГЭЭР чартын агуулгыг датанаас сонгож өөрчилнө.
 *
 * ЯАГААД ТУСДАА ФАЙЛ: `index.html` (сайт) ба `admin/index.html` (удирдлага)
 * нь ХОЁР ТУСДАА document. Хоёулаа ижил дүрмээр нэгтгэл хийх ёстой тул
 * (эс тэгвэл preview ба сайт хоёр өөр тоо үзүүлж эхэлнэ) логикийг ЭНД
 * НЭГ УДАА бичиж, хоёул `<script src>`-ээр ачаална —
 * `js/erthub-publish.js` / `js/erthub-backend.js`-тэй яг ижил хэв маяг.
 *
 * ДҮРЭМ (CLAUDE.md):
 *   - ТОО ЗОХИОХГҮЙ. Мөр байхгүй / талбар олдохгүй / тохиргоо буруу бол
 *     ХООСОН цуваа буцаана, хэзээ ч санамсаргүй тоо гаргахгүй.
 *   - Тохиргоо буруу бол `validate()` нь `null` буцаана. Дуудагч тал
 *     `null` үед ӨМНӨХ (хатуу бичсэн) зан төлөв рүүгээ унана — иймд
 *     буруу тохиргоо амьд сайтыг ХЭЗЭЭ Ч эвдэхгүй.
 */
(function () {
  'use strict';

  var WEEKDAY_MN = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];

  /* Агаарын тээврийн бодит feed-ийн БҮХ талбар — [нэр, төрөл, тайлбар,
     утга гаргагч]. Дөрвийг нэг дор барьснаар `DS_SCHEMA.air`-ийн
     head/types/notes/rows дөрвүүлээ үргэлж синхрон үлдэнэ (Excel татах ч
     эндээс бүтэн баганаар гарна). Сүүлийн 'Төлөв' багана нь generic
     хүснэгтийн status гэрээ — утгыг нь applyRealFlightsData тусад нь нэмэх
     тул гаргагч нь `null`.
     ЭНЭ БОЛ index.html-ийн өмнөх `AIR_COLUMNS` — ганц эх сурвалж болгохын
     тулд энд нүүлгэв (index.html түүнийг эндээс уншина). */
  var AIR_COLUMNS = [
    ['Огноо', 'date', 'Нислэгийн огноо (ISO-8601)', function (f, d) { return d; }],
    ['Компани', 'string', 'Тээвэрлэгч агаарын тээврийн компани', function (f) { return f.carr || '—'; }],
    ['Нислэг', 'string', 'Тээвэрлэгчийн нислэгийн код', function (f) { return f.flight || '—'; }],
    ['Хот', 'string', 'Хүрэх / гарах хот', function (f) { return f.city || '—'; }],
    ['Улс', 'string', 'Хүрэх / гарах улс', function (f) { return f.cntry || '—'; }],
    ['Чиглэл', 'string', 'Явсан (гарсан) эсвэл Ирсэн (буусан)', function (f) { return f.dir === '1' ? 'Явсан' : 'Ирсэн'; }],
    ['Ангилал', 'string', 'Нислэгийн ангилал — P зорчигч, C ачаа', function (f) { return f.category || '—'; }],
    ['Зорчигч', 'int', 'Нийт зорчигчийн тоо', function (f) { return f.pax || 0; }],
    ['Ачаа (кг)', 'int', 'Тээвэрлэсэн ачааны жин, килограммаар', function (f) { return f.cargoKg || 0; }],
    ['Аяллын дугаар', 'string', 'Нислэгийн бүртгэлийн дугаар', function (f) { return f.id || '—'; }],
    ['Гараг', 'string', 'Долоо хоногийн өдөр', function (f) {
      return WEEKDAY_MN[new Date(Date.UTC(f.year, (f.month || 1) - 1, f.day || 1)).getUTCDay()] || '—';
    }],
    ['ОУ/Дотоод', 'string', 'Олон улсын (ОУ) эсвэл дотоодын (ОН) нислэг', function (f) { return f.ou || '—'; }],
    ['Нислэгийн төрөл', 'string', 'Тогтмол хуваарийн эсвэл захиалгат', function (f) { return f.flightType || '—'; }],
    ['Агаарын хөлөг', 'string', 'Онгоцны загвар ба сүүлний дугаар', function (f) { return f.aircraft || '—'; }],
    ['Үйлдвэрлэгч', 'string', 'Онгоц үйлдвэрлэгч', function (f) { return f.acManufacturer || '—'; }],
    ['Хөлгийн ангилал', 'string', 'narrow-body / wide-body', function (f) { return f.acCategory || '—'; }],
    ['Суудал', 'int', 'Онгоцны суудлын багтаамж', function (f) { return f.acSeatCap || 0; }],
    ['Бүртгэлийн улс', 'string', 'Онгоц бүртгэгдсэн улс', function (f) { return f.acRegCountry || '—'; }],
    ['Том хүн', 'int', 'Насанд хүрсэн зорчигчийн тоо', function (f) { return f.adult || 0; }],
    ['Хүүхэд', 'int', 'Хүүхэд зорчигчийн тоо', function (f) { return f.child || 0; }],
    ['Нялх', 'int', 'Нялх хүүхэд зорчигчийн тоо', function (f) { return f.infant || 0; }],
    ['Транзит', 'int', 'Дамжин өнгөрөх зорчигчийн тоо', function (f) { return f.transit || 0; }],
    ['VIP', 'int', 'VIP зорчигчийн тоо', function (f) { return f.vip || 0; }],
    ['Дипломат', 'int', 'Дипломат зорчигчийн тоо', function (f) { return f.diplomat || 0; }],
    ['Багийн гишүүн', 'int', 'Нислэгийн багийн гишүүдийн тоо', function (f) { return f.crew || 0; }],
    ['Шуудан (кг)', 'int', 'Тээвэрлэсэн шуудангийн жин, килограммаар', function (f) { return f.mailKg || 0; }],
    ['Бүс нутаг', 'string', 'Газарзүйн бүс нутаг', function (f) { return f.region || '—'; }],
    ['Тив', 'string', 'Тив', function (f) { return f.continent || '—'; }],
    ['Холбоо', 'string', 'Агаарын тээврийн холбоо (alliance)', function (f) { return f.alliance || '—'; }],
    ['Компанийн улс', 'string', 'Тээвэрлэгч бүртгэлтэй улс', function (f) { return f.airlineCountry || '—'; }],
    ['Төлөв', 'enum', 'Нислэгийн хуваарийн төлөв', null]
  ];

  /* ГАРГАЖ АВСАН бүлэглэх талбарууд — зөвхөн чарт/утга бүлэглэхэд
     ашиглана, хүснэгтийн схемд (DS_SCHEMA / Excel татах) ОРОХГҮЙ.
     Тиймээс AIR_COLUMNS-д биш, тусад нь: "Сар"-аар бүлэглэх нь цаг
     хугацааны цуваа (spark line) гаргахад зайлшгүй хэрэгтэй ч датасэтийн
     хүснэгтэд нэмэлт багана болж гарах ёсгүй. */
  var MONTHS_MN = ['1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар',
    '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'];
  var AIR_DERIVED = [
    ['Сар', 'string', 'Огнооны сар (цаг хугацааны цуваа)', function (f) { return MONTHS_MN[(f.month || 1) - 1] || '—'; }],
    ['Он', 'string', 'Огнооны он', function (f) { return String(f.year || '—'); }]
  ];

  /* Хэмжигдэхүүн бүрийн ХАРАГДАХ нэгж — виджет дээрх "2,450 нислэг"
     гэсэн шошго сонгосон хэмжигдэхүүнээ дагах ёстой (эс тэгвэл зорчигчийн
     тоог "нислэг" гэж ХУДАЛ шошголно). Бүртгэгдээгүй бол хоосон. */
  var UNITS = {
    'Зорчигч': 'хүн', 'Том хүн': 'хүн', 'Хүүхэд': 'хүн', 'Нялх': 'хүн',
    'Транзит': 'хүн', 'VIP': 'хүн', 'Дипломат': 'хүн', 'Багийн гишүүн': 'хүн',
    'Ачаа (кг)': 'кг', 'Шуудан (кг)': 'кг', 'Суудал': 'суудал'
  };

  /* Датасэтийн түлхүүр нь metric_registry.json-ий `dataset` талбартай
     ижил байна ("air_flights") — шинэ салбар нэмэгдэхэд энд нэг мөрөөр
     бүртгэгдэнэ. */
  var FIELDS = { air_flights: AIR_COLUMNS };
  var DERIVED = { air_flights: AIR_DERIVED };

  var AGGS = { SUM: 1, COUNT: 1, AVG: 1, MIN: 1, MAX: 1 };
  var TYPES = { bar: 1, line: 1, donut: 1, dual: 1 };
  /* X тэнхлэгт тавигдах (бүлэглэх) талбарын төрөл vs Y тэнхлэгт
     (нэгтгэх) тавигдах төрөл — Tableau-гийн dimension / measure ялгаа. */
  var DIM_TYPES = { string: 1, date: 1 };
  var MEASURE_TYPES = { int: 1, float: 1 };

  /* Бүлэглэх/нэгтгэхэд ашиглагдах БҮХ талбар = хүснэгтийн багана +
     гаргаж авсан (Сар/Он). Хүснэгтийн схем нь зөвхөн FIELDS-ээс. */
  function cols(dataset) {
    var base = FIELDS[dataset];
    if (!base) return null;
    return base.concat(DERIVED[dataset] || []);
  }
  function findField(list, name) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (list[i][0] === name) return list[i];
    return null;
  }
  /* Бүлэглэхэд тохирох талбарууд (X тэнхлэг) — утга гаргагчгүй ('Төлөв')
     баганыг оруулахгүй, эс тэгвэл сонгоод хоосон үр дүн гарна. */
  function dims(dataset) {
    return (cols(dataset) || []).filter(function (c) { return DIM_TYPES[c[1]] && typeof c[3] === 'function'; });
  }
  function measures(dataset) {
    return (cols(dataset) || []).filter(function (c) { return MEASURE_TYPES[c[1]] && typeof c[3] === 'function'; });
  }

  /* Огнооны мөр — 'Огноо' талбарын гаргагч 2 дахь аргументаар хүлээж авдаг
     (index.html-ийн DS_SCHEMA мөр бүтээгчтэй ижил хэлбэр). */
  function rowDate(f) {
    if (!f || f.year == null) return '';
    var mm = String(f.month || 1), dd = String(f.day || 1);
    if (mm.length < 2) mm = '0' + mm;
    if (dd.length < 2) dd = '0' + dd;
    return f.year + '-' + mm + '-' + dd;
  }

  /* Тохиргоог ХЭВИЙН болгоно. Буруу/дутуу бол `null` — дуудагч тал
     өмнөх хатуу зан төлөв рүүгээ унана (амьд сайт эвдрэхгүй). */
  function validate(spec) {
    if (!spec || typeof spec !== 'object') return null;
    var dataset = spec.dataset || 'air_flights';
    var list = cols(dataset);
    if (!list) return null;
    var dimF = findField(list, spec.dim);
    if (!dimF || typeof dimF[3] !== 'function') return null;
    var ag = String(spec.agg || 'SUM').toUpperCase();
    if (!AGGS[ag]) return null;
    var measure = null;
    if (ag !== 'COUNT') {
      var mF = findField(list, spec.measure);
      if (!mF || typeof mF[3] !== 'function') return null;
      measure = spec.measure;
    }
    var type = String(spec.type || 'bar');
    if (!TYPES[type]) return null;
    var topN = parseInt(spec.topN, 10);
    if (!(topN > 0)) topN = 0;                  /* 0 = бүгд */
    var sort = (spec.sort === 'asc' || spec.sort === 'label') ? spec.sort : 'desc';
    return { dataset: dataset, dim: spec.dim, measure: measure, agg: ag, type: type, topN: topN, sort: sort };
  }

  /* Нэгтгэлийн хөдөлгүүр — Tableau-гийн "dimension дээр бүлэглээд measure-г
     нэгтгэх" үйлдэл. Буцаах утга:
        {labels:[...], values:[...], total, n}
     Мөр алга / тохиргоо буруу бол ХООСОН (тоо ЗОХИОХГҮЙ). */
  function agg(rows, spec) {
    var empty = { labels: [], values: [], total: 0, n: 0 };
    var s = validate(spec);
    if (!s || !rows || !rows.length) return empty;
    var list = cols(s.dataset);
    var dimGet = findField(list, s.dim)[3];
    var mF = s.measure ? findField(list, s.measure) : null;
    var mGet = mF ? mF[3] : null;

    var acc = Object.create(null), order = [];
    for (var i = 0; i < rows.length; i++) {
      var f = rows[i], d = rowDate(f);
      var label = dimGet(f, d);
      if (label == null || label === '') label = '—';
      label = String(label);
      var a = acc[label];
      if (!a) { a = acc[label] = { sum: 0, count: 0, min: null, max: null }; order.push(label); }
      a.count++;
      if (mGet) {
        var v = Number(mGet(f, d));
        if (!isFinite(v)) v = 0;
        a.sum += v;
        if (a.min === null || v < a.min) a.min = v;
        if (a.max === null || v > a.max) a.max = v;
      }
    }

    var pairs = order.map(function (k) {
      var a = acc[k], v;
      if (s.agg === 'COUNT') v = a.count;
      else if (s.agg === 'SUM') v = a.sum;
      else if (s.agg === 'AVG') v = a.count ? a.sum / a.count : 0;
      else if (s.agg === 'MIN') v = a.min === null ? 0 : a.min;
      else v = a.max === null ? 0 : a.max;
      return [k, v];
    });

    /* "Сар"-аар бүлэглэсэн үед ЦАГ ХУГАЦААНЫ дараалал л утгатай —
       цагаан толгойгоор эрэмбэлбэл "10-р сар" нь "2-р сар"-аас өмнө орж
       цуваа гажина. Иймд сарын индексээр эрэмбэлнэ. */
    var monthIdx = function (lb) { return MONTHS_MN.indexOf(lb); };
    if (s.dim === 'Сар') pairs.sort(function (x, y) { return monthIdx(x[0]) - monthIdx(y[0]); });
    else if (s.sort === 'asc') pairs.sort(function (x, y) { return x[1] - y[1]; });
    else if (s.sort === 'label') pairs.sort(function (x, y) { return x[0] < y[0] ? -1 : (x[0] > y[0] ? 1 : 0); });
    else pairs.sort(function (x, y) { return y[1] - x[1]; });

    if (s.topN > 0) pairs = pairs.slice(0, s.topN);

    var total = 0;
    for (var j = 0; j < pairs.length; j++) total += pairs[j][1];
    return {
      labels: pairs.map(function (p) { return p[0]; }),
      values: pairs.map(function (p) { return p[1]; }),
      total: total, n: pairs.length
    };
  }

  /* Тохируулсан чартын ӨӨРИЙНХ нь агуулгыг тайлбарлах гарчиг.
     ЯАГААД ХЭРЭГТЭЙ: X тэнхлэгийг "Сар"-аас "Компани" болгосон хэрнээ
     гарчиг нь "Сараар..." гэж үлдвэл хуудас ХУДАЛ тайлбарлана. Админ
     `title` гараар бичээгүй бол тохиргооноос автоматаар гаргана. */
  var AGG_MN = { SUM: 'нийлбэр', COUNT: 'тоо', AVG: 'дундаж', MIN: 'хамгийн бага', MAX: 'хамгийн их' };
  function describe(spec) {
    var s = validate(spec);
    if (!s) return '';
    if (spec && spec.title) return String(spec.title);
    if (s.agg === 'COUNT') return s.dim + ' · бичлэгийн тоо';
    return s.dim + ' · ' + s.measure + ' (' + (AGG_MN[s.agg] || s.agg.toLowerCase()) + ')';
  }

  /* ── ВИДЖЕТИЙН УТГА (чартын ЗАГВАР хэвээр, зөвхөн УТГА солигдоно) ──
     Виджет дээр аль хэдийн байгаа "том тоо + бяцхан муруй" загварыг
     ХЭВЭЭР үлдээж, зөвхөн ЯМАР хэмжигдэхүүнийг харуулахыг сольдог зам.
     Жишээ: `ls` виджет одоо нислэгийн ТООГ харуулж байгааг зорчигчийн
     НИЙЛБЭР болгоход загвар өөрчлөгдөхгүй, тоо ба нэгж нь л солигдоно.

     valueSpec = {dataset, measure, agg}   (measure байхгүй бол COUNT)
     Буцаах: {value, raw, unit, series[], n} эсвэл null.
       series — "Сар"-аар бүлэглэсэн ЦАГ ХУГАЦААНЫ цуваа. Виджетийн
       spark line ҮҮГЭЭР зурагдана (өмнө нь зохиомол sin-муруй байсан —
       "тоо зохиохгүй" дүрэм зөрчиж байв). */
  function unitOf(measure) { return (measure && UNITS[measure]) || ''; }
  /* Виджетийн ГАРЧИГ сонгосон утгаа дагана. Админ `title` гараар бичвэл
     тэр давуу эрхтэй (автомат нэр ойлгомжгүй байвал гараас засах зам). */
  function valueTitle(spec) {
    if (!spec) return '';
    if (spec.title) return String(spec.title);
    var ag = String(spec.agg || 'SUM').toUpperCase();
    if (ag === 'COUNT') return 'НИЙТ БИЧЛЭГ';
    if (!spec.measure) return '';
    var mn = AGG_MN[ag] || ag.toLowerCase();
    return String(spec.measure).toUpperCase() + ' (' + mn + ')';
  }
  /* Хэмжигдэхүүний утга гаргагч — 7 хоногийн виджет (w2p/w2c) нь өдөр
     тус бүрээр нийлбэрлэдэг тусдаа замтай тул түүхий мөрөөс утга авах
     функцийг ил гаргана (талбарын нэр биш, ГАРГАГЧ — "Ачаа (кг)" мэтийн
     нэр нь feed-ийн cargoKg талбартай шууд таардаггүй). */
  function accessor(dataset, measure) {
    var f = findField(cols(dataset || 'air_flights'), measure);
    return (f && typeof f[3] === 'function') ? f[3] : null;
  }
  function value(rows, valueSpec) {
    if (!valueSpec || typeof valueSpec !== 'object') return null;
    var ag = String(valueSpec.agg || 'SUM').toUpperCase();
    if (!AGGS[ag]) return null;
    var dataset = valueSpec.dataset || 'air_flights';
    if (!cols(dataset)) return null;
    if (ag !== 'COUNT' && !findField(cols(dataset), valueSpec.measure)) return null;
    if (!rows || !rows.length) return null;
    /* Нийт дүн — БҮХ мөрийг нэг бүлэгт цуглуулж нэгтгэнэ ("Он"-оор
       бүлэглээд нийлбэрлэвэл AVG/MIN/MAX буруу гарна). */
    var one = agg(rows, { dataset: dataset, dim: 'Он', measure: valueSpec.measure, agg: ag, topN: 0 });
    if (!one.n) return null;
    var total;
    if (ag === 'SUM' || ag === 'COUNT') total = one.total;
    else if (ag === 'MIN') total = Math.min.apply(null, one.values);
    else if (ag === 'MAX') total = Math.max.apply(null, one.values);
    else total = one.values.reduce(function (a, b) { return a + b; }, 0) / one.n;   /* AVG */
    var ser = agg(rows, { dataset: dataset, dim: 'Сар', measure: valueSpec.measure, agg: ag, topN: 0 });
    /* Өөрчлөлтийн хувь — сүүлийн БҮТЭН сарыг өмнөхтэй нь харьцуулна.
       ЯАГААД ЗААВАЛ ЭНД: хэмжигдэхүүнээ сольсон хэрнээ виджет дээр
       ХУУЧИН метрикийн хувь үлдвэл өөр үзүүлэлтийн өөрчлөлтийг
       буруу зүйлд наасан ХУДАЛ мэдээлэл болно. Тооцох боломжгүй бол
       null — дуудагч тал "—" харуулна (тоо ЗОХИОХГҮЙ). */
    var delta = null, dir = 'flat';
    if (ser.n >= 3) {                       /* сүүлийн сар дутуу байж болзошгүй тул алгасна */
      var cur = ser.values[ser.n - 2], prev = ser.values[ser.n - 3];
      if (prev) {
        var pct = (cur - prev) / Math.abs(prev) * 100;
        delta = (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
        dir = pct > 0.05 ? 'up' : (pct < -0.05 ? 'down' : 'flat');
      }
    }
    return {
      raw: total,
      value: Math.round(total).toLocaleString('en-US'),
      unit: ag === 'COUNT' ? '' : unitOf(valueSpec.measure),
      /* Виджет дээрх метрикийн НЭР ч хэмжигдэхүүнээ дагана — эс тэгвэл
         "НИЙТ НИСЛЭГ" гэсэн шошгын доор зорчигчийн тоо гарч ХУДАЛ
         тайлбарлана. */
      label: ag === 'COUNT' ? 'НИЙТ БИЧЛЭГ' : String(valueSpec.measure || '').toUpperCase(),
      delta: delta, dir: dir,
      series: ser.values, labels: ser.labels, n: ser.n
    };
  }

  window.EHChart = {
    FIELDS: FIELDS,
    describe: describe,
    unitOf: unitOf,
    valueTitle: valueTitle,
    accessor: accessor,
    value: value,
    AIR_COLUMNS: AIR_COLUMNS,
    WEEKDAY_MN: WEEKDAY_MN,
    AGG_LIST: ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX'],
    TYPE_LIST: ['bar', 'line', 'donut', 'dual'],
    dims: dims,
    measures: measures,
    field: function (dataset, name) { return findField(cols(dataset), name); },
    rowDate: rowDate,
    validate: validate,
    agg: agg
  };
})();

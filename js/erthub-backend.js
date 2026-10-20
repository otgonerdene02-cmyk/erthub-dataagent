/*
 * ErtHub — etransport-backend холболт (widget builder → base)
 * =============================================================
 * HANDOFF_widget_builder.md-д тэмдэглэсэн шинэ backend (Node/Express,
 * `GET /api/sectors/:sector/summary` гэх мэт endpoint-үүдтэй) руу
 * widget builder-ийг холбох модуль. js/erthub-publish.js-тэй ЯГ ижил
 * зарчим баримтална:
 *   - Тохиргоо (base URL) хоосон бол `enabled=false`, ямар ч сүлжээний
 *     оролдлого хийхгүй.
 *   - Алдаа/сүлжээгүй/timeout бүгд НУУЦААР (console.info) унана —
 *     backend хол/унтарсан ч сайт ЯГ ӨМНӨХ ШИГЭЭ ажиллана.
 *   - Тоо ЗОХИОХГҮЙ: fetch амжилтгүй бол `null` буцаана, val()-ийн
 *     getters нь `null`-ийг isFallback:true болгон зөв тайлбарлана.
 *
 * ТӨЛӨВ (2026-09-19): вагон ачилт нь summary-гаас ТУСДАА endpoint-оор
 * (`/api/sectors/rail/wagon-loading`) `silver.rail_wagon_loading`-оос шууд
 * ирдэг болсон бөгөөд эх xlsx-тэй тулгаж баталсан тул metric_registry.json-д
 * quality:"verified". Харин `/api/sectors/rail/summary` нь одоогоор ХООСОН
 * (`data:[]`) буцаадаг — зорчигчийн сарын нэгтгэл хараахан ирээгүй. Тиймээс
 * fetchSectorSummary() нь rail-д утга өгөхгүй бөгөөд сайт энэ хоёрыг
 * ХОЛИХГҮЙ: вагон (хоногийн) ба зорчигч (сарын) нэгж нь өөр.
 */
(function () {
  'use strict';

  var BASE = (typeof ETRANSPORT_BACKEND_BASE !== 'undefined' && ETRANSPORT_BACKEND_BASE) || '';
  var TIMEOUT_MS = 6000;

  function fetchJson(url, ms) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var opts = ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' };
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || TIMEOUT_MS);
    return fetch(url, opts).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) return null;
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }

  /* Салбарын сарын нэгтгэл — GET /api/sectors/:sector/summary.
     Буцаах утга: backend-ийн JSON эсвэл null (холбогдоогүй/алдаатай). */
  function fetchSectorSummary(sector) {
    if (!BASE) return Promise.resolve(null);
    return fetchJson(BASE + '/api/sectors/' + encodeURIComponent(sector) + '/summary')
      .catch(function (e) {
        console.info('[ErtHub] backend (' + sector + '/summary) уншигдсангүй:', e.message);
        return null;
      });
  }

  /* Вагон ачилт — ТУСДАА endpoint (summary БИШ). summary нь gold-ийн сарын
     нэгтгэл (rail-д зорчигчийн тоо) бөгөөд вагонтой өөр нэгжтэй тул хоёрыг
     хольж болохгүй. Хариу: {status,date,unit,count,unloaded_count,
     station_count,by_station[]} эсвэл {status:'no_data',count:null}. */
  function fetchRailWagonLoading() {
    if (!BASE) return Promise.resolve(null);
    return fetchJson(BASE + '/api/sectors/rail/wagon-loading')
      .catch(function (e) {
        console.info('[ErtHub] backend (rail/wagon-loading) уншигдсангүй:', e.message);
        return null;
      });
  }

  /* Вагон ачилтын ТҮҮХ — сарын нэгтгэл, станц, вагоны төрөл. from/to
     (YYYY-MM-DD) заавал биш. Хариу: {status,months[],by_station[],
     by_wagon_type[]} эсвэл {status:'no_data'}. Endpoint хараахан deploy
     болоогүй (404) бол fetchJson null буцаана — самбар "мэдээлэл алга". */
  function fetchRailWagonHistory(from, to) {
    if (!BASE) return Promise.resolve(null);
    var q = [];
    if (from) q.push('from=' + encodeURIComponent(from));
    if (to) q.push('to=' + encodeURIComponent(to));
    return fetchJson(BASE + '/api/sectors/rail/wagon-loading/history' + (q.length ? '?' + q.join('&') : ''))
      .catch(function (e) {
        console.info('[ErtHub] backend (rail/wagon-loading/history) уншигдсангүй:', e.message);
        return null;
      });
  }

  /* Ачаа тээврийн мэдээний ТҮҮХ — org = 'ubtz' | 'mtz' (migrations/020). Хариу:
     {status,months[{month,days,last_date,rows,<чиглэл>_tonnes|_wagons,tonnes,wagons}],
     by_station[],by_cargo[]} эсвэл {status:'no_data'}. 404/унтарсан бол null. */
  function fetchRailFreightHistory(org, from, to) {
    if (!BASE || !/^[a-z]+$/.test(String(org || ''))) return Promise.resolve(null);
    var q = [];
    if (from) q.push('from=' + encodeURIComponent(from));
    if (to) q.push('to=' + encodeURIComponent(to));
    return fetchJson(BASE + '/api/sectors/rail/freight/' + org + '/history' + (q.length ? '?' + q.join('&') : ''))
      .catch(function (e) {
        console.info('[ErtHub] backend (rail/freight/' + org + '/history) уншигдсангүй:', e.message);
        return null;
      });
  }

  /* Зорчигчийн галт тэрэгний ТҮҮХ — сар (ОН/ОУ), чиглэл, төрөл. from/to
     (YYYY-MM-DD) заавал биш. Хариу: {status,months[],by_route[],by_type[]}
     эсвэл {status:'no_data'}. 404/унтарсан бол null → "мэдээлэл алга". */
  function fetchRailPassengersHistory(from, to) {
    if (!BASE) return Promise.resolve(null);
    var q = [];
    if (from) q.push('from=' + encodeURIComponent(from));
    if (to) q.push('to=' + encodeURIComponent(to));
    return fetchJson(BASE + '/api/sectors/rail/passengers/history' + (q.length ? '?' + q.join('&') : ''))
      .catch(function (e) {
        console.info('[ErtHub] backend (rail/passengers/history) уншигдсангүй:', e.message);
        return null;
      });
  }

  /* Техникийн хяналтын үзлэг — ТУСДАА endpoint (road summary БИШ). road-ийн
     summary нь gold-ийн замын хөдөлгөөний ачаалал (vehicle_count) бөгөөд
     үзлэгийн тоо ӨӨР нэгжтэй тул хоёрыг хольж болохгүй. Хариу:
     {status,date,unit,count,passed,passed_minor,failed,vehicle_count,
      failed_by_category{},unchecked_emission,by_day[],by_aimag[]} эсвэл
     {status:'no_data',count:null}.
     НЭГЖ: "үзлэг" — нэг мөр = нэг үзлэг, тээврийн хэрэгсэл БИШ (нэг ТХ нэг
     өдөрт хоёр удаа орж болно; vehicle_count нь ТУСАД нь ирдэг). */
  function fetchRoadInspections() {
    if (!BASE) return Promise.resolve(null);
    return fetchJson(BASE + '/api/sectors/road/inspections')
      .catch(function (e) {
        console.info('[ErtHub] backend (road/inspections) уншигдсангүй:', e.message);
        return null;
      });
  }

  /* Техникийн хяналтын үзлэгийн ТҮҮХ — сарын нэгтгэл, аймгийн дүн, гаригийн
     дундаж. from/to (YYYY-MM-DD) заавал биш. Хариу: {status,months[],
     by_aimag[],by_weekday[7]} эсвэл {status:'no_data'}. Endpoint deploy
     болоогүй (404) бол null → шүүлт нуугдаж, самбар өмнөх шигээ ажиллана. */
  function fetchRoadInspectionsHistory(from, to) {
    if (!BASE) return Promise.resolve(null);
    var q = [];
    if (from) q.push('from=' + encodeURIComponent(from));
    if (to) q.push('to=' + encodeURIComponent(to));
    return fetchJson(BASE + '/api/sectors/road/inspections/history' + (q.length ? '?' + q.join('&') : ''))
      .catch(function (e) {
        console.info('[ErtHub] backend (road/inspections/history) уншигдсангүй:', e.message);
        return null;
      });
  }


  /* Тээврийн хэрэгслийн бүртгэл — ТУСДАА endpoint. road-ийн summary нь
     замын хөдөлгөөний ачаалал, inspections нь техникийн ҮЗЛЭГ — гуравдугаар
     хэмжигдэхүүн тул хольж болохгүй. Хариу:
     {status,as_of,total,kpi{},age{},breakdowns{},top{}} эсвэл
     {status:'no_data'}.
     ТӨЛӨВ (2026-09-29): backend дээр энэ зам хараахан НЭЭГДЭЭГҮЙ (404) —
     эх системийн хуудаслалт эвдэрсэн тул silver дүүрээгүй. fetchJson нь
     404-д null буцаадаг тул сайт ЯГ өмнөх шигээ ажиллана, самбар нь
     "мэдээлэл алга" хэвээр үлдэнэ (docs/veritech-vehicle-registry-request.md). */
  function fetchVehicleRegistry() {
    if (!BASE) return Promise.resolve(null);
    return fetchJson(BASE + '/api/sectors/road/vehicle-registry')
      .catch(function (e) {
        console.info('[ErtHub] backend (road/vehicle-registry) уншигдсангүй:', e.message);
        return null;
      });
  }

  /* Датасэтийн ТҮҮХИЙ мөр — эх сервисийн БҮХ багана (огноо ч мөн). Хариу:
     {status,columns:[{key,label,type}],rows:[[...]],total,truncated} эсвэл
     {status:'no_data'}. Endpoint deploy болоогүй (404) бол null — хүснэгт
     өмнөх нэгтгэлээрээ үлдэнэ. key: rail-wagon / rail-pax / road-inspections. */
  function fetchDatasetRows(key, from, to, limit) {
    if (!BASE) return Promise.resolve(null);
    var q = [];
    if (from) q.push('from=' + encodeURIComponent(from));
    if (to) q.push('to=' + encodeURIComponent(to));
    if (limit) q.push('limit=' + encodeURIComponent(limit));
    return fetchJson(BASE + '/api/datasets/' + encodeURIComponent(key) + '/rows' + (q.length ? '?' + q.join('&') : ''))
      .catch(function (e) {
        console.info('[ErtHub] backend (datasets/' + key + '/rows) уншигдсангүй:', e.message);
        return null;
      });
  }

  /* САЛБАРЫН НЭГТГЭЛ — gold.sector_daily_total (backend migrations/022): өдөр ×
     салбар, зорчигч ба ачаа (тонн). Хариу: {status,sectors[],months[],weekly{
     passengers,freight_tonnes}} эсвэл {status:'no_data'}. weekly нь зөвхөн
     шүүлтгүй дуудлагад. 404/унтарсан бол null → портал салбарын датасэтүүдээс
     сарын нэгтгэлийг өөрөө нийлүүлнэ (sectorTotalFallback). */
  function fetchSectorTotal(from, to) {
    if (!BASE) return Promise.resolve(null);
    var q = [];
    if (from) q.push('from=' + encodeURIComponent(from));
    if (to) q.push('to=' + encodeURIComponent(to));
    return fetchJson(BASE + '/api/sectors/total/history' + (q.length ? '?' + q.join('&') : ''))
      .catch(function (e) {
        console.info('[ErtHub] backend (sectors/total/history) уншигдсангүй:', e.message);
        return null;
      });
  }

  window.EHBackend = {
    enabled: !!BASE,
    fetchSectorTotal: fetchSectorTotal,
    fetchSectorSummary: fetchSectorSummary,
    fetchRailWagonLoading: fetchRailWagonLoading,
    fetchRailWagonHistory: fetchRailWagonHistory,
    fetchRailPassengersHistory: fetchRailPassengersHistory,
    fetchRailFreightHistory: fetchRailFreightHistory,
    fetchRoadInspections: fetchRoadInspections,
    fetchRoadInspectionsHistory: fetchRoadInspectionsHistory,
    fetchVehicleRegistry: fetchVehicleRegistry,
    fetchDatasetRows: fetchDatasetRows
  };
})();

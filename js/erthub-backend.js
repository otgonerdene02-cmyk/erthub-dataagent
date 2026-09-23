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

  window.EHBackend = {
    enabled: !!BASE,
    fetchSectorSummary: fetchSectorSummary,
    fetchRailWagonLoading: fetchRailWagonLoading,
    fetchRoadInspections: fetchRoadInspections
  };
})();

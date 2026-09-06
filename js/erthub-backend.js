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
 * АНХААРУУЛГА (HANDOFF-ээс): `/api/sectors/rail/summary` одоогоор
 * `silver.rail_operations`-с уншиж байгаа бөгөөд шинэ ETL хийсэн
 * `silver.rail_wagon_loading`-тэй хараахан ХОЛБООГҮЙ (backend талын
 * шийдвэр хүлээгдэж байна). Иймд энэ endpoint нийтийн болсон ч
 * "rail.wagon_loading" метрикийн утга нь тухайн шийдвэр гарах хүртэл
 * буруу/хуучин байж болзошгүй — metric_registry.json-д quality:"pending"
 * гэж ил тэмдэглэсэн шалтгаан яг энэ.
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

  function fetchRailWagonLoading() {
    return fetchSectorSummary('rail');
  }

  window.EHBackend = {
    enabled: !!BASE,
    fetchSectorSummary: fetchSectorSummary,
    fetchRailWagonLoading: fetchRailWagonLoading
  };
})();

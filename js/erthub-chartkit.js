/*
 * ErtHub — ЧАРТЫН СТАНДАРТ (CH): нэгдсэн «frame» рендер ба тэнхлэг
 * =====================================================================
 * ЯАГААД: өмнө нь декарт график бүр `<svg viewBox="0 0 720 250"
 * style="width:100%;height:auto">` хэлбэртэй байв. Ийм svg картынхаа өргөнөөр
 * ПРОПОРЦИОНАЛЬ томордог тул бүтэн өргөн картанд 412px өндөр болж, тэнхлэгийн
 * 10px шошго 16.5px болж (×1.65) «ганц чарт дэлгэц дүүргэсэн» бүдүүлэг
 * харагдац гарч байв (2026-10-28 хэрэглэгчийн гомдол, үзлэгийн «Сарын үзлэг»).
 * Гар утсан дээр эсрэгээр шошго 5px болж уншигдахгүй.
 *
 * ШИЙДЭЛ (мэргэжлийн dashboard-ын хэвшил — Datawrapper, FT, Stripe):
 *   • Зургийн талбай (plot) ТОГТМОЛ өндөртэй (`.eh-ch-s/m/l`), өргөн нь картаа
 *     дүүргэнэ. svg-ийн viewBox = зөвхөн plot тэгш өнцөгт,
 *     preserveAspectRatio="none" → багана/шугам сунана, харин
 *   • Бүх ТЕКСТ (тэнхлэг, утга, легенд) ба ЦЭГ нь HTML давхарга дээр, хувиар
 *     байрлана → үсгийн хэмжээ ҮРГЭЛЖ 10.5px, ямар ч өргөнд томрохгүй.
 *   • Шугамын зузаан `vector-effect:non-scaling-stroke` → 2px хэвээр.
 *
 * Модель үүсгэгч функцууд (buildDualAxisChart …) ӨӨРЧЛӨГДӨХГҮЙ — тестүүд
 * тэднийг тусгаарлан eval хийдэг. Дуудагч тал `EHChartKit.fromModel()`-оор
 * тэдний гаралтыг frame болгоно; шинэ график `EHChartKit.frame()`-ийг шууд
 * (plot-ын 0…1000 координатаар) ашиглана. Темплейт НЭГ ЖИШИГ (CLAUDE.md CH).
 *
 * ДҮРЭМ: тоо зохиохгүй — энэ модуль зөвхөн геометр/шошгыг хувиргана.
 */
(function (root) {
  'use strict';

  /* ── Тэнхлэг ─────────────────────────────────────────────────────────── */

  /* 1 / 2 / 2.5 / 5 × 10^k алхам */
  function niceStep(raw) {
    if (!(raw > 0) || !isFinite(raw)) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }

  /* [lo, hi]-ийг багтаах «гоё» тэнхлэг: алхам бүр дугуй тоо, дээд tick ≥ hi.
     Сөрөг байж чадахгүй хэмжигдэхүүнд lo=0 өгнө (DG: Y тэнхлэг 0-ээс).
     ЯАГААД: өмнө нь зарим график дээд утгыг 4-т хуваадаг байсан тул
     «1.3M · 2.5M · 3.8M» (1.25M-ийн алхмыг тойруулсан — ХУДАЛ шошго),
     «15,710 · 31,420» (max/2) гэх мэт тэнхлэг гарч байв. */
  function axis(lo, hi, target) {
    target = target || 4;
    lo = +lo; hi = +hi;
    if (!isFinite(lo)) lo = 0;
    if (!isFinite(hi)) hi = 1;
    if (hi < lo) { var t = hi; hi = lo; lo = t; }
    if (hi === lo) { if (hi === 0) hi = 1; else if (hi > 0) lo = 0; else hi = 0; }
    var step = niceStep((hi - lo) / target);
    var a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    if (b <= a) b = a + step;
    var ticks = [];
    for (var v = a; v <= b + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    return { lo: a, hi: b, step: step, ticks: ticks };
  }

  /* Тэнхлэгийн шошго — НЭГ дүрэм (бүх график):
     • дээд tick < 100,000 → бүтэн тоо мянгатын таслалтай («40,000»);
     • түүнээс их → K / M товчлол, аравтын орон нь АЛХМААС шалтгаална
       («250K», «2.5M», «0.25M») — алхам 1.25M-ийг «1.3M» гэж тойруулахгүй.
     pct=true бол «12.5%». */
  function tickLabel(v, ax, opt) {
    opt = opt || {};
    var step = (ax && ax.step) || 1, top = Math.max(Math.abs((ax && ax.hi) || 0), Math.abs((ax && ax.lo) || 0));
    var dec = function (s) {
      if (!(s > 0)) return 0;
      for (var d = 0; d < 4; d++) if (Math.abs(Math.round(s * Math.pow(10, d)) - s * Math.pow(10, d)) < 1e-6) return d;
      return 4;
    };
    var sign = opt.signed && v > 0 ? '+' : '';
    if (opt.pct) return sign + (+v).toFixed(dec(step)) + '%';
    if (top < 100000 || opt.full) {
      var d0 = dec(step);
      return sign + (+v).toLocaleString('en-US', { minimumFractionDigits: d0, maximumFractionDigits: d0 });
    }
    var unit = top >= 1e6 ? 1e6 : 1e3, suf = top >= 1e6 ? 'M' : 'K';
    if (v === 0) return '0';
    var d1 = dec(step / unit);
    return sign + (+(v / unit).toFixed(d1)).toLocaleString('en-US', { maximumFractionDigits: d1 }) + suf;
  }

  /* ── Frame ───────────────────────────────────────────────────────────── */

  var pct = function (v) { return (Math.round(v * 100) / 100) + '%'; };
  var num = function (v) { return (Math.round(+v * 10) / 10).toString(); };

  /* Шошгын өргөний ойролцоо (JetBrains Mono 10.5px ≈ 6.4px/тэмдэгт). */
  function labelW(s) { return String(s == null ? '' : s).length * 6.3 + 8; }

  /* X шошгыг давхцуулахгүй сийрүүлнэ — plot-ын БОДИТ өргөнөөр (CSS container query):
     шошго бүрт «энэ өргөнөөс доош нуу» анги (`eh-ch-xw<T>`, style.css). Алхам нь 2-ын
     зэрэг (1, 2, 4, 8…) тул нарийн өргөнд үлдэх шошго өргөнд ч үлддэг (үсрэхгүй).
     Эхний ба СҮҮЛИЙН (ихэвчлэн дутуу сар «*») шошго үргэлж үлдэнэ.
     ЯАГААД: өмнө нэг «хамгийн бага өргөн»-өөр тооцоход 512px картанд 10 сарын тал нь
     нуугдаж байв; гар утсан дээр эсрэгээр давхцаж байв. */
  var TIERS = [1400, 1040, 820, 640, 480, 360, 260];
  function thinX(gx) {
    if (!gx.length) return gx;
    gx = gx.map(function (t, i) { return { pos: t.pos, label: t.label, i: i }; });
    var w = Math.max.apply(null, gx.map(function (t) { return labelW(t.label); }));
    var span = function (list) {
      if (list.length < 2) return Infinity;
      var lo = Infinity;
      for (var i = 1; i < list.length; i++) lo = Math.min(lo, (list[i].pos - list[i - 1].pos) / 100);
      return lo;
    };
    var last = gx[gx.length - 1];
    var keepAt = function (W) {
      var keep = gx, k = 1;
      while (keep.length > 2 && span(keep) * W < w) {
        k *= 2;
        keep = gx.filter(function (t) { return t.i % k === 0; });
        if (keep[keep.length - 1] !== last) {
          /* Сүүлийнхийг заавал үлдээнэ — өмнөхтэй хэт ойр бол өмнөхийг хасна */
          if (keep.length > 1 && (last.pos - keep[keep.length - 1].pos) / 100 * W < w) keep.pop();
          keep.push(last);
        }
      }
      return keep;
    };
    var minTier = {};
    TIERS.forEach(function (T) { keepAt(T).forEach(function (t) { minTier[t.i] = T; }); });
    return keepAt(TIERS[0]).map(function (t) {
      var mt = minTier[t.i];
      return { left: pct(t.pos), label: t.label,
        cls: 'eh-ch-xl' + (mt > TIERS[TIERS.length - 1] ? ' eh-ch-xw' + mt : '') };
    });
  }

  /* Легендийн дээж — график дээрх тэмдэгтэй ЯГ ижил хэв (өнгө, тунгалаг). */
  function legendItem(l) {
    var kind = l.kind || 'bar';
    var op = l.op == null ? '' : ';opacity:' + l.op;
    var style = kind === 'line' ? 'background:' + l.color + op
      : kind === 'dash' ? 'border-top-color:' + l.color + op
        : kind === 'dot' ? 'background:' + l.color + op
          : kind === 'hollow' ? 'border-color:' + l.color + op
            : 'background:' + l.color + op;
    return { label: l.label, sw: 'eh-ch-sw eh-ch-sw-' + kind, style: style };
  }

  /* Ерөнхий frame. Оролт нь plot тэгш өнцөгтийн координатаар (box=[x0,y0,x1,y1],
     анхдагч 0…1000 × 0…1000):
       y / y2   [{y, label}]           — зүүн (сүлжээтэй) / баруун тэнхлэг
       x        [{x, label}]           — категорийн төв
       rects    [{x,y,w,h,fill,op,tip,stroke,dash,rx}]
       paths    [{d,stroke,sw,dash,fill,fop}]
       dots     [{x,y,tip,color,hollow}]
       vals     [{x,y,label}]          — баганын орой дээрх утга
       legend   [{label,color,kind:'bar'|'line'|'dash'|'dot'|'hollow',op}]
       size     's'|'m'|'l' (plot-ын өндөр), n — категорийн тоо (аудит:
                богино цуваа бүтэн өргөнд ганцаараа байх ёсгүй — layout-audit chart-lonely). */
  function frame(o) {
    o = o || {};
    var b = o.box || [0, 0, 1000, 1000];
    var x0 = +b[0], y0 = +b[1], pw = (+b[2] - x0) || 1, ph = (+b[3] - y0) || 1;
    var px = function (x) { return (x - x0) / pw * 100; };
    var py = function (y) { return (y - y0) / ph * 100; };
    var gy = (o.y || []).map(function (t) {
      var top = py(+t.y);
      return { top: pct(top), label: t.label, cls: 'eh-ch-gl' + (Math.abs(top - 100) < 0.5 ? ' eh-ch-base' : '') };
    });
    var gy2 = (o.y2 || []).map(function (t) { return { top: pct(py(+t.y)), label: t.label }; });
    var gx = thinX((o.x || []).map(function (t) { return { pos: px(+t.x), label: t.label == null ? '' : String(t.label) }; })
      .filter(function (t) { return t.pos >= -1 && t.pos <= 101; }));
    var rects = (o.rects || []).map(function (r) {
      return { x: num(r.x), y: num(r.y), w: num(Math.max(0, +r.w)), h: num(Math.max(0, +r.h)), fill: r.fill || 'var(--ink3)',
        op: r.op == null ? '1' : String(r.op), tip: r.tip || '', stroke: r.stroke || 'none', dash: r.dash || '', rx: r.rx == null ? '0' : String(r.rx) };
    });
    var paths = (o.paths || []).filter(function (p) { return p && p.d; }).map(function (p) {
      return { d: p.d, stroke: p.stroke || 'none', sw: String(p.sw == null ? 2 : p.sw), dash: p.dash || '',
        fill: p.fill || 'none', fop: p.fop == null ? '1' : String(p.fop) };
    });
    var dots = (o.dots || []).map(function (d) {
      var c = d.color || 'var(--ink2)';
      return { left: pct(px(+d.x)), top: pct(py(+d.y)), tip: d.tip || '',
        bg: d.hollow ? 'var(--surface)' : c, bd: c,
        /* hover — олон шугамын дунд цэг: зөвхөн хулгана очиход тодорно (tooltip хэвээр, шугам цэвэр) */
        cls: 'eh-ch-dot' + (d.hollow ? ' eh-ch-dot-o' : '') + (d.hover && !d.hollow ? ' eh-ch-dot-h' : '') };
    });
    /* Утгын шошго цэгийн дээр төвлөрнө; plot-ын ирмэгт ойр бол дотогш зэрэгцэнэ (карт тасдахгүй) */
    var vals = (o.vals || []).map(function (v) {
      var l = px(+v.x), a = v.anchor || (l > 82 ? 'end' : l < 18 ? 'start' : '');
      return { left: pct(l), top: pct(py(+v.y)), label: v.label, cls: 'eh-ch-vl' + (a ? ' eh-ch-vl-' + a.charAt(0) : '') };
    });
    var legend = (o.legend || []).filter(function (l) { return l && l.label; }).map(legendItem);
    var size = o.size === 's' || o.size === 'l' ? o.size : 'm';
    var cls = 'eh-ch eh-ch-' + size + (gy2.length ? ' eh-ch-y2' : '') + (gy.length || o.gutter ? '' : ' eh-ch-noy');
    return {
      cls: cls, n: String(o.n == null ? gx.length : o.n), vb: [x0, y0, pw, ph].map(num).join(' '),
      gy: gy, gy2: gy2, y2c: o.y2Color || 'var(--ink3)', gx: gx,
      rects: rects, paths: paths, dots: dots, vals: vals,
      legend: legend, hasLegend: legend.length > 0
    };
  }

  /* Одоогийн модель үүсгэгчдийн (buildDualAxisChart, buildPaxStackedChart,
     buildFreightStackedChart, buildFreightWeekChart, buildSectorStackChart,
     buildTrendChart) гаралтыг frame болгоно. Тэдний координат
     (w×h, padL/padR/padT/padB) хэвээр — viewBox нь plot хэсгийг л тайрна.
     opt:
       box      — [x0,y0,x1,y1] (анхдагч: padL…w-padR × padT…h-padB)
       xw       — xTicks-ийн `fx` нь foreignObject-ийн ЗҮҮН ирмэг бол түүний өргөн
       barFill / barOp / prevFill / prevOp — баганын өнгө (модельд байхгүй үед)
       line     — {stroke, sw, dash}  m.line-ийн хэв
       fline / band / area — trend-ийн прогноз/зурвас/талбай
       dotColor — цэгийн өнгө (модель d.color/d.fill-гүй үед)
       y2Color, legend, size, minW, n */
  /* Моделийн tick-ийг НЭГ дүрмээр (tickLabel) дахин шошголно — дээд tick ≥100,000 бол K/M,
     аравтын орон АЛХМААС. Модель түүхий утгыг `v`-д өгнө; өгөөгүй бол бүтэн тоон шошгоос
     уншина. ЯАГААД: модель бүр өөрөөр тойруулдаг байсан — алхам 0.25%-ийг «+0.3%»,
     1.25M-ийг «1.3M» гэж ХУДАЛ шошголж байв. «%» шошго хувиар, «+» тэмдэгтэй хэвээр. */
  function relabel(ticks) {
    ticks = ticks || [];
    var isPct = ticks.length > 0 && ticks.every(function (t) { return /%$/.test(String(t.label == null ? '' : t.label)); });
    var vals = ticks.map(function (t) {
      if (t.v != null && t.v !== '' && isFinite(+t.v)) return +t.v;
      var s = String(t.label == null ? '' : t.label).replace(/,/g, '');
      return /^[+-]?\d+(\.\d+)?$/.test(s) ? +s : NaN;
    });
    if (ticks.length < 2 || vals.some(isNaN)) return ticks;
    var ax = { step: Math.abs(vals[1] - vals[0]), hi: Math.max.apply(null, vals), lo: Math.min.apply(null, vals) };
    return ticks.map(function (t, i) {
      return { y: t.y, label: tickLabel(vals[i], ax, { pct: isPct, signed: /^\+/.test(String(t.label)) }) };
    });
  }

  function fromModel(m, opt) {
    m = m || {}; opt = opt || {};
    var w = +m.w || 600, h = +m.h || 170;
    var padL = m.padL != null ? +m.padL : (m.axisX1 != null ? +m.axisX1 : 46);
    var padR = m.padR != null ? +m.padR : (m.axisX2 != null ? w - +m.axisX2 : 12);
    var padT = m.padT != null ? +m.padT : 16;
    var padB = m.padB != null ? +m.padB : (m.axisYBottom != null ? h - +m.axisYBottom : 32);
    var box = opt.box || [padL, padT, w - padR, h - padB];
    var xw = opt.xw || 40;
    var xs = (m.xTicks || []).map(function (t) {
      return { x: t.x != null && t.x !== '' ? +t.x : (+t.fx + xw / 2), label: t.label };
    });
    var rects = [];
    (m.prevRects || []).forEach(function (r) {
      rects.push({ x: r.x, y: r.y, w: r.w, h: r.h, fill: r.fill || opt.prevFill || opt.barFill, op: r.op != null && opt.prevOp == null ? r.op : (opt.prevOp == null ? '.35' : opt.prevOp), tip: r.tip, rx: opt.rx });
    });
    (m.barRects || m.bars || []).forEach(function (r) {
      var op = opt.barOpKey ? r[opt.barOpKey] : (r.op != null ? r.op : opt.barOp);
      if (opt.barOpMap && r.op != null) op = opt.barOpMap[r.op] != null ? opt.barOpMap[r.op] : r.op;
      rects.push({ x: r.x, y: r.y, w: r.w, h: r.h, fill: r.fill || opt.barFill, op: op == null ? '.85' : op, tip: r.tip,
        stroke: r.stroke && r.stroke !== 'none' ? r.stroke : '', dash: r.dash || '', rx: opt.rx });
    });
    var paths = [];
    if (m.area && opt.area) paths.push({ d: m.area, fill: opt.area.fill, fop: opt.area.fop, stroke: 'none' });
    if (m.band && opt.band) paths.push({ d: m.band, fill: opt.band.fill, fop: opt.band.fop, stroke: 'none' });
    if (m.line) paths.push({ d: m.line, stroke: (opt.line && opt.line.stroke) || opt.dotColor || 'var(--ink2)',
      sw: (opt.line && opt.line.sw) || 2, dash: (opt.line && opt.line.dash) || '' });
    if (m.fline && opt.fline) paths.push({ d: m.fline, stroke: opt.fline.stroke, sw: opt.fline.sw || 1.6, dash: opt.fline.dash || '5 4' });
    (opt.extraPaths || []).forEach(function (p) { paths.push(p); });
    var dots = (m.dotPts || []).map(function (d) {
      /* Дутуу сар — hollow (DG-P). Зарим модель зөвхөн tooltip-д «(дутуу сар)» гэж тэмдэглэдэг. */
      var hollow = !!(d.fill && /surface/.test(d.fill)) || !!d.hollow || /\(дутуу/.test(d.tip || '');
      return { x: d.cx, y: d.cy, tip: d.tip, color: d.color || opt.dotColor, hollow: hollow };
    });
    /* Категорийн тоо (аудит: богино цуваа бүтэн өргөнд ганцаараа байх ёсгүй).
       Модельд X шошго сийрүүлэгдсэн байж болох тул дуудагч цувааны уртыг өгнө. */
    var n = opt.n != null ? opt.n : Math.max(dots.length, xs.length);
    return frame({
      box: box, size: opt.size, n: n,
      y: relabel(m.yTicksLeft || m.yTicks), y2: relabel(m.yTicksRight), y2Color: opt.y2Color,
      x: xs, rects: rects, paths: paths, dots: opt.noDots ? [] : dots, vals: opt.vals || [],
      legend: opt.legend, minW: opt.minW
    });
  }

  /* ── Нэг загварт олон дуудагч: сайт ба админы preview НЭГ хувиргалт ─────────────────────
     ЯАГААД: нүүрийн t05/i06-ийг сайт frame-ээр, админы preview өөрийн хялбар шугамаар зурж
     зөрдөг байв (2026-10-29) — preview ба сайт зөрөх нь энэ төслийн хамгийн их давтагдсан
     алдаа (CLAUDE.md). Доорх хоёр функц өгөгдлийг ДУУДАГЧААС авч, дүрс/шошго/tooltip-ийг
     НЭГ дүрмээр гаргана — хоёр тал ижил оролттой бол ижил график. */

  var isNum = function (v) { return v != null && v !== '' && isFinite(+v); };
  var shallow = function (m) { var o = {}; for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) o[k] = m[k]; return o; };

  /* Сарын чиг хандлага (EHGlossary.trendModel-ийн гаралт) → frame. Нүүрийн t05, датасэтийн
     «чиг хандлага» ба админы t05 preview. o:
       color   — шугам/цэг/талбайн өнгө
       n, size — ангиллын тоо (аудит), plot-ын өндөр
       est     — {partials:[{days,dim}|null], off, tip:'{d}/{m} …', label} цоорхойтой сарууд:
                 hollow цэг, tooltip-д «(N/M хоног …)», оргил «≈», легендэд нэг мөр (DG: дутуу ≠ бүтэн)
       peak    — үг («оргил») өгвөл оргил цэгийн дээр «оргил N» шошго
       avg     — true бол дундаж шугам (тасархай) + «дундаж N» шошго
     Таамгийн шугам/зурвас нь модель өөрөө (fline/band хоосон бол зурахгүй). Дутуу (одоогийн) сар —
     тусдаа hollow цэг, богино шошго нь легендэд (цэгийн хажууд бичвэл таамгийн шугамтай давхцана). */
  function trendFrame(T, o) {
    if (!T) return null;
    o = o || {};
    var c = o.color || 'var(--ink2)';
    var est = (o.est && Array.isArray(o.est.partials)) ? o.est : null, eoff = est ? (est.off || 0) : 0;
    var pkI = -1;
    var dots = (T.dotPts || []).map(function (d, i) {
      var p = est ? est.partials[i + eoff] : null;
      if (pkI < 0 && T.peak && d.cx === T.peak.cx && d.cy === T.peak.cy) pkI = i;
      return { cx: d.cx, cy: d.cy, color: c, hollow: !!p,
        tip: d.tip + (p ? ' (' + String(est.tip || '{d}/{m}').replace('{d}', p.days).replace('{m}', p.dim) + ')' : '') };
    });
    var hasEst = dots.some(function (d) { return d.hollow; });
    if (T.hasPartial) dots.push({ cx: T.partialCx, cy: T.partialCy, tip: T.partialLabel, color: c, hollow: true });
    var extra = [], vals = [];
    if (T.fline) extra.push({ d: 'M' + T.fcSplitX + ',' + T.padT + ' L' + T.fcSplitX + ',' + T.axisY, stroke: 'var(--line2)', sw: 1, dash: '2 4' });
    if (o.avg && isNum(T.avgY)) {
      extra.push({ d: 'M' + T.axisX1 + ',' + T.avgY + ' L' + T.axisX2 + ',' + T.avgY, stroke: 'var(--ink3)', sw: 1, dash: '3 4' });
      vals.push({ x: +T.axisX1, y: +T.avgY, label: T.avgLabel, anchor: 'start' });
    }
    if (o.peak && pkI >= 0) {
      /* Оргил нь тооцоолсон (цоорхойтой) сар бол «≈» — эквивалентыг бүртгэгдсэн дүн мэт харуулахгүй */
      vals.push({ x: +T.peak.cx, y: +T.peak.cy, label: o.peak + ' ' + (est && est.partials[pkI + eoff] ? '≈' : '') + T.peak.value });
    }
    var legend = (T.legend || []).map(function (l) {
      var kind = l.lineStyle === 'dashed' ? 'dash' : l.lineStyle === 'dotted' ? 'hollow' : 'line';
      return { label: l.key === 'partial' && T.partialShort ? T.partialShort : l.label, color: c, kind: kind };
    }).concat(hasEst && est.label ? [{ label: est.label, color: c, kind: 'hollow' }] : []);
    var m = shallow(T); m.dotPts = dots;
    return fromModel(m, { line: { stroke: c, sw: 2.4 }, dotColor: c, size: o.size, n: o.n != null ? o.n : (T.dotPts || []).length,
      area: { fill: c, fop: 0.1 }, band: T.band ? { fill: c, fop: 0.13 } : null, fline: T.fline ? { stroke: c, sw: 2, dash: '6 5' } : null,
      extraPaths: extra, vals: vals, legend: legend });
  }

  /* Олон салбарын индексийн шугам (нүүрийн i06 «Салбар хоорондын харьцуулалт») → frame. o:
       labels — X ангилал (сарын нэр), lines [{key,label,color,vals:[v|null], hollow:[bool], note:[str]}]
       unit   — tooltip-ийн нэгж («индекс»), base — суурь утга (100; тасархай шугам, тэнхлэгт багтана)
       est    — hollow цэгийн легенд, size
     Мэдээгүй сар (null) — шугам ТАСАРНА (M), 0 гэж зурахгүй. Цэг бүр tooltip-тэй «Нэр — сар: N индекс»;
     төгсгөлийн цэг тод, дунд цэг hover-оор (eh-ch-dot-h), дутуу сар hollow. Төгсгөлийн утга (Math.round)
     plot-ын БАРУУН захад шугамын өнгөөр, давхцахгүй сийрүүлнэ (fr.ends). Шугамгүй бол null (EMP). */
  function compare(o) {
    o = o || {};
    var labels = o.labels || [], N = labels.length;
    var lines = (o.lines || []).filter(function (l) { return l && (l.vals || []).some(isNum); });
    if (!N || !lines.length) return null;
    var base = isNum(o.base) ? +o.base : null, all = base != null ? [base] : [];
    lines.forEach(function (l) { l.vals.forEach(function (v) { if (isNum(v)) all.push(+v); }); });
    var ax = axis(Math.min.apply(null, all), Math.max.apply(null, all));
    var X = function (i) { return N > 1 ? i / (N - 1) * 1000 : 500; };
    var Y = function (v) { return 1000 - (v - ax.lo) / ((ax.hi - ax.lo) || 1) * 1000; };
    var paths = [], dots = [], ends = [], hasHollow = false;
    if (base != null) paths.push({ d: 'M0,' + num(Y(base)) + ' L1000,' + num(Y(base)), stroke: 'var(--ink3)', sw: 1, dash: '3 4' });
    lines.forEach(function (l) {
      var d = '', pen = false, li = -1;
      l.vals.forEach(function (v, i) {
        if (!isNum(v)) { pen = false; return; }
        d += (pen ? ' L' : (d ? ' M' : 'M')) + num(X(i)) + ',' + num(Y(+v)); pen = true; li = i;
      });
      paths.push({ d: d, stroke: l.color, sw: 2.2 });
      l.vals.forEach(function (v, i) {
        if (!isNum(v)) return;
        var hol = !!(l.hollow && l.hollow[i]);
        if (hol) hasHollow = true;
        dots.push({ x: X(i), y: Y(+v), color: l.color, hollow: hol, hover: i !== li,
          tip: l.label + ' — ' + labels[i] + ': ' + Math.round(+v) + (o.unit ? ' ' + o.unit : '') + ((l.note && l.note[i]) || '') });
      });
      ends.push({ t: Y(+l.vals[li]) / 10, label: String(Math.round(+l.vals[li])), color: l.color });
    });
    /* Төгсгөлийн шошго ≥7.5% зайтай (гар утасны 164px plot-д ≈12px) — дээрээс доош түлхэж, доод
       ирмэгээс хэтэрвэл бүгдийг дээш шилжүүлнэ. */
    ends.sort(function (a, b) { return a.t - b.t; });
    var prev = -1e9;
    ends.forEach(function (e) { if (e.t - prev < 7.5) e.t = prev + 7.5; prev = e.t; });
    var over = ends.length ? ends[ends.length - 1].t - 100 : 0;
    if (over > 0) ends.forEach(function (e) { e.t -= over; });
    var fr = frame({ size: o.size, n: N,
      y: ax.ticks.map(function (v) { return { y: Y(v), label: tickLabel(v, ax) }; }),
      x: labels.map(function (lb, i) { return { x: X(i), label: lb }; }),
      paths: paths, dots: dots,
      legend: lines.map(function (l) { return { label: l.label, color: l.color, kind: 'line' }; })
        .concat(hasHollow && o.est ? [{ label: o.est, color: 'var(--ink3)', kind: 'hollow' }] : []) });
    fr.cls += ' eh-ch-y2';
    fr.ends = ends.map(function (e) { return { top: pct(e.t), label: e.label, color: e.color }; });
    fr.base = base != null ? { top: pct(Y(base) / 10) } : null;
    return fr;
  }

  /* Frame-ийг HTML мөр болгоно — dc-runtime-гүй хуудас (админы preview) сайтын темплейтийн FRAME
     хэсэгтэй ЯГ ижил бүтэц/анги зурна (index.html: .eh-ch-lg → .eh-ch-plot → svg → цэг → утга → X).
     esc — HTML escape. extraLegend — легендийн төгсгөлд нэмэх HTML (жиш. суурь шугамын тайлбар). */
  function html(fr, esc, extraLegend) {
    if (!fr) return '';
    esc = esc || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
    var a = function (s) { return esc(s == null ? '' : s); };
    var lg = (fr.hasLegend || extraLegend) ? '<div class="eh-ch-lg">' + fr.legend.map(function (l) {
      return '<span><i class="' + a(l.sw) + '" style="' + a(l.style) + '"></i>' + a(l.label) + '</span>'; }).join('') + (extraLegend || '') + '</div>' : '';
    return '<div class="' + a(fr.cls) + '" data-eh-chart="' + a(fr.n) + '">' + lg + '<div class="eh-ch-plot">' +
      fr.gy.map(function (t) { return '<div class="' + a(t.cls) + '" style="top:' + a(t.top) + ';"><span>' + a(t.label) + '</span></div>'; }).join('') +
      fr.gy2.map(function (t) { return '<div class="eh-ch-yr" style="top:' + a(t.top) + ';color:' + a(fr.y2c) + ';">' + a(t.label) + '</div>'; }).join('') +
      (fr.ends || []).map(function (e) { return '<div class="eh-ch-yr eh-ch-end" style="top:' + a(e.top) + ';color:' + a(e.color) + ';">' + a(e.label) + '</div>'; }).join('') +
      '<svg class="eh-ch-svg" viewBox="' + a(fr.vb) + '" preserveAspectRatio="none">' +
      fr.rects.map(function (r) { return '<rect x="' + a(r.x) + '" y="' + a(r.y) + '" width="' + a(r.w) + '" height="' + a(r.h) + '" rx="' + a(r.rx) +
        '" fill="' + a(r.fill) + '" fill-opacity="' + a(r.op) + '" stroke="' + a(r.stroke) + '" stroke-dasharray="' + a(r.dash) +
        '" vector-effect="non-scaling-stroke"><title>' + a(r.tip) + '</title></rect>'; }).join('') +
      fr.paths.map(function (p) { return '<path d="' + a(p.d) + '" fill="' + a(p.fill) + '" fill-opacity="' + a(p.fop) + '" stroke="' + a(p.stroke) +
        '" stroke-width="' + a(p.sw) + '" stroke-dasharray="' + a(p.dash) + '" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" pointer-events="none"></path>'; }).join('') +
      '</svg>' +
      fr.dots.map(function (d) { return '<i class="' + a(d.cls) + '" style="left:' + a(d.left) + ';top:' + a(d.top) + ';background:' + a(d.bg) +
        ';border-color:' + a(d.bd) + ';" data-tip="' + a(d.tip) + '"></i>'; }).join('') +
      fr.vals.map(function (v) { return '<div class="' + a(v.cls) + '" style="left:' + a(v.left) + ';top:' + a(v.top) + ';">' + a(v.label) + '</div>'; }).join('') +
      fr.gx.map(function (x) { return '<div class="' + a(x.cls) + '" style="left:' + a(x.left) + ';">' + a(x.label) + '</div>'; }).join('') +
      '</div></div>';
  }

  var out = { niceStep: niceStep, axis: axis, tickLabel: tickLabel, frame: frame, fromModel: fromModel, thinX: thinX, relabel: relabel,
    trendFrame: trendFrame, compare: compare, html: html };
  root.EHChartKit = out;
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof window !== 'undefined' ? window : this);

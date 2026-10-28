/* CS — ЧАРТЫН СТАНДАРТЫН проб (tests/run.js CS бүлэг). Датасэтийн хуудас бүрийг
   фикстурын өгөгдөлтэй (?fx=1) ЖИНХЭНЭ хөтчөөр зурж, график бүрийн ХАРАГДАЦЫГ хэмжинэ:

     • frame (`.eh-ch[data-eh-chart]`) — plot-ын өндөр хэмжээний ангитайгаа таарах
       (s 138 / m 196 / l 232px), шошгын үсэг 9.5–11px (картын өргөнөөр томрохгүй),
       харагдах X шошго давхцахгүй, NaN/undefined алга;
     • сунадаг svg — харьцаагаар томорсон (рендер өндөр / viewBox өндөр > 1.25) svg
       график (data-ch-ok-гүй) — 2026-10-28 «бүдүүлэг» гомдлын ЯГ хэлбэр;
     • ганцаараа — <15 ангилалтай график iframe-ийн 62%-иас өргөн;
     • үзлэгийн «Тэнцээгүй хувь» — цэг бүрийн хувь = тэнцээгүй / үзлэг (tooltip-оос).

   Closure-гүй: `.toString()`-ээр хуудас руу тарьдаг. */
module.exports = async function chartProbe(d0, w0, routes, widths) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = w0.frameElement;
  const out = {};
  for (const W of (widths || [1400])) {
  frame.style.width = W + 'px';
  for (const route of routes) {
    frame.src = 'about:blank';
    await sleep(150);
    frame.src = route;
    let d = null, w = null;
    for (let t = 0; t < 60; t++) {
      await sleep(250);
      try { d = frame.contentDocument; w = frame.contentWindow; } catch (e) { d = null; }
      if (d && d.body && d.body.innerHTML.length > 8000 && String(w.location.href).indexOf(route.split('#')[0]) >= 0) break;
    }
    if (!d || !d.body) { out[W + ' ' + route] = { __err: 'ачаалагдсангүй' }; continue; }
    await sleep(3500);
    for (const y of [0, 900, 1800, 2700, 3600, 4500, 5400, 6300, 7200]) { w.scrollTo(0, y); await sleep(120); }
    await sleep(400);

    const vw = w.innerWidth;
    const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && w.getComputedStyle(e).display !== 'none'; };
    const titleOf = (el) => {
      let c = el;
      for (let k = 0; k < 6 && c; k++) {
        c = c.parentElement;
        const t = c && c.querySelector('[data-chart-period]');
        if (t && t.previousElementSibling) return t.previousElementSibling.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
      }
      return '';
    };
    const R = { vw, frames: [], scaled: [], insp: null };
    /* style.css: ≤640px гар утас, ≤1100px L-ийг намсгана */
    const EXPECT = vw <= 640 ? { s: 124, m: 164, l: 184 } : { s: 138, m: 196, l: vw <= 1100 ? 210 : 232 };
    [...d.querySelectorAll('.eh-ch[data-eh-chart]')].filter(shown).forEach((c) => {
      const plot = c.querySelector('.eh-ch-plot');
      const size = (c.className.match(/\beh-ch-([sml])\b/) || [])[1] || '?';
      const labs = [...c.querySelectorAll('.eh-ch-xl, .eh-ch-gl > span, .eh-ch-yr, .eh-ch-vl')].filter(shown);
      const fs = labs.map((e) => parseFloat(w.getComputedStyle(e).fontSize));
      const xs = [...c.querySelectorAll('.eh-ch-xl')].filter(shown).map((e) => e.getBoundingClientRect())
        .sort((a, b) => a.left - b.left);
      let overlap = 0;
      for (let i = 1; i < xs.length; i++) if (xs[i].left < xs[i - 1].right - 2) overlap++;
      const txt = c.innerText || '';
      R.frames.push({
        title: titleOf(c), n: +c.getAttribute('data-eh-chart'), size,
        w: Math.round(c.getBoundingClientRect().width), plotH: plot ? Math.round(plot.getBoundingClientRect().height) : 0,
        expH: EXPECT[size] || 0, fsMin: fs.length ? Math.min(...fs) : 0, fsMax: fs.length ? Math.max(...fs) : 0,
        nLabels: labs.length, nX: xs.length, overlap, raw: /NaN|undefined|\[object|\{\{/.test(txt),
        tips: [...c.querySelectorAll('[data-tip], rect > title')].length
      });
    });
    [...d.querySelectorAll('svg')].filter((s) => !s.ownerSVGElement && shown(s) && !s.classList.contains('eh-ch-svg')).forEach((s) => {
      if (s.closest('[data-ch-ok]') || s.hasAttribute('data-ch-ok')) return;
      const vb = s.viewBox && s.viewBox.baseVal;
      const r = s.getBoundingClientRect();
      if (!vb || !(vb.height > 0) || r.width < 300 || r.height > 900) return;
      const ratio = r.height / vb.height;
      if (ratio > 1.25) R.scaled.push({ title: titleOf(s), vb: vb.width + '×' + vb.height, px: Math.round(r.width) + '×' + Math.round(r.height), ratio: +ratio.toFixed(2) });
    });
    /* Үзлэг: сарын багана ба тэнцээгүй хувийн цэг */
    const rate = d.querySelector('[data-ri-monthly] > div:nth-child(2) .eh-ch');
    if (rate) {
      R.insp = {
        dots: [...rate.querySelectorAll('.eh-ch-dot')].map((e) => ({ tip: e.getAttribute('data-tip') || '', hollow: e.classList.contains('eh-ch-dot-o') })),
        legend: [...rate.querySelectorAll('.eh-ch-lg > span')].map((e) => e.textContent.trim()),
        yLabels: [...rate.querySelectorAll('.eh-ch-gl > span')].map((e) => e.textContent.trim()),
        monthTips: [...d.querySelectorAll('[data-ri-monthly] > div:nth-child(1) .eh-ch-svg rect > title')].map((t) => t.textContent)
      };
    }
    out[W + ' ' + route] = R;
  }
  }
  frame.style.width = '1400px';
  return out;
};

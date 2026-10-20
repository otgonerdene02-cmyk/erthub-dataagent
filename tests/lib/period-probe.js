/* DG-P хамрах хүрээний проб: хуудас БҮРИЙГ ачаалж, график/диаграм/эрэмбийн
   жагсаалт бүр гарчгийнхаа доор [data-chart-period] мөртэй эсэхийг ЖИНХЭНЭ
   хөтчөөр тоолно. Шинэ карт нэмэгдээд хугацааны мөрөө мартвал энд барина.

   «График» = (а) дата тэмдэгтэй svg (≥60×40, ≥2 дүрс), эсвэл (б) эрэмбийн
   жагсаалт — нэг эцэгт ≥3 хувийн өргөнтэй нимгэн багана (div, өндөр ≤12px).
   Чимэглэл (hero, AI цөм, түүхийн шугам) нь DECOR-оор нэрээрээ алгасагдана.

   Хүрээ: тэмдгээс дээш алхаж, [data-chart-period] агуулсан хамгийн ойрын
   эцгийг хайна. Мөр нь өөр график агуулсан салаанд (хөрш картад) байвал
   энэ графикийнх БИШ тул тооцохгүй — хөршийн мөрөөр «хамрагдсан» мэт
   худал ногоон гарахаас сэргийлнэ. Нэг картын хоёр донут нэг мөрийг хуваалцаж болно. */
module.exports = async function periodProbe(d0, w0, routes, decor) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = w0.frameElement;
  const out = {};
  for (const spec of routes) {
    /* «зам|товчны текст» — ачаалсны дараа тэр товчийг дарна (жиш. нүүрний
       салбарын таб: тренд нь идэвхтэй салбарын цуваатай үед л зурагдана) */
    const route = spec.split('|')[0], click = spec.split('|')[1] || '';
    frame.src = 'about:blank';
    await sleep(150);
    frame.src = route;
    let d = null, w = null;
    for (let t = 0; t < 60; t++) {
      await sleep(250);
      try { d = frame.contentDocument; w = frame.contentWindow; } catch (e) { d = null; }
      if (d && d.body && d.body.innerHTML.length > 8000 && String(w.location.href).indexOf(route.split('#')[0]) >= 0) break;
    }
    if (!d || !d.body) { out[spec] = { __err: 'ачаалагдсангүй' }; continue; }
    await sleep(3500);
    if (click) {
      const b = click[0] === '['
        ? d.querySelector(click)
        : [...d.querySelectorAll('button')].find((x) => x.textContent.trim().indexOf(click) >= 0 && x.getBoundingClientRect().width > 0);
      if (!b) { out[spec] = { __err: 'товч олдсонгүй: ' + click }; continue; }
      b.click(); await sleep(1200);
    }
    for (const y of [0, 900, 1800, 2700, 3600, 4500, 5400, 6300, 7200]) { w.scrollTo(0, y); await sleep(120); }
    await sleep(400);

    const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const marks = [];
    [...d.querySelectorAll('svg')].filter((s) => !s.ownerSVGElement && visible(s)).forEach((s) => {
      const r = s.getBoundingClientRect();
      const shapes = [...s.querySelectorAll('rect,circle,path,polyline,line')].filter((e) => !e.closest('defs')).length;
      /* >900px өндөр = хуудасны дэвсгэр дүрслэл (slowPan), график биш */
      if (r.width >= 60 && r.height >= 40 && r.height <= 900 && shapes >= 2) marks.push({ el: s, kind: 'svg' });
    });
    /* Эрэмбийн жагсаалт / div-ээр зурсан багана график:
       (а) хэвтээ — хувийн өргөнтэй нимгэн (≤12px) багана;
       (б) босоо — `bottom:0` + хувийн өндөртэй багана (7 хоногийн тайлан).
       Бүлэг = ≥3 багана нийлдэг хамгийн ойрын эцэг. */
    const bars = [...d.querySelectorAll('div[style]')].filter((e) => {
      if (e.children.length) return false;
      const st = e.getAttribute('style') || '', r = e.getBoundingClientRect();
      if (r.height <= 0) return false;
      /* 0%-ийн багана (жиш. «мэдээлэл алга» салбар) өргөнгүй ч жагсаалтын мөр */
      if (/(^|;)\s*width:\s*[\d.]+%/.test(st) && r.height <= 12) return true;
      if (r.width <= 0) return false;
      return /(^|;)\s*bottom:\s*0/.test(st) && /(^|;)\s*height:\s*[\d.]+%/.test(st) && r.width >= 4;
    });
    const groups = new Set();
    bars.forEach((e) => {
      let p = e.parentElement;
      for (let k = 0; k < 6 && p && p !== d.body; k++, p = p.parentElement) {
        const inP = bars.filter((b) => p.contains(b));
        if (inP.length < 3) continue;
        /* Жагсаалтын мөрүүд ойрхон (≤120px); тусдаа картын ганц явцын зурвас
           (коммунитигийн төслийн карт) бол мөр хоорондын зай том — график биш */
        const ys = inP.map((b) => b.getBoundingClientRect().top).sort((a, b) => a - b);
        const gap = ys.slice(1).reduce((mx, y, i) => Math.max(mx, y - ys[i]), 0);
        if (gap <= 120) groups.add(p);
        break;
      }
    });
    groups.forEach((p) => {
      if (visible(p) && !marks.some((m) => m.el.contains(p) || p.contains(m.el))) marks.push({ el: p, kind: 'list' });
    });

    const isDecor = (el) => {
      if (el.closest('[data-audit-ignore],[data-period-exempt]')) return true;
      let p = el;
      for (let k = 0; k < 8 && p; k++) {
        p = p.parentElement;
        if (p && p.closest && p.closest('[data-audit-ignore],[data-period-exempt]')) return true;
        if (p && p.innerText && decor.some((x) => p.innerText.slice(0, 400).indexOf(x) >= 0) && p.innerText.length < 600) return true;
      }
      return false;
    };
    const rows = [];
    const seen = new Set();
    marks.forEach((m) => {
      if (isDecor(m.el)) return;
      let p = m.el, per = null, card = null;
      for (let k = 0; k < 14 && p && p !== d.body; k++) {
        p = p.parentElement;
        if (!p || p === d.body) break;
        const pe = [...p.querySelectorAll('[data-chart-period]')].find((x) => {
          /* Мөр нь p-ийн аль хүүхэд салаанд байна вэ: манай салаа, эсвэл
             график агуулаагүй салаа (гарчиг) бол манайх; хөршийн карт бол биш */
          let br = x; while (br.parentElement && br.parentElement !== p) br = br.parentElement;
          return br.contains(m.el) || !marks.some((o) => o !== m && br.contains(o.el));
        });
        if (pe) { per = pe; card = p; break; }
        if (!card || !marks.some((o) => o !== m && card.contains(o.el))) card = p;
      }
      const key = per || card;
      if (seen.has(key) && per) return;
      seen.add(key);
      const title = ((card && card.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 70);
      rows.push({ ok: !!per, kind: m.kind, period: per ? per.textContent.trim() : '', title });
    });
    out[spec] = rows;
  }
  return out;
};

/* Графикийн hover шалгагч — браузер (iframe) дотор ажиллах probe.

   tests/run.js (бүлэг HV) `.toString()`-ээр авч runProbe-д өгнө, тиймээс
   энэ функц ӨӨРӨӨ ТОГТООЛТ БАЙХГҮЙ (closure-гүй) байх ёстой.

   Статистикч хүн график дээр хийдэг зүйлийг ЯГ давтана:
     1. Тэмдэг бүр дээр хулгана аваачна (mouseover) → tooltip гарах ёстой
     2. Tooltip-д НЭР ба ТОО байна (NaN / undefined / null байхгүй)
     3. Тэр тоо нь график дээрх ӨӨР газартай (легенд, улсын polygon)
        ТЭГШ — нэг тоо хоёр өөр утга байж болохгүй
     4. Тэмдэг бүр хүрэгдэх боломжтой: өөр элемент (нисэх цэг, цагираг)
        дарж, hover-ийг хаагаагүй
   Хэрэглэгч "улсын цэг дээр очиход нэр, нийт дүн гарахгүй" гэж илрүүлсэн
   алдаа энэ шалгагчаар ТУРШИГДАНА — native <title> нь Electron дээр
   огт гардаггүй тул зөвхөн DOM-д <title> байгаа эсэх шалгалт хүрэлцээгүй. */
module.exports = async function hoverProbe(d, w) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const R = { phases: {} };

  const tipEl = () => d.querySelector('.eh-tip');
  const ownTitle = (el) => {
    for (const c of el.children) if (c.localName === 'title') return c.textContent;
    return el.getAttribute('data-tip') || '';
  };
  const hasTip = (el) => el.localName !== 'title' && !!ownTitle(el) &&
    !(el.localName === 'svg' && !el.ownerSVGElement);

  /* Хулганыг элемент дээр аваачиж tooltip-ийг уншина */
  const hover = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    el.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y, view: w }));
    el.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, view: w }));
    const tp = tipEl();
    const vis = !!tp && tp.style.display !== 'none';
    const out = { vis, name: '', value: '', native: false };
    if (vis) {
      out.name = (tp.querySelector('.eh-tip-n') || {}).textContent || '';
      out.value = (tp.querySelector('.eh-tip-v') || {}).textContent || '';
    }
    /* Native <title> hover хугацаанд салсан байх ёстой (давхар tooltip үгүй) */
    out.native = [...el.children].some((c) => c.localName === 'title');
    el.dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true, relatedTarget: d.body, view: w }));
    out.restored = [...el.children].some((c) => c.localName === 'title');
    return out;
  };
  const reach = (el) => {
    const r = el.getBoundingClientRect();
    const top = d.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el || (!!top && el.contains(top));
  };

  const mapSvg = () => d.querySelector('svg.eh-fmap');
  const sweepMap = () => {
    const svg = mapSvg();
    if (!svg) return null;
    svg.scrollIntoView({ block: 'center' });
    const all = [...svg.querySelectorAll('*')].filter(hasTip);
    const isNode = (el) => el.localName === 'circle' && /зорчигч/.test(ownTitle(el));
    const rows = all.map((el) => ({
      kind: isNode(el) ? 'node' : el.localName === 'path' ? 'path' : el.localName,
      title: ownTitle(el), tip: hover(el), reach: reach(el)
    }));
    /* Графикийн легенд (шошго + тоо) — карт доторх текстээс */
    const card = svg.closest('div[style*="border-radius:20px"]') || svg.parentNode;
    return { rows, cardText: (card && card.innerText || '').replace(/\s+/g, ' ') };
  };
  const clickText = (re) => {
    const b = [...d.querySelectorAll('button')].find((x) => re.test(x.textContent.trim()));
    if (b) b.click();
    return !!b;
  };

  /* Бодит feed ирэх хүртэл хүлээнэ (ирэхгүй бол SKIP — тест худал унахгүй) */
  let ready = false;
  for (let i = 0; i < 160 && !ready; i++) {
    const svg = mapSvg();
    ready = !!svg && [...svg.querySelectorAll('circle')].filter(
      (c) => /зорчигч/.test(ownTitle(c))).length >= 3;
    if (!ready) await sleep(250);
  }
  R.ready = ready;
  if (!ready) return R;
  await sleep(500);

  R.phases.intlGlobe = sweepMap();
  R.hasProjTabs = clickText(/^Хавтгай$/);
  await sleep(900);
  R.phases.intlFlat = sweepMap();
  clickText(/^Бөмбөрцөг$/);
  await sleep(500);
  R.hasDomestic = clickText(/^Дотоодын$/);
  await sleep(1200);
  R.phases.domestic = sweepMap();

  /* Хуудасны БҮХ тэмдэг: график бүр ижил стандарттай эсэх */
  const pageMarks = [...d.querySelectorAll('svg *')].filter(hasTip)
    .filter((el) => !(mapSvg() && mapSvg().contains(el)));
  R.page = pageMarks.slice(0, 400).map((el) => {
    const title = ownTitle(el);
    return { title, tip: hover(el) };
  });
  R.pageTotal = pageMarks.length;
  return R;
};

/* Tooltip-гүй график: хуудсан дээрх svg бүрийн дата тэмдэг (rect/circle/path)
   тоо ба тэдгээрийн хэдэн нь tooltip-тэйг тоолно. Тэмдэгтэй, ГАНЦ ч tooltip
   байхгүй график = хэрэглэгч утгыг нь харж чадахгүй график. Closure-гүй. */
module.exports.inventory = async function inventory(d, w) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(4500);
  for (const y of [0, 700, 1400, 2100, 2800, 3500, 4200]) { w.scrollTo(0, y); await sleep(150); }
  const out = [];
  [...d.querySelectorAll('svg')].filter((s) => !s.ownerSVGElement).forEach((s) => {
    const shapes = [...s.querySelectorAll('rect,circle,path,polyline')].filter((e) => !e.closest('defs'));
    const tips = shapes.filter((e) => [...e.children].some((c) => c.localName === 'title') || e.hasAttribute('data-tip'));
    /* Чартын стандарт (CH): шугамын цэг нь svg-ийн ХАЖУУД HTML давхарга (.eh-ch-dot[data-tip]) —
       svg нь харьцаагаар сунадаг тул дугуй цэг зууван болохгүйн тулд. Тэдгээрийг ч тоолно. */
    if (s.classList.contains('eh-ch-svg') && s.parentElement) {
      s.parentElement.querySelectorAll(':scope > [data-tip]').forEach((e) => tips.push(e));
    }
    const r = s.getBoundingClientRect();
    let p = s;
    for (let k = 0; k < 7 && p; k++) { p = p.parentElement; if (p && p.innerText && p.innerText.length > 25) break; }
    out.push({ w: Math.round(r.width), h: Math.round(r.height), shapes: shapes.length, tips: tips.length,
      sec: p ? p.innerText.replace(/\s+/g, ' ').slice(0, 60) : '' });
  });
  return { svgs: out };
};

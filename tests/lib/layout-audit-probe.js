'use strict';
/* ДЭЛГЭЦИЙН ХАРАГДАЦЫН ШАЛГАГЧ — хуудас дотор ажиллах функц.

   Яагаад: тест "тоо зөв, текст байна" гэж шалгадаг ч ХАРАГДАЦЫГ шалгадаггүй
   байсан. Үр дүнд график карт 3/4-ээрээ хоосон, текст виджетийн хүрээнээс
   гарсан, тэнхлэгийн шошго давхцсан зэрэг ЭНГИЙН алдаа хэрэглэгч дээр л илэрч
   байв. Энэ функц нь хуудсыг ЖИНХЭНЭ браузер дээр зурагдсан байдлаар нь (DOM
   хэмжээ) шалгана — өгөгдлөөс биш, ХАРАГДАЦААС.

   Энэ файл нь `.toString()`-ээр хуудас руу шууд тарьдаг тул ГАДНА ямар ч
   хувьсагч ашиглаж БОЛОХГҮЙ — бүх зүйл функц дотор байна.

   Дүрмүүд (rule):
     page-hscroll   хуудас хэвтээ гүйлгэгдэнэ (ямар нэг зүйл дэлгэцээс давсан)
     text-overflow  текст ойрын "хүрээ"-ээсээ (карт, пилл, clip-тэй блок, svg) гарсан
     card-empty     карт өндрийнхөө ихэнх нь ХООСОН (контент дээр, доор нь хоосон)
     svg-letterbox  svg график өөрийн хайрцгийг дүүргэхгүй (viewBox харьцаа таарахгүй)
     text-overlap   нэг картын доторх хоёр текст бие биеийн дээр давхцсан
     raw-leak       "NaN", "undefined", "[object", "{{" ил гарсан / svg атрибутад NaN
     chart-collapsed график svg нь нурсан (өндөр/өргөн ~0) эсвэл мөр нь хоосон
     grid-orphan    ижил хэмжээтэй карт/нүдийн grid-ийн сүүлийн мөрт ГАНЦ карт үлдсэн (4+1, 2+1)
     offscreen-control  товч/холбоос/талбар дэлгэцийн ирмэгээс гарсан (хуудас hscroll хийхгүй ч
                    хүрэх боломжгүй — жиш. 390px-д header-ийн ☰ цэс 395–433px дээр байсан)

   Буцаах: [{rule, where, text, detail}] */
function auditLayout(doc, win, opts) {
  opts = opts || {};
  const out = [];
  const TOL = 1.5;
  /* opts.root — зөвхөн тухайн хэсгийг (жиш. админы #pvhost preview) шалгана */
  const body = (opts.root && doc.querySelector(opts.root)) || doc.body;
  const vw = win.innerWidth;

  const num = (v) => parseFloat(v) || 0;
  const cs = (el) => win.getComputedStyle(el);
  const rectOf = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    try { return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); }
    catch (e) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  };
  /* Алгасах: <script>/<template>, `data-audit-ignore` (marquee гэх мэт зориудын
     хөдөлгөөн), ба ЧИМЭГЛЭЛ давхарга — position:absolute|fixed + pointer-events:none
     (дэвсгэр график, гэрлийн толбо). Хэрэглэгч товшиж чаддаггүй, мэдээлэл агуулдаггүй. */
  const decorCache = new WeakMap();
  const isDecor = (el) => {
    if (!el || el === body) return false;
    if (decorCache.has(el)) return decorCache.get(el);
    const st = cs(el);
    const v = ((st.position === 'absolute' || st.position === 'fixed') && st.pointerEvents === 'none') ||
      isDecor(el.parentElement);
    decorCache.set(el, v);
    return v;
  };
  const ignored = (el) => !!(el.closest && el.closest('script,style,template,noscript,[data-audit-ignore]')) || isDecor(el);
  const short = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n || 40);

  /* Элементийг хүн уншихаар тодорхойлно: tag#id.class[data-eh-card] "эхний текст" */
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const card = el.getAttribute && (el.getAttribute('data-eh-card') || el.getAttribute('data-card'));
    if (card) s += '[' + card + ']';
    const cls = (el.getAttribute && el.getAttribute('class')) || '';
    if (cls) s += '.' + cls.trim().split(/\s+/).slice(0, 2).join('.');
    return s;
  };
  /* Карт бүр өөрийн толгойн текстээр танигдана ("САРЫН НИСЛЭГИЙН ТОО") */
  const cardTitle = (el) => {
    const w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = short(n.nodeValue, 50);
      if (t && !ignored(n.parentElement)) return t;
    }
    return '';
  };

  /* "Хүрээ" = текст нь доторх ёстой хайрцаг:
       (а) clip хийдэг (overflow hidden/clip) блок, svg
       (б) карт шиг харагддаг: radius ≥ 10px + (дэвсгэр | хүрээ | сүүдэр)
       (в) пилл/badge: radius ≥ 8px + дэвсгэр, жижиг */
  const hasPaint = (st) => {
    const bg = st.backgroundColor;
    const m = bg && bg.match(/rgba?\(([^)]+)\)/);
    let a = 0;
    if (m) { const p = m[1].split(',').map(parseFloat); a = p.length > 3 ? p[3] : 1; }
    const hasImg = st.backgroundImage && st.backgroundImage !== 'none';
    const hasBorder = num(st.borderTopWidth) + num(st.borderLeftWidth) > 0 &&
      st.borderTopStyle !== 'none' && st.borderLeftStyle !== 'none';
    const hasShadow = st.boxShadow && st.boxShadow !== 'none';
    return a > 0.04 || hasImg || hasBorder || hasShadow;
  };
  const isCard = (el, st) => {
    const r = Math.max(num(st.borderTopLeftRadius), num(st.borderTopRightRadius));
    return r >= 10 && hasPaint(st);
  };
  const clips = (el, st) => {
    if (el.tagName.toLowerCase() === 'svg' && el.parentElement && el.parentElement.tagName.toLowerCase() !== 'svg') {
      return st.overflowX !== 'visible' || st.overflow !== 'visible';
    }
    return st.overflowX === 'hidden' || st.overflowX === 'clip';
  };
  const frameOf = (node) => {
    let el = node.parentElement;
    while (el && el !== body && el !== doc.documentElement) {
      const st = cs(el);
      const tag = el.tagName.toLowerCase();
      if (tag === 'svg' || tag === 'foreignobject') {
        if (tag === 'svg' && el.parentElement && el.parentElement.namespaceURI === 'http://www.w3.org/2000/svg') { el = el.parentElement; continue; }
        if (tag === 'svg') return { el, kind: 'svg' };
      }
      /* Гүйлгэгддэг контейнер (хүснэгтийн хэвтээ гүйлт гэх мэт) — хүрээнээс гарсан
         нь гүйлгээд хүрнэ, алдаа биш. Харин доторх ТЕКСТ нь тус контейнерийн
         ДОТОР л шалгагдана (өөр картаар биш). */
      if (st.overflowX === 'auto' || st.overflowX === 'scroll' || st.overflowY === 'auto' || st.overflowY === 'scroll') return { el, kind: 'scroll' };
      if (clips(el, st) && st.textOverflow !== 'ellipsis') return { el, kind: 'clip' };
      if (isCard(el, st)) return { el, kind: 'card' };
      el = el.parentElement;
    }
    return null;
  };

  /* Текстийн ХАРАГДАХ хэсэг: overflow хийдэг өвөг бүрээр огтлоно. Ellipsis-тэй
     мөрийн бүтэн өргөн ("..."-ийн цаад нуугдсан хэсэг) өөр текстэд давхцсан мэт
     харагдахаас сэргийлнэ. Бүр огтлогдсон бол null. */
  const visibleRect = (el, r, stopEl) => {
    let l = r.left, t = r.top, rt = r.right, b = r.bottom;
    for (let p = el; p && p !== stopEl && p !== body && p !== doc.documentElement; p = p.parentElement) {
      const st = cs(p);
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
      const pr = rectOf(p);
      if (st.overflowX !== 'visible') { l = Math.max(l, pr.left); rt = Math.min(rt, pr.right); }
      if (st.overflowY !== 'visible') { t = Math.max(t, pr.top); b = Math.min(b, pr.bottom); }
    }
    if (rt - l <= 1 || b - t <= 1) return null;
    return { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t };
  };

  /* ── Текстийн бүх мөр (line rect) цуглуулна ── */
  const lines = [];   /* {node, el, r, frame, text} */
  const tw = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let tn;
  const rng = doc.createRange();
  while ((tn = tw.nextNode())) {
    const t = short(tn.nodeValue, 80);
    if (!t) continue;
    const el = tn.parentElement;
    if (!el || ignored(el) || !visible(el)) continue;
    const st = cs(el);
    if (st.fontSize && num(st.fontSize) === 0) continue;
    rng.selectNodeContents(tn);
    const rects = Array.from(rng.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    const frame = frameOf(tn);
    rects.forEach((r) => lines.push({ el, r, vis: visibleRect(el, r), inner: frame ? visibleRect(el, r, frame.el) : null, frame, text: t, ell: st.textOverflow === 'ellipsis' }));
  }

  /* 1. page-hscroll */
  const sw = Math.max(doc.documentElement.scrollWidth, body.scrollWidth);
  if (sw > vw + TOL) {
    /* Кем нь гарсныг олно: баруун ирмэг нь vw-ээс хамгийн их давсан элемент */
    let worst = null, wr = 0;
    doc.querySelectorAll('body *').forEach((el) => {
      if (ignored(el) || !visible(el)) return;
      const r = rectOf(el);
      if (r.width > 0 && r.right > wr + 0.5 && r.right > vw + TOL) {
        /* scroll контейнерийн дотор бол энэ нь хуудас биш */
        let p = el.parentElement, inScroll = false;
        while (p && p !== body) {
          const o = cs(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { inScroll = true; break; }
          p = p.parentElement;
        }
        if (!inScroll) { worst = el; wr = r.right; }
      }
    });
    out.push({ rule: 'page-hscroll', where: worst ? describe(worst) : 'document',
      text: worst ? cardTitle(worst) : '', detail: 'scrollWidth ' + sw + ' > viewport ' + vw });
  }

  /* 2. text-overflow */
  const seen = new Set();
  lines.forEach((ln) => {
    if (!ln.frame || ln.ell || ln.frame.kind === 'scroll') return;
    const fr = rectOf(ln.frame.el);
    const st = cs(ln.frame.el);
    /* Хүрээний padding-ийг оруулахгүй, border-box-оор шалгана */
    /* Frame-ээс ДОТОРХ clip-ээр (жиш. ellipsis) огтлогдсон хэсэг нь харагдахгүй тул алдаа биш */
    if (!ln.inner) return;
    const dl = fr.left - ln.inner.left, dr = ln.inner.right - fr.right;
    const dt = fr.top - ln.inner.top, db = ln.inner.bottom - fr.bottom;
    const worst = Math.max(dl, dr);
    const vert = Math.max(dt, db);
    if (worst > TOL || vert > TOL + 1) {
      /* Нэг frame-д нэг л мэдээлнэ — ижил frame дахь олон мөр давтагдахгүй */
      const key = describe(ln.frame.el) + '|' + Math.round(fr.left) + '|' + Math.round(fr.top) + '|' + (worst > TOL ? 'h' : 'v');
      if (seen.has(key)) return;
      seen.add(key);
      /* scroll контейнер (хүснэгтийн өргөн гэх мэт) дотор уншигдах бол зөвшөөр */
      out.push({ rule: 'text-overflow', where: describe(ln.frame.el) + ' (' + ln.frame.kind + ')',
        text: ln.text,
        detail: (worst > TOL ? (dl > dr ? 'зүүн ' + dl.toFixed(0) : 'баруун ' + dr.toFixed(0)) + 'px' : (dt > db ? 'дээш ' + dt.toFixed(0) : 'доош ' + db.toFixed(0)) + 'px') +
          ' хүрээнээс гарсан · frame ' + Math.round(fr.width) + '×' + Math.round(fr.height) +
          ' · текст @' + Math.round(ln.r.left) + ',' + Math.round(ln.r.top),
        html: (() => { const a = []; let e = ln.el; for (let i = 0; i < 4 && e && e !== body; i++, e = e.parentElement) a.push(e.tagName.toLowerCase() + "[" + (e.getAttribute("style") || "").slice(0, 110) + "]"); return a.join(" < "); })() });
    }
  });

  /* 3. card-empty — карт бүрт: хамгийн доод контент ба картын доод ирмэгийн зай */
  const cards = [];
  doc.querySelectorAll('body *').forEach((el) => {
    if (ignored(el) || !visible(el)) return;
    const r = rectOf(el);
    if (r.height < 220 || r.width < 220) return;
    if (el.tagName.toLowerCase() === 'svg' || el.namespaceURI === 'http://www.w3.org/2000/svg') return;
    const st = cs(el);
    /* Чимэглэл (fixed/absolute дэвсгэр, pointer-events:none) карт БИШ */
    if (st.position === 'fixed' || ((st.position === 'absolute') && st.pointerEvents === 'none')) return;
    if (!isCard(el, st)) return;
    /* Контентгүй (текст/график/талбар байхгүй) бол карт биш, чимэглэл */
    if (!el.querySelector('svg,canvas,img,input,button,select,textarea') &&
        !Array.from(el.querySelectorAll('*')).some((c) => Array.from(c.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim()))) return;
    cards.push({ el, r });
  });
  const contentBottom = (card) => {
    const fr = card.r;
    let bottom = fr.top;
    const w = doc.createTreeWalker(card.el, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) {
      if (ignored(n) || !visible(n)) continue;
      const tag = n.tagName.toLowerCase();
      const r = rectOf(n);
      if (r.width < 1 || r.height < 1) continue;
      const own = Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.nodeValue.trim());
      const painted = tag === 'svg' || tag === 'canvas' || tag === 'img' || tag === 'iframe' ||
        tag === 'input' || tag === 'button' || tag === 'select' || tag === 'textarea' || own;
      /* Тогтмол өндөртэй (inline height:Npx ≥ 80) хайрцаг — график/placeholder-ийн ЗОРИУДЫН талбар,
         доторх текст нь голлогдсон ч хайрцаг бүхлээрээ контент */
      const fixedBox = /(?:^|;)\s*height:\s*\d+px/.test(n.getAttribute('style') || '') && r.height >= 80;
      if (fixedBox && n.textContent.trim()) { bottom = Math.max(bottom, r.bottom); continue; }
      if (!painted) continue;
      if (tag === 'svg') {
        /* svg-ийн ЖИНХЭНЭ зурагдсан хэсэг (хоосон цагаан хэсгийг тоолохгүй) */
        let b = r.top;
        try {
          const bb = n.getBBox();
          const ctm = n.getScreenCTM();
          if (ctm) b = Math.max(b, ctm.d * (bb.y + bb.height) + ctm.f);
          else b = r.bottom;
        } catch (e) { b = r.bottom; }
        bottom = Math.max(bottom, Math.min(b, r.bottom));
        continue;
      }
      bottom = Math.max(bottom, r.bottom);
    }
    return bottom;
  };
  cards.forEach((card) => {
    /* Хүүхэд карттай карт (контейнер) — зөвхөн навч карт шалгана */
    const nested = cards.some((o) => o !== card && card.el.contains(o.el));
    if (nested) return;
    const st = cs(card.el);
    const padB = num(st.paddingBottom);
    const free = card.r.bottom - padB - contentBottom(card);
    const limit = Math.max(110, 0.3 * card.r.height);
    if (free > limit) {
      out.push({ rule: 'card-empty', where: describe(card.el), text: cardTitle(card.el),
        detail: Math.round(free) + 'px хоосон (' + Math.round(100 * free / card.r.height) + '%) · карт ' +
          Math.round(card.r.width) + '×' + Math.round(card.r.height) });
    }
  });

  /* 4. svg-letterbox + 7. chart-collapsed */
  doc.querySelectorAll('svg').forEach((svg) => {
    if (ignored(svg) || !visible(svg)) return;
    if (svg.parentElement && svg.parentElement.namespaceURI === 'http://www.w3.org/2000/svg') return;
    const r = rectOf(svg);
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const par = (svg.getAttribute('preserveAspectRatio') || '').trim();
    const drawn = svg.querySelectorAll('path,rect,circle,line,polyline,polygon,ellipse,text').length;
    /* Дүрсгүй жижиг svg (icon) ба зөвхөн <defs>/<symbol> sprite-ийг алгас */
    if (!drawn) return;
    if (r.width < 24 && r.height < 24) return;
    if (r.width < 8 || r.height < 8) {
      out.push({ rule: 'chart-collapsed', where: describe(svg), text: cardTitle(svg.closest('div') || svg),
        detail: 'svg ' + Math.round(r.width) + '×' + Math.round(r.height) });
      return;
    }
    if (vb && vb.width > 0 && vb.height > 0 && par !== 'none' && !/slice/.test(par) && r.width >= 200) {
      const sc = Math.min(r.width / vb.width, r.height / vb.height);
      const gapX = r.width - vb.width * sc;
      const gapY = r.height - vb.height * sc;
      if (gapX > 0.08 * r.width || gapY > 0.2 * r.height) {
        out.push({ rule: 'svg-letterbox', where: describe(svg),
          text: cardTitle(svg.closest('div') || svg),
          detail: 'svg ' + Math.round(r.width) + '×' + Math.round(r.height) + ' · viewBox ' + vb.width + '×' + vb.height +
            ' → хоосон зай ' + (gapX > 0.08 * r.width ? 'хажуу ' + Math.round(gapX) + 'px' : 'дээд/доод ' + Math.round(gapY) + 'px') });
      }
    }
    /* NaN / undefined атрибут */
    const bad = [];
    svg.querySelectorAll('*').forEach((el) => {
      for (const a of el.attributes) {
        if (/NaN|undefined|Infinity/.test(a.value) && !/^(class|id|data-)/.test(a.name)) {
          bad.push(el.tagName.toLowerCase() + '@' + a.name); break;
        }
      }
    });
    if (bad.length) out.push({ rule: 'raw-leak', where: describe(svg), text: '',
      detail: 'svg атрибутад NaN/undefined: ' + bad.slice(0, 4).join(', ') + (bad.length > 4 ? ' …(' + bad.length + ')' : '') });
  });

  /* 5. text-overlap — нэг frame-ийн ДОТОР өөр өөр элементийн мөрүүд */
  const byFrame = new Map();
  lines.forEach((ln) => {
    const k = ln.frame ? ln.frame.el : body;
    if (!byFrame.has(k)) byFrame.set(k, []);
    if (ln.vis) byFrame.get(k).push(ln);
  });
  const overlapSeen = new Set();
  byFrame.forEach((arr, frameEl) => {
    if (arr.length > 400) return;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ix = Math.min(a.vis.right, b.vis.right) - Math.max(a.vis.left, b.vis.left);
        const iy = Math.min(a.vis.bottom, b.vis.bottom) - Math.max(a.vis.top, b.vis.top);
        if (ix <= 2 || iy <= 2) continue;
        const area = ix * iy;
        const small = Math.min(a.vis.width * a.vis.height, b.vis.width * b.vis.height);
        if (area / small < 0.3) continue;
        const key = a.text + '|' + b.text;
        if (overlapSeen.has(key)) continue;
        overlapSeen.add(key);
        out.push({ rule: 'text-overlap', where: frameEl === body ? 'body' : describe(frameEl),
          text: '"' + short(a.text, 28) + '" × "' + short(b.text, 28) + '"',
          detail: Math.round(100 * area / small) + '% давхцсан · @' + Math.round(a.vis.left) + ',' + Math.round(a.vis.top) + ' ' + Math.round(a.vis.width) + '×' + Math.round(a.vis.height) + ' / @' + Math.round(b.vis.left) + ',' + Math.round(b.vis.top) + ' ' + Math.round(b.vis.width) + '×' + Math.round(b.vis.height),
          html: a.el.tagName.toLowerCase() + '[' + (a.el.getAttribute('style') || '').slice(0, 100) + '] / ' + b.el.tagName.toLowerCase() + '[' + (b.el.getAttribute('style') || '').slice(0, 100) + ']' });
      }
    }
  });

  /* 6. raw-leak — ил гарсан загварын/JS-ийн үлдэгдэл */
  const leak = /\bNaN\b|\bundefined\b|\[object |\{\{|\}\}|\bnull\b(?!\w)|Infinity/;
  const leakSeen = new Set();
  lines.forEach((ln) => {
    if (!leak.test(ln.text)) return;
    const k = ln.text;
    if (leakSeen.has(k)) return;
    leakSeen.add(k);
    out.push({ rule: 'raw-leak', where: describe(ln.el), text: ln.text, detail: 'харагдах текстэд' });
  });

  /* 8. offscreen-control — товшиж болох элемент дэлгэцийн хөндлөн ирмэгээс гарсан бол хэрэглэгч
        түүнд хүрч чадахгүй. page-hscroll үүнийг барьдаггүй: root overflow-x нь хэтэрсэн хэсгийг
        нууж (scrollWidth = viewport) байдаг. Гүйлгэгддэг/clip хийдэг өвөг дотор бол алдаа биш. */
  if (!opts.root) {
    const offSeen = new Set();
    body.querySelectorAll('button,a[href],input,select,textarea,[role=button]').forEach((el) => {
      if (ignored(el) || !visible(el)) return;
      const r = rectOf(el);
      if (r.width < 4 || r.height < 4) return;
      if (r.right <= vw + TOL && r.left >= -TOL) return;
      /* Гүйлгэгддэг өвөг (auto/scroll) эсвэл ДОТООД clip (өвгийн өргөн viewport-оос 16px+ нарийн) бол
         алдаа биш. Viewport-ийн өргөнөөр clip хийдэг root-ийг тооцохгүй — яг тэр л ☰-г нууж байсан. */
      let skip = false;
      for (let p = el.parentElement; p && p !== body && !skip; p = p.parentElement) {
        const o = cs(p).overflowX;
        if (o === 'auto' || o === 'scroll') skip = true;
        else if (o === 'hidden' || o === 'clip') { const pr = rectOf(p); if (pr.width < vw - 16) skip = true; }
      }
      if (skip) return;
      const key = describe(el) + '|' + Math.round(r.left);
      if (offSeen.has(key)) return;
      offSeen.add(key);
      out.push({ rule: 'offscreen-control', where: describe(el), text: short(el.textContent || el.getAttribute('aria-label') || el.placeholder, 30),
        detail: (r.right > vw + TOL ? 'баруун ирмэг ' + Math.round(r.right) : 'зүүн ирмэг ' + Math.round(r.left)) + 'px · viewport ' + vw + 'px' });
    });
  }

  /* 7. grid-orphan — ижил хэмжээтэй карт/нүдүүдийн сүүлийн мөрт ганц нүд үлдсэн (4+1, 2+1).
        Орчигч нь мөрийн бусад нүдтэй ИЖИЛ өргөнтэй, баруун талд нь хоосон зай үлдсэн байна —
        өргөсөн (flex-grow / grid-column:1/-1) эсвэл өөр хэмжээтэй нүд алдаа биш.
        Жижиг зүйл (chip, товч < 120×60) нь энгийн wrap тул тооцохгүй. */
  const orphanSeen = new Set();
  body.querySelectorAll('*').forEach((el) => {
    if (ignored(el) || !visible(el)) return;
    const st = cs(el);
    const grid = st.display === 'grid' || st.display === 'inline-grid';
    const wrap = (st.display === 'flex' || st.display === 'inline-flex') && st.flexWrap !== 'nowrap';
    if (!grid && !wrap) return;
    const all = Array.from(el.children).filter((c) => {
      if (ignored(c) || !visible(c)) return false;
      const p = cs(c).position;
      return p !== 'absolute' && p !== 'fixed';
    });
    if (all.length < 3) return;
    const boxes = all.map((c) => rectOf(c));
    if (boxes.some((r) => r.width < 120 || r.height < 60)) return;
    const idx = all.map((c, i) => i).sort((a, b) => boxes[a].top - boxes[b].top || boxes[a].left - boxes[b].left);
    const rows = [];
    idx.forEach((i) => {
      const row = rows[rows.length - 1];
      if (row && boxes[i].top - boxes[row[0]].top <= 12) row.push(i); else rows.push([i]);
    });
    if (rows.length < 2 || rows[0].length < 2) return;
    const last = rows[rows.length - 1];
    if (last.length !== 1) return;
    const o = boxes[last[0]], w0 = boxes[rows[0][0]].width, cr = rectOf(el);
    if (Math.abs(o.width - w0) > 8 || cr.right - o.right < o.width * 0.5) return;
    const key = describe(el) + '|' + Math.round(cr.left) + '|' + Math.round(cr.top);
    if (orphanSeen.has(key)) return;
    orphanSeen.add(key);
    out.push({ rule: 'grid-orphan', where: describe(el), text: cardTitle(all[last[0]]),
      detail: all.length + ' нүд · ' + rows.map((r) => r.length).join('+') + ' — сүүлийн мөрт ганц нүд (өргөн ' + Math.round(o.width) + 'px, баруун талд ' + Math.round(cr.right - o.right) + 'px хоосон)' });
  });

  return out;
}

module.exports = { auditLayout };

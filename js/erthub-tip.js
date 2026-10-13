/* ErtHub — графикийн hover tooltip-ийн НЭГ стандарт.

   Гэрээ: график дээрх утга агуулсан элемент бүр (бөмбөлөг, мөр, цэг, улс,
   аймаг ...) hover хийхэд НЭР + УТГА хэлнэ. Элемент нь доорх хоёрын аль
   нэгийг агуулна:
     • SVG `<title>` хүүхэд   — "Нэр — утга" хэлбэртэй текст
     • `data-tip="..."` атрибут — ижил хэлбэр
   Энэ модуль document түвшинд ГАНЦ удаа суурилж, бүх графикт ижил, ТУНХАГ
   (хөтчийн native tooltip ~1 сек хоцорч, Electron/webview дээр огт гардаггүй)
   tooltip үзүүлнэ.

   Native tooltip давхцахгүйн тулд hover хугацаанд `<title>`-ыг түр салгаж
   (ЗӨВХӨН зангилааг, устгахгүй) hover дуусахад ЯГ байранд нь буцаана.
   dc-runtime зангилааг ШИНЭЧЛЭН дахин ашигладаг тул title-ийн текстийг
   КЭШЛЭХГҮЙ — hover бүрд зангилаанаас амьдаар уншина. */
(function (root) {
  'use strict';
  var SEP = ' — ';

  /* "Нэр — утга" → {name, value}. Тусгаарлагчгүй бол зөвхөн нэр. */
  function parse(text) {
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t) return null;
    var i = t.indexOf(SEP);
    if (i > 0 && i + SEP.length < t.length) return { name: t.slice(0, i), value: t.slice(i + SEP.length) };
    return { name: t, value: '' };
  }

  function isTitle(n) { return n && n.nodeType === 1 && String(n.localName).toLowerCase() === 'title'; }
  function titleOf(host) {
    for (var c = host.firstChild; c; c = c.nextSibling) if (isTitle(c)) return c;
    return null;
  }

  function install(doc) {
    doc = doc || root.document;
    if (!doc || !doc.body) return null;
    if (doc.__ehTip) return doc.__ehTip;
    var win = doc.defaultView || root;
    var tip = null, nameEl = null, valEl = null;
    var cur = null;            /* { host, title, next } — одоо hover хийж буй */
    var api = { parse: parse, element: function () { return tip; }, current: function () { return cur && cur.host; } };

    function ensure() {
      if (tip) {
        if (!tip.isConnected) doc.body.appendChild(tip);   /* body дахин баригдсан */
        return tip;
      }
      tip = doc.createElement('div');
      tip.className = 'eh-tip';
      tip.setAttribute('role', 'tooltip');
      tip.setAttribute('data-audit-ignore', 'hover tooltip');
      tip.style.display = 'none';
      nameEl = doc.createElement('span'); nameEl.className = 'eh-tip-n';
      valEl = doc.createElement('span'); valEl.className = 'eh-tip-v';
      tip.appendChild(nameEl); tip.appendChild(valEl);
      doc.body.appendChild(tip);
      return tip;
    }

    /* Зангилаас дээш алхаж tooltip-тэй элементийг олно. Гол svg-ийн өөрийн
       <title> нь БҮТЭН графикийн нэр тул алгасна (зөвхөн дотоод тэмдэг). */
    function sourceOf(t) {
      for (var n = t; n && n !== doc.body && n.nodeType === 1; n = n.parentNode) {
        if (n.hasAttribute && n.hasAttribute('data-tip')) return n;
        var isRootSvg = String(n.localName).toLowerCase() === 'svg' && !n.ownerSVGElement;
        if (!isRootSvg && titleOf(n)) return n;
      }
      return null;
    }

    function textOf(c) {
      if (c.title && c.title.textContent) return c.title.textContent;
      return c.host.getAttribute('data-tip') || '';
    }

    function release() {
      if (!cur) return;
      var c = cur; cur = null;
      if (c.title && !c.title.parentNode) {
        try {
          if (c.next && c.next.parentNode === c.host) c.host.insertBefore(c.title, c.next);
          else c.host.insertBefore(c.title, c.host.firstChild);
        } catch (e) { /* зангилаа DOM-оос аль хэдийн гарсан */ }
      }
    }

    function hide() {
      release();
      if (tip) tip.style.display = 'none';
    }

    function place(x, y) {
      if (!tip || tip.style.display === 'none') return;
      var vw = win.innerWidth || 1024, vh = win.innerHeight || 768;
      var w = tip.offsetWidth, h = tip.offsetHeight;
      var left = x + 14, top = y + 16;
      if (left + w > vw - 6) left = Math.max(6, x - w - 14);
      if (top + h > vh - 6) top = Math.max(6, y - h - 14);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }

    function paint() {
      var p = cur && parse(textOf(cur));
      if (!p) { if (tip) tip.style.display = 'none'; return false; }
      ensure();
      nameEl.textContent = p.name;
      valEl.textContent = p.value;
      valEl.style.display = p.value ? '' : 'none';
      tip.style.display = 'flex';
      return true;
    }

    function onOver(e) {
      var host = sourceOf(e.target);
      if (!host) { hide(); return; }
      if (cur && cur.host === host) { paint(); place(e.clientX, e.clientY); return; }
      release();
      var title = titleOf(host);
      cur = { host: host, title: title, next: title ? title.nextSibling : null };
      if (title) host.removeChild(title);   /* native tooltip давхцахгүй */
      if (paint()) place(e.clientX, e.clientY);
    }
    function onMove(e) {
      if (!cur) return;
      if (!cur.host.isConnected) { hide(); return; }
      paint();                         /* утга амьдаар шинэчлэгдэнэ */
      place(e.clientX, e.clientY);
    }
    function onOut(e) {
      if (!cur) return;
      var to = e.relatedTarget;
      if (to && cur.host.contains && cur.host.contains(to)) return;
      hide();
    }

    doc.addEventListener('mouseover', onOver, true);
    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('mouseout', onOut, true);
    doc.addEventListener('mousedown', hide, true);   /* глобус чирэх үед нуух */
    doc.addEventListener('scroll', hide, true);
    win.addEventListener('blur', hide);
    api.hide = hide;
    doc.__ehTip = api;
    return api;
  }

  var out = { install: install, parse: parse };
  root.EHTip = out;
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
  if (root.document) {
    var go = function () { install(root.document); };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})(typeof window !== 'undefined' ? window : this);

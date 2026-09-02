#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   ErtHub — ХАРАГДАХ ТЕКСТИЙН ХАМРАХ ХҮРЭЭ + ROUND-TRIP

   Зорилго: нүүр хуудас (index.html) ба админ (admin/index.html) дээр
   ХАРАГДАЖ БАЙГАА бүх монгол текст засварлагдах эх файлд (content.json
   эсвэл metric_registry.json) бүртгэлтэй эсэхийг НҮДЭЭР биш, DOM-оос
   цуглуулж механикаар шалгана.

     F1. Хамрах хүрээ — нүүр хуудас   (зорилт 100%)
     F2. Хамрах хүрээ — админ         (зорилт 100%)
     F3. Round-trip — content.json-д бичсэн утга САЙТ дээр гарч ирнэ
     F4. Round-trip — content.json → ui{} утга АДМИН дээр гарч ирнэ
     F5. Холбоосын шалгалт — ui{} зам бүр admin-д utxt()-ээр уншигдана

   Ашиглалт:  node tests/text-coverage.js
              node tests/text-coverage.js --list   (бүртгэлгүйг бүрэн жагсаана)

   Chrome олдохгүй бол SKIP биш FAIL — энэ тест DOM-гүйгээр утгагүй.
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8973;
const LIST_ALL = process.argv.includes('--list');
let pass = 0, fail = 0;
const failures = [];

function group(n) { console.log('\n══ ' + n + ' ' + '═'.repeat(Math.max(0, 58 - n.length))); }
function ok(n) { pass++; console.log('  PASS  ' + n); }
function bad(n, d) { fail++; failures.push(n); console.log('  FAIL  ' + n + (d ? '\n        ' + d : '')); }
function check(n, c, d) { c ? ok(n) : bad(n, d); }

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJson = (f) => JSON.parse(read(f));

const CYR = /[\u0400-\u04FF]/;

/* ── Бүртгэлтэй текстийн сан: content.json + metric_registry.json дахь
      БҮХ мөр утга. Хоёулаа админаар засварлагддаг тул хоёулаа хүчинтэй
      эх сурвалж. ── */
function corpusOf(objs) {
  const out = new Set();
  const walk = (o) => {
    if (o == null) return;
    if (typeof o === 'string') { if (CYR.test(o)) out.add(o.trim()); return; }
    if (typeof o !== 'object') return;
    Object.keys(o).forEach((k) => walk(o[k]));
  };
  objs.forEach(walk);
  return [...out].filter((s) => s.length >= 2).sort((a, b) => b.length - a.length);
}

/* Динамикаар үүсдэг, ЯМАР Ч файлд мөрөөр хадгалагдах боломжгүй хэсгүүд.
   Эдгээр нь текст БИШ — кодоос тооцоологддог утга, товчлол, нэгж.
   Жагсаалт БОГИНО байх ёстой: урт болох тусам тест утгаа алдана. */
const DYNAMIC = [
  /* Сарын товчлол ба огнооны хэлбэр — site.months-оос үүсгэгддэг */
  '-р сараас', '-р сар', '-р сарыг',
  /* Товчлол/нэгж — эх сурвалжийн байгууллагын код (registry, DSMETA) */
  'ЗТЯ', 'ИНЕГ', 'УБТЗ', 'НТБГ', 'ЗТХЕГ', 'НТГ', 'УБ',
];

/* \u0411\u04AF\u0440\u0442\u0433\u044D\u043B\u0442\u044D\u0439 \u043C\u04E9\u0440\u04AF\u04AF\u0434\u0438\u0439\u0433 \u0423\u0420\u0422\u0410\u0410\u0421 \u041D\u042C \u044D\u0445\u043B\u044D\u043D \u0445\u0430\u0441\u0430\u0430\u0434, \u043A\u0438\u0440\u0438\u043B\u043B \u04AF\u043B\u0434\u044D\u0446 \u0431\u0430\u0439\u0432\u0430\u043B \u0442\u044D\u0440 \u043D\u044C
   \u0431\u04AF\u0440\u0442\u0433\u044D\u043B\u0433\u04AF\u0439 \u0442\u0435\u043A\u0441\u0442. \u0422\u043E\u043C/\u0436\u0438\u0436\u0438\u0433 \u04AF\u0441\u044D\u0433 \u044F\u043B\u0433\u0430\u0445\u0433\u04AF\u0439 (\u0448\u043E\u0448\u0433\u043E CSS-\u044D\u044D\u0440 \u0438\u0445 \u0431\u043E\u043B\u0434\u043E\u0433).
   2 \u04AF\u0441\u044D\u0433\u0442 \u043C\u04E9\u0440\u0438\u0439\u0433 (\u043A\u043C, \u0442\u043D) \u0437\u04E9\u0432\u0445\u04E9\u043D \u0411\u04AE\u0422\u042D\u041D \u04AF\u0433 \u0431\u0430\u0439\u0445\u0430\u0434 \u043D\u044C \u0445\u0430\u0441\u043D\u0430 \u2014 \u044D\u0441 \u0442\u044D\u0433\u0432\u044D\u043B
   \u0441\u0430\u043D\u0430\u043C\u0441\u0430\u0440\u0433\u04AF\u0439 \u04AF\u0435\u043D\u0438\u0439 \u0434\u0430\u0432\u0445\u0446\u0430\u043B \u0431\u04AF\u0445\u043D\u0438\u0439\u0433 "\u0445\u0430\u043C\u0440\u0430\u0433\u0434\u0441\u0430\u043D" \u0431\u043E\u043B\u0433\u043E\u043D\u043E. */
function uncoveredPart(phrase, corpus) {
  let s = ' ' + phrase.replace(/\s+/g, ' ').trim() + ' ';
  let low = s.toLowerCase();
  const cut = (needle) => {
    const n = needle.toLowerCase();
    for (;;) {
      const i = low.indexOf(n);
      if (i < 0) return;
      s = s.slice(0, i) + ' '.repeat(n.length) + s.slice(i + n.length);
      low = low.slice(0, i) + ' '.repeat(n.length) + low.slice(i + n.length);
    }
  };
  for (const c of corpus) {
    if (c.length < 3) continue;
    cut(c);
  }
  for (const c of corpus) {
    if (c.length !== 2) continue;
    const re = new RegExp('(^|[^\\u0400-\\u04FF])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '(?![\\u0400-\\u04FF])', 'gi');
    s = s.replace(re, (m, p1) => p1 + '  ');
    low = s.toLowerCase();
  }
  for (const d of DYNAMIC) cut(d);
  s = s.replace(/[^\u0400-\u04FF]+/g, ' ').trim();
  return s;
}

/* \u0422\u04AF\u043B\u0445\u04AF\u04AF\u0440 \u043A\u043E\u0434\u043E\u0434 \u0423\u041D\u0428\u0418\u0413\u0414\u0410\u0416 \u0431\u0430\u0439\u0433\u0430\u0430 \u044D\u0441\u044D\u0445 \u2014 \u0448\u0443\u0443\u0434 ('a.b.c') \u0431\u0430 \u0414\u0418\u041D\u0410\u041C\u0418\u041A
   ('a.'+k) \u0445\u043E\u0451\u0443\u043B\u0430\u043D\u0433 \u043D\u044C \u0445\u04AF\u043B\u044D\u044D\u043D \u0430\u0432\u043D\u0430. */
function isBound(src, dotted, fn) {
  if (src.includes(fn + "('" + dotted + "'")) return true;
  if (src.includes('data-ui="' + dotted + '"') || src.includes('data-ui-ph="' + dotted + '"') ||
      src.includes('data-ui-aria="' + dotted + '"')) return true;
  const parts = dotted.split('.');
  for (let i = 1; i <= parts.length - 1; i++) {
    const prefix = parts.slice(0, i).join('.') + '.';
    if (src.includes(fn + "('" + prefix + "'+")) return true;
  }
  return false;
}

/* ────────────────────────── ХӨТӨЧ ────────────────────────── */
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

/* Тест сервер. content.json-г САНАХ ОЙНООС өгөх боломжтой — round-trip
   тест файлыг хөндөхгүйгээр өөрчилсөн хувилбарыг үйлчлүүлнэ. */
let OVERRIDE = null;          /* {'/content.json': '<текст>'} */
let PROBE_JS = '', PROBE_TARGET = '/index.html', PROBE_RESULT = null;
function serve() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  return http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/__result__' && req.method === 'POST') {
      let b = ''; req.on('data', (c) => b += c);
      req.on('end', () => { PROBE_RESULT = b; res.writeHead(200); res.end('ok'); });
      return;
    }
    if (p === '/__probe__') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><body>' +
        '<iframe id="f" src="' + PROBE_TARGET + '" style="width:1440px;height:1200px;border:0"></iframe>' +
        '<script>\n' +
        'function done(v){fetch("/__result__",{method:"POST",body:JSON.stringify(v)})}\n' +
        'function poll(){var f=document.getElementById("f"),d,w;\n' +
        ' try{d=f.contentDocument;w=f.contentWindow}catch(e){return setTimeout(poll,200)}\n' +
        ' if(!d||!d.body||d.body.innerHTML.length<4000) return setTimeout(poll,200);\n' +
        ' try{ (' + PROBE_JS + ')(d,w).then(done).catch(function(e){done({__err:String(e)})}) }\n' +
        ' catch(e){ done({__err:String(e)}) }\n' +
        '}\nsetTimeout(poll,1500);\n' +
        '</script></body>');
      return;
    }
    if (OVERRIDE && OVERRIDE[p] != null) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(OVERRIDE[p]);
      return;
    }
    fs.readFile(path.join(ROOT, p === '/' ? '/index.html' : p), (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store' });
      res.end(data);
    });
  }).listen(PORT);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runProbe(target, jsBody, waitMs) {
  PROBE_TARGET = target; PROBE_JS = jsBody; PROBE_RESULT = null;
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-sync', '--mute-audio', '--disable-features=Translate,OptimizationHints',
    '--window-size=1440,1200',
    'http://localhost:' + PORT + '/__probe__'], { stdio: 'ignore' });
  const deadline = Date.now() + (waitMs || 120000);
  while (PROBE_RESULT === null && Date.now() < deadline) await sleep(250);
  try { ch.kill(); } catch (e) {}
  if (PROBE_RESULT === null) return { __err: 'probe хугацаа хэтэрлээ' };
  try { return JSON.parse(PROBE_RESULT); } catch (e) { return { __err: 'JSON: ' + e.message }; }
}

/* Харагдаж буй текстийг цуглуулах — хоёр хуудсанд ижил код */
const COLLECTOR = `
  window.__seen=window.__seen||[];
  window.__grab=function(){
    var w=d.createTreeWalker(d.body,NodeFilter.SHOW_TEXT,null,false),n;
    while(n=w.nextNode()){
      var t=(n.nodeValue||'').trim();
      if(!t||!/[\\u0400-\\u04FF]/.test(t)) continue;
      var el=n.parentElement; if(!el) continue;
      if(el.closest('script,style,noscript,template')) continue;
      var cs=w2.getComputedStyle(el);
      if(cs.display==='none'||cs.visibility==='hidden') continue;
      window.__seen.push(t);
    }
    ['placeholder','aria-label','title','alt'].forEach(function(a){
      Array.prototype.forEach.call(d.querySelectorAll('['+a+']'),function(e){
        var v=e.getAttribute(a);
        if(v&&/[\\u0400-\\u04FF]/.test(v)) window.__seen.push(v.trim());
      });
    });
  };`;

/* ── Нүүр хуудас: салбар бүрийг ээлжлэн сонгоно (04/05/07 хэсэг
      идэвхтэй салбараас хамаарч БҮХЭЛДЭЭ өөрчлөгддөг), шүүлт нээнэ,
      сэдэв солино — бүх нөхцөлт текст DOM-д гарч ирнэ. ── */
const HOME_PROBE = `async function(d,w2){
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  ${COLLECTOR}
  var Q=function(s){return Array.prototype.slice.call(d.querySelectorAll(s))};
  var click=async function(el,ms){ if(!el) return false; try{el.click()}catch(e){return false}
    await sleep(ms||400); window.__grab(); return true };
  await sleep(3000);
  window.__grab();
  /* Салбарын таб — 04/05/07 хэсэг БҮХЭЛДЭЭ өөрчлөгддөг */
  var tabs=Q('button').filter(function(b){return b.getAttribute('title')&&b.textContent.trim().length<4});
  for(var i=0;i<tabs.length&&i<8;i++) await click(tabs[i],450);
  /* 01 — шүүлт нээж, хугацааны товч дарна (хэсэгчилсэн мужийн шошго) */
  var f=Q('button').filter(function(b){return /Шүүлт/.test(b.textContent)})[0];
  if(f){ await click(f,450);
    var pr=Q('button').filter(function(b){return /хагас|улирал/.test(b.textContent)})[0];
    await click(pr,450);
    var all=Q('button').filter(function(b){return b.textContent.trim()==='Бүгд'})[0];
    await click(all,350);
  }
  /* 05 — ⚗ товч: дундаж шугамын тохиргоо (t05.foot) */
  var f05=Q('button').filter(function(b){return b.textContent.trim()==='⚗'})[0];
  await click(f05,450);
  /* 08 — AI асуулт: алхмууд (steps), эх сурвалж, "Ажиллаж байна" төлөв */
  var nChips=Q('button').filter(function(b){return /\\?$/.test(b.textContent.trim())}).length;
  for(var c=0;c<nChips;c++){
    var cc=Q('button').filter(function(b){return /\\?$/.test(b.textContent.trim())})[c];
    if(!cc) continue;
    cc.click();
    for(var k=0;k<7;k++){ await sleep(400); window.__grab(); }
  }
  /* ЧУХАЛ: "Нэвтрэх" ба коммунитийн карт нь ӨӨР ХУУДАС руу шилжүүлдэг
     (isAuth / page:'community' төлөв). Хамрах хүрээ ЗӨВХӨН нүүр хуудас
     тул эдгээрийг дарахгүй — эс тэгвэл өөр хуудасны текст цугларна. */
  /* Өнгөний горим */
  var th=Q('[title]').filter(function(e){return /горим/.test(e.getAttribute('title')||'')})[0];
  if(th){ await click(th,450); await click(th,350); }
  var uniq={}; window.__seen.forEach(function(t){uniq[t]=1});
  return {texts:Object.keys(uniq)};
}`;

/* ── Админ: түвшин бүр, виджет бүрийн засварын дэлгэц, 2 модаль,
      "Сайтын текст" таб — бүгдийг дамжина. ── */
const ADMIN_PROBE = `async function(d,w2){
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  ${COLLECTOR}
  await sleep(2500);
  window.__grab();
  var byText=function(sel,re){return Array.prototype.slice.call(d.querySelectorAll(sel))
    .filter(function(e){return re.test(e.textContent)})[0]};
  /* Бүх харагдац */
  var ab=d.getElementById('allBtn'); if(ab){ab.click(); await sleep(900); window.__grab(); ab.click(); await sleep(500);}
  /* Хэсэг бүр → виджет бүр → засварын дэлгэц + 2 модаль */
  var secs=Array.prototype.slice.call(d.querySelectorAll('[data-section]'))
    .map(function(e){return e.getAttribute('data-section')});
  for(var i=0;i<secs.length;i++){
    var se=d.querySelector('[data-section="'+secs[i]+'"]'); if(!se) continue;
    se.click(); await sleep(450); window.__grab();
    var ids=Array.prototype.slice.call(d.querySelectorAll('[data-cd]'))
      .map(function(e){return e.getAttribute('data-cd')});
    for(var j=0;j<ids.length;j++){
      var wb=d.querySelector('[data-widget="'+ids[j]+'"]'); if(!wb) continue;
      wb.click(); await sleep(500); window.__grab();
      var lb=d.querySelector('[data-mo="loc|'+ids[j]+'"]');
      if(lb){ lb.click(); await sleep(400); window.__grab();
        var x=d.getElementById('moX'); if(x) x.click(); await sleep(250); }
      var hb=d.querySelector('[data-mo="hist|'+ids[j]+'"]');
      if(hb){ hb.click(); await sleep(400); window.__grab();
        var x2=d.getElementById('moX'); if(x2) x2.click(); await sleep(250); }
      var bk=d.querySelector('[data-back]'); if(bk){ bk.click(); await sleep(400); }
    }
    var bk2=d.querySelector('[data-back]'); if(bk2){ bk2.click(); await sleep(400); }
  }
  /* Шүүлтийн хоосон илэрц */
  var ab2=d.getElementById('allBtn'); if(ab2){ab2.click(); await sleep(700);}
  var q=d.getElementById('wq');
  if(q){ q.value='zzqxzz'; q.dispatchEvent(new w2.Event('input',{bubbles:true}));
         await sleep(450); window.__grab();
         q.value=''; q.dispatchEvent(new w2.Event('input',{bubbles:true})); await sleep(350); }
  /* Модалийн "Харагдац" таб */
  var vb=d.querySelector('[data-mo^="view|"]');
  if(vb){ vb.click(); await sleep(500); window.__grab();
          var x3=d.getElementById('moX'); if(x3) x3.click(); await sleep(250); }
  /* Сайтын текст таб */
  var st=d.querySelector('[data-tab="site"]');
  if(st){ st.click(); await sleep(900); window.__grab(); }
  var uniq={}; window.__seen.forEach(function(t){uniq[t]=1});
  return {texts:Object.keys(uniq)};
}`;

function report(title, texts, corpus) {
  const uncovered = [];
  texts.forEach((t) => {
    const rest = uncoveredPart(t, corpus);
    if (rest) uncovered.push({ t, rest });
  });
  const total = texts.length;
  const cov = total ? ((total - uncovered.length) / total * 100) : 100;
  console.log('        цуглуулсан ' + total + ' мөр · хамрагдсан ' + cov.toFixed(1) + '%');
  if (uncovered.length) {
    const show = LIST_ALL ? uncovered : uncovered.slice(0, 25);
    show.forEach((u) => console.log('          ✗ ' + JSON.stringify(u.t).slice(0, 120) +
      '   ← үлдсэн: ' + u.rest.slice(0, 70)));
    if (!LIST_ALL && uncovered.length > 25) console.log('          … нийт ' + uncovered.length + ' (бүрэн жагсаалт: --list)');
  }
  check(title, uncovered.length === 0, uncovered.length + ' мөр бүртгэлгүй');
  return uncovered;
}

/* ── Round-trip: талбар бүрт өвөрмөц тэмдэглэгээ залгаад САЙТ дээр
      гарч ирсэн эсэхийг шалгана. Нэг ачаалалтаар БҮХ талбарыг зэрэг
      шалгах тул хурдан бөгөөд бүрэн. ── */
const MARK = '\u2039RT';   /* ‹RT<n>› */
function markAll(obj, paths) {
  const clone = JSON.parse(JSON.stringify(obj));
  const map = [];
  paths.forEach((p, i) => {
    let c = clone;
    for (let k = 0; k < p.length - 1; k++) c = c[p[k]];
    const last = p[p.length - 1], v = c[last];
    if (typeof v !== 'string' || !v.trim() || !CYR.test(v)) return;
    const tag = MARK + i + '\u203A';
    c[last] = v + tag;
    map.push({ path: p.join('.'), tag });
  });
  return { json: clone, map };
}
function collectPaths(obj, base) {
  const out = [];
  (function walk(o, p) {
    Object.keys(o).forEach((k) => {
      if (k.startsWith('_')) return;
      const v = o[k], np = p.concat([k]);
      if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === 'string') out.push(np.concat([String(i)])); });
      else if (v && typeof v === 'object') walk(v, np);
      else if (typeof v === 'string') out.push(np);
    });
  })(obj, base);
  return out;
}

async function main() {
  if (!CHROME) { bad('Chrome олдсонгүй — DOM тест ажиллуулах боломжгүй'); return; }
  const con = readJson('content.json');
  const reg = readJson('metric_registry.json');
  const corpus = corpusOf([con, reg]);
  const srv = serve();
  try {
    /* ── F1/F2. Хамрах хүрээ ── */
    group('F. Харагдах текстийн хамрах хүрээ');
    const home = await runProbe('/index.html', HOME_PROBE, 150000);
    if (home.__err) bad('Нүүр хуудас ачаалагдав', home.__err);
    else report('F1. Нүүр хуудас — харагдах бүх текст бүртгэлтэй', home.texts, corpus);

    const adm = await runProbe('/admin/index.html', ADMIN_PROBE, 240000);
    if (adm.__err) bad('Админ ачаалагдав', adm.__err);
    else report('F2. Админ — харагдах бүх текст бүртгэлтэй', adm.texts, corpus);

    /* ── F3. Round-trip: site{} + widgets{} → нүүр хуудас ── */
    group('G. Round-trip (бүртгэсэн талбар сайт дээр туссан эсэх)');
    const sitePaths = collectPaths(con.site, ['site']);
    const wPaths = [];
    Object.keys(con.widgets).forEach((id) => {
      if (con.widgets[id].page !== 'Нүүр') return;
      ['title', 'sub', 'unit', 'foot', 'foot2'].forEach((f) => {
        if (typeof con.widgets[id][f] === 'string' && con.widgets[id][f]) wPaths.push(['widgets', id, f]);
      });
    });
    const marked = markAll(con, sitePaths.concat(wPaths));
    /* r06-ийн "Тэргүүлэгч"/"Хоцрогдогч" шошго ЗӨВХӨН 2+ verified салбартай
       үед зурагддаг. Тест ФИКСТУР болгож registry-г санах ойд өргөтгөнө —
       репо дэх файл ХӨНДӨГДӨХГҮЙ. */
    const regFix = JSON.parse(JSON.stringify(reg));
    regFix.widgets.r06.sectors = ['air', 'road'];
    regFix.widgets.i06.sectors = ['air', 'road'];
    OVERRIDE = { '/content.json': JSON.stringify(marked.json),
                 '/metric_registry.json': JSON.stringify(regFix) };
    const rt = await runProbe('/index.html', HOME_PROBE, 180000);
    OVERRIDE = null;
    if (rt.__err) bad('Round-trip ачаалалт', rt.__err);
    else {
      const blob = rt.texts.join('\u0001');
      const missing = marked.map.filter((m) => !blob.includes(m.tag)).map((m) => m.path);
      const shown = marked.map.length - missing.length;
      const src = read('index.html');
      /* DOM-д гараагүй бол ЭХ КОДООС холбоосыг шалгана: нэвтэрсэн үед л
         гардаг товч, feed уналтын үеийн нөөц шошго зэрэг нөхцөлт текстийг
         толгойгүй хөтчөөр хүргэх боломжгүй. Холбоос ч байхгүй бол тэр
         талбар ҮНЭХЭЭР үхмэл — FAIL. */
      const noBinding = missing.filter((p) => {
        if (p.startsWith('widgets.')) {
          const seg = p.split('.');
          return !(src.includes("txt('" + seg[1] + "','" + seg[2] + "'") ||
                   src.includes("this.txt(widgetId,'" + seg[2] + "'"));
        }
        const rest = p.replace(/^site\./, '');
        if (isBound(src, rest, 'stxt')) return false;
        /* SECTORS/RECENT/PROJECTS/AI зэргийг applySiteContent() ДИНАМИКААР
           дүүргэдэг — бүлгийн нэрээр нь холбоосыг таньна. */
        const grp = rest.split('.')[0];
        const dyn = ['sectors', 'sector_kpi', 'sector_kpi_air_live', 'sector_chart', 'unit',
          'portal_kpi', 'week', 'updates', 'community_data', 'ai', 'months', 'nav', 'sector_short'];
        return !(dyn.includes(grp) && src.includes('S.' + grp));
      });
      console.log('        тэмдэглэсэн ' + marked.map.length + ' талбар · сайтад ТУССАН ' + shown +
        ' · DOM-д гараагүй ' + missing.length + ' (кодод холбоосгүй ' + noBinding.length + ')');
      if (missing.length) console.log('          гараагүй: ' + missing.join(', '));
      if (noBinding.length) console.log('          ✗ ' + noBinding.join(', '));
      check('F3. content.json талбар бүр нүүр хуудсанд туссан', noBinding.length === 0,
        noBinding.length + ' талбар кодод огт уншигдахгүй');
    }

    /* ── F4. Round-trip: ui{} → админ ── */
    const uiPaths = collectPaths(con.ui, ['ui']);
    const markedU = markAll(con, uiPaths);
    OVERRIDE = { '/content.json': JSON.stringify(markedU.json) };
    const rtu = await runProbe('/admin/index.html', ADMIN_PROBE, 240000);
    OVERRIDE = null;
    if (rtu.__err) bad('ui round-trip ачаалалт', rtu.__err);
    else {
      const blob = rtu.texts.join('\u0001');
      const missing = markedU.map.filter((m) => !blob.includes(m.tag)).map((m) => m.path);
      console.log('        тэмдэглэсэн ' + markedU.map.length + ' ui талбар · админд туссан ' +
        (markedU.map.length - missing.length));
      /* Хүрэхэд ХҮНДРЭЛТЭЙ дэлгэц (алдааны төлөв, toast, ачаалалт) —
         DOM-д гараагүй бол ЭХ КОДООС utxt() холбоос байгааг шалгана. */
      const src = read('admin/index.html');
      const noBinding = missing.filter((p) => !isBound(src, p.replace(/^ui\./, ''), 'utxt'));
      if (missing.length) console.log('          (DOM-д гараагүй: ' + missing.length +
        ' — үүнээс кодод холбоосгүй: ' + noBinding.length + ')');
      if (noBinding.length) console.log('          ✗ ' + noBinding.join(', '));
      check('F4. ui{} талбар бүр админ дээр холбогдсон', noBinding.length === 0,
        noBinding.length + ' талбар кодод огт уншигдахгүй');
    }

    /* ── F5. ui{} зам бүр кодод уншигддаг эсэх (үхмэл түлхүүр байхгүй) ── */
    const src = read('admin/index.html');
    const dead2 = uiPaths.map((p) => p.slice(1).join('.'))
      .filter((p) => !isBound(src, p, 'utxt'));
    check('F5. ui{} түлхүүр бүр кодод уншигдана (үхмэл түлхүүргүй)', dead2.length === 0,
      dead2.join(', '));
  } finally {
    srv.close();
  }
}

main().then(() => {
  console.log('\n' + '═'.repeat(62));
  console.log('  PASS ' + pass + ' · FAIL ' + fail);
  if (failures.length) { console.log('\n  Алдаатай:'); failures.forEach((f) => console.log('   • ' + f)); }
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });

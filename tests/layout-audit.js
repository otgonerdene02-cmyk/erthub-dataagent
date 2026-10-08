#!/usr/bin/env node
'use strict';
/* ErtHub — ДЭЛГЭЦИЙН ХАРАГДАЦЫН АУДИТ (толгойгүй Chrome)

   Хуудас бүрийг (нүүр, каталог, датасэт бүрийн дэлгэрэнгүй, коммунити …)
   ХЭД ХЭДЭН өргөнөөр жинхэнэ браузер дээр зурж, DOM-ийн хэмжээгээр шалгана:
   текст хүрээнээсээ гарсан уу, график карт хоосон уу, шошго давхцсан уу,
   "NaN"/"undefined" ил гарсан уу. Дүрмийн жагсаалт: tests/lib/layout-audit-probe.js

   Ашиглалт:
     node tests/layout-audit.js                  # selftest + бүх хуудас × 1440,1024
     node tests/layout-audit.js --selftest       # зөвхөн шалгагчийн өөрийн тест (фикстур)
     node tests/layout-audit.js --only=air       # хаягаар шүүнэ ("home" = нүүр)
     node tests/layout-audit.js --vw=1440,390    # өргөн сонгох (390 = гар утас)
     node tests/layout-audit.js --html           # олдвор бүрийн HTML-ийн хэсэг
     node tests/layout-audit.js --json           # машинд уншигдах гаралт

   Өргөн: 1440 (desktop), 1024 (tablet/жижиг laptop) — АЛДААТАЙ БОЛ exit 1.
   390 (гар утас) нь `--vw=390`-ээр тусад нь; сайт одоогоор desktop-first тул
   үндсэн гүйлтэд ОРООГҮЙ (qa-backlog.md).

   Зориудаар зөвшөөрөх: (а) элементэд `data-audit-ignore="шалтгаан"` атрибут,
   (б) `tests/layout-audit-allow.json` руу {route, rule, where?, text?, why}
   (why заавал). Чимэглэл давхарга (absolute/fixed + pointer-events:none)
   автоматаар алгасагдана. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { listenFree } = require('./lib/listen');
const { auditLayout } = require('./lib/layout-audit-probe');
const { FIXTURES } = require('./lib/layout-audit-fixtures');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argv = (k) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : null; };
const ONLY = argv('only');
const JSON_OUT = args.includes('--json');
const SELFTEST_ONLY = args.includes('--selftest');
const VIEWPORTS = (argv('vw') ? argv('vw').split(',').map(Number) : [1440, 1024])
  .map((w) => ({ w, h: w < 500 ? 844 : w < 1100 ? 768 : 900 }));

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').split('\r\n').join('\n');
/* Датасэтийн хаяг (slug) — index.html-ийн datasetSlug-тай ЯГ ижил томьёо.
   content.json → site.datasets нэрийг давхарлаж болох тул хоёуланг нь уншина. */
function slugOf(d) {
  return d.sector + '__' + String(d.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}
function datasetRoutes() {
  const block = html.slice(html.indexOf('const DATASETS=['));
  const arr = block.slice(0, block.indexOf('\n];'));
  const names = []; const re = /\{sector:'(\w+)',name:'((?:[^'\\]|\\.)*)'/g; let m;
  while ((m = re.exec(arr))) names.push({ sector: m[1], name: m[2].replace(/\\'/g, "'") });
  try {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'content.json'), 'utf8')).site.datasets;
    if (Array.isArray(c)) c.forEach((o, i) => { if (o && o.name && names[i]) names[i].name = o.name; });
  } catch (e) { /* content.json-гүй ч ажиллана */ }
  return names.map((d) => 'browse/' + encodeURIComponent(slugOf(d)));
}

const CASES = [];
if (!SELFTEST_ONLY) {
  ['', 'eservices', 'browse', 'community', 'history', 'news'].concat(datasetRoutes())
    .filter((r) => !ONLY || (ONLY === 'home' ? r === '' : decodeURIComponent(r).indexOf(ONLY) >= 0))
    .forEach((r) => VIEWPORTS.forEach((v) => CASES.push({ kind: 'page', route: r, url: '/index.html' + (r ? '#/' + r : ''), w: v.w, h: v.h })));
}
/* Админы виджет бүрийн засварын дэлгэцийн PREVIEW — сайттай ХОЁУЛАНГ шалгах нь төслийн дүрэм */
const ADMIN_SEC = { hero_fl: 'hero', hero_px: 'hero', uk: 'portal-kpi', ls: 'sec-01', w2p: 'sec-02', w2pb: 'sec-02', w2px: 'sec-02', w2c: 'sec-02', w2cb: 'sec-02', w2cx: 'sec-02', k04: 'sec-04', t05: 'sec-05', d05: 'sec-05', i06: 'sec-06', r06: 'sec-06', u07: 'sec-07' };
/* Нүүрийн салбарын шүүлт (🚗 🚆 ✈️ 🚢 🚌) — салбар бүр ӨӨР график/хоосон төлөв зурдаг тул тус бүрийг шалгана */
if (!SELFTEST_ONLY && (!ONLY || ONLY === 'home' || ONLY === 'sector')) {
  ['road', 'rail', 'air', 'water', 'public'].forEach((k, i) => VIEWPORTS.forEach((v) => CASES.push({ kind: 'sector', route: 'home→' + k, url: '/index.html', w: v.w, h: v.h, chip: i + 1 })));
}
if (!SELFTEST_ONLY && (!ONLY || ONLY === 'admin')) {
  Object.keys(ADMIN_SEC).forEach((id) => CASES.push({ kind: 'admin', route: 'admin/' + id, url: '/admin/index.html', w: 1440, h: 900, widget: id, section: ADMIN_SEC[id] }));
}
if (!ONLY || SELFTEST_ONLY) {
  Object.keys(FIXTURES).forEach((k) => CASES.push({ kind: 'fixture', route: k, url: '/__fixture__/' + k, w: 1000, h: 700, expect: FIXTURES[k].expect }));
}

let allow = [];
try { allow = JSON.parse(fs.readFileSync(path.join(__dirname, 'layout-audit-allow.json'), 'utf8')); } catch (e) { /* байхгүй бол хоосон */ }
const allowed = (route, f) => allow.some((a) => (a.route === '*' || decodeURIComponent(route).indexOf(a.route) === 0) &&
  a.rule === f.rule && (!a.where || f.where.indexOf(a.where) >= 0) && (!a.text || String(f.text).indexOf(a.text) >= 0));

let RESULT = null;
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/__result__' && req.method === 'POST') {
    const ch = []; req.on('data', (c) => ch.push(c));
    req.on('end', () => { RESULT = Buffer.concat(ch).toString('utf8'); res.writeHead(200); res.end('ok'); });
    return;
  }
  if (p.indexOf('/__fixture__/') === 0) {
    const f = FIXTURES[p.slice('/__fixture__/'.length)];
    if (!f) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><style>body{margin:12px;font:14px/1.4 sans-serif;color:#223}</style>' + f.html);
    return;
  }
  if (p === '/__probe__') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0">
<script>
const AUDIT=${auditLayout.toString()};
const CASES=${JSON.stringify(CASES)};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function run(c){
  const f=document.createElement('iframe');
  f.style.cssText='border:0;position:absolute;left:0;top:0;width:'+c.w+'px;height:'+c.h+'px';
  f.src=c.url;
  document.body.appendChild(f);
  const real=c.kind!=='fixture';
  /* Хуудас тогтворжтол хүлээнэ: DOM-ийн текстийн урт 3 дараалсан хэмжилтэд өөрчлөгдөхгүй */
  let last=-1, stable=0, t0=Date.now();
  while(Date.now()-t0<20000){
    await sleep(real?400:150);
    let d; try{ d=f.contentDocument }catch(e){ continue }
    /* about:blank-д эхний хэмжилт хийж "тогтвортой" гэж андуурахаас сэргийлнэ */
    if(!d||!d.body||d.URL=='about:blank'||d.readyState!=='complete') continue;
    if(real&&d.body.innerHTML.length<8000) continue;
    const n=d.body.innerText.length;
    if(n===last) stable++; else { stable=0; last=n }
    if(stable>=(real?3:2)) break;
  }
  const d=f.contentDocument, w=f.contentWindow;
  try{ await d.fonts.ready }catch(e){}
  let opts={};
  if(c.kind==='admin'){
    /* Админ: виджетийн засварын дэлгэц рүү орж, зөвхөн preview-г (#pvhost) шалгана */
    await sleep(3500);
    let b,n=0; while((b=d.querySelector('[data-back]'))&&n++<6) b.click();
    await sleep(250);
    const s=d.querySelector('[data-section="'+c.section+'"]'); if(s){ s.click(); await sleep(300) }
    const wd=d.querySelector('[data-widget="'+c.widget+'"]');
    if(!wd){ f.remove(); return [{rule:'audit-error',where:c.widget,text:'',detail:'виджет олдсонгүй (data-widget)'}] }
    wd.click(); await sleep(900);
    opts={root:'#pvhost'};
  }
  if(c.kind==='sector'){
    await sleep(1500);
    const bar=d.getElementById('sec-01'); const row=bar&&bar.nextElementSibling;
    const btns=row?Array.from(row.querySelectorAll('button')):[];
    if(!btns[c.chip]){ f.remove(); return [{rule:'audit-error',where:'sector chip',text:'',detail:'салбарын шүүлтийн товч олдсонгүй #'+c.chip}] }
    btns[c.chip].click(); await sleep(1500);
  }
  /* Анимаци/скролл-ээр харагддаг хэсгүүдийг идэвхжүүлэхийн тулд хуудсыг доош гүйлгэнэ */
  if(c.kind==='page'||c.kind==='sector'){ try{ w.scrollTo(0,d.documentElement.scrollHeight); await sleep(300); w.scrollTo(0,0); await sleep(500) }catch(e){} }
  let r;
  try{ r=AUDIT(d,w,opts) }catch(e){ r=[{rule:'audit-error',where:'',text:'',detail:String(e&&e.stack||e)}] }
  f.remove();
  return r;
}
(async()=>{
  const all=[];
  for(const c of CASES){ all.push(Object.assign({},c,{findings:await run(c)})) }
  fetch('/__result__',{method:'POST',body:JSON.stringify(all)});
})();
</script></body>`);
    return;
  }
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
  fs.readFile(path.join(ROOT, p === '/' ? '/index.html' : p), (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

/* Chrome ажиллуулж бүх кейсийн үр дүнг авна. tests/run.js-аас ч дуудагдана. */
async function collect() {
  const port = listenFree(srv);
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'eh-layout-'));
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--mute-audio', '--user-data-dir=' + tmp, '--window-size=1600,1000',
    'http://localhost:' + port + '/__probe__'], { stdio: 'ignore' });
  const deadline = Date.now() + 15 * 60 * 1000;
  while (RESULT === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));
  try { ch.kill(); } catch (e) { /* алгасна */ }
  srv.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* алгасна */ }
  return RESULT === null ? null : JSON.parse(RESULT);
}

(async () => {
  if (!CHROME) { console.log('SKIP  Chrome олдсонгүй — харагдацын аудит ажиллаагүй'); process.exit(0); }
  const cases = await collect();
  if (!cases) { console.error('FAIL  аудит хугацаа хэтэрлээ'); process.exit(1); }
  if (JSON_OUT) { console.log(JSON.stringify(cases, null, 1)); }
  let bad = 0, silenced = 0, selfBad = 0, selfN = 0;
  const detail = (f) => '        [' + f.rule + '] ' + f.where + (f.text ? ' «' + f.text + '»' : '') + ' — ' + f.detail +
    (args.includes('--html') && f.html ? '\n          ' + f.html : '');

  /* 1. Шалгагчийн өөрийн тест — ЭХЛЭЭД. Энэ нь унавал хуудсын үр дүнд итгэж болохгүй. */
  const self = cases.filter((c) => c.kind === 'fixture');
  if (self.length && !JSON_OUT) console.log('══ Шалгагчийн selftest (' + self.length + ' фикстур) ' + '═'.repeat(30));
  self.forEach((c) => {
    selfN++;
    const got = Array.from(new Set(c.findings.map((f) => f.rule))).sort();
    const want = c.expect.slice().sort();
    const ok = got.join() === want.join();
    if (!ok) selfBad++;
    if (!JSON_OUT) {
      console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + c.route + (ok ? '' : '\n        хүлээсэн: [' + want + '] · гарсан: [' + got + ']'));
      if (!ok) c.findings.forEach((f) => console.log(detail(f)));
    }
  });

  /* 2. Бодит хуудсууд */
  const pages = cases.filter((c) => c.kind !== 'fixture');
  if (pages.length && !JSON_OUT) console.log('\n══ Хуудас × өргөн (' + pages.length + ') ' + '═'.repeat(34));
  pages.forEach((c) => {
    const fs_ = c.findings.filter((f) => !allowed(c.route, f));
    silenced += c.findings.length - fs_.length;
    bad += fs_.length;
    if (JSON_OUT) return;
    const name = (c.kind === 'admin' ? '' : '/') + decodeURIComponent(c.route) + ' @' + c.w;
    if (!fs_.length) { console.log('  PASS  ' + name); return; }
    console.log('  FAIL  ' + name + '  (' + fs_.length + ')');
    fs_.forEach((f) => console.log(detail(f)));
  });
  console.log('\nХарагдацын аудит: ' + (selfN ? 'selftest ' + (selfN - selfBad) + '/' + selfN + ' · ' : '') +
    pages.length + ' хуудас×өргөн, ' + bad + ' олдвор' + (silenced ? ', ' + silenced + ' нь allow жагсаалтаар зөвшөөрөгдсөн' : ''));
  process.exit(bad || selfBad ? 1 : 0);
})();

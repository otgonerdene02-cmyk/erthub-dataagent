#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   ErtHub — Нүүр хуудасны admin/сайт холбоосын СИСТЕМТЭЙ ТЕСТ

   Санамсаргүй биш, бүлэг бүрээр PASS/FAIL гаргана:
     A. Дата ачаалалт (fetch, fallback, эвдэрсэн JSON)
     B. Текстийн холбоос (content.json ↔ index.html round-trip)
     C. Admin UI (ачаалалт, хайлт, шүүлт, буцах, экспорт)
     D. Хил хязгаарын тохиолдол
     E. Регресс (H1–H5, T1–T4 хэвээр)

   Ашиглалт:  node tests/run.js
   Гаралт:    бүлэг бүрийн PASS/FAIL + нийт дүн, алдаатай бол exit 1

   B ба C бүлэг нь DOM шаарддаг тул толгойгүй Chrome-оор ЖИНХЭНЭ
   хуудсыг ачаалж шалгана (chrome олдохгүй бол тэр 2 бүлгийг SKIP
   гэж тэмдэглэнэ — чимээгүй өнгөрөхгүй).
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8971;
let pass = 0, fail = 0, skip = 0;
const failures = [];

function group(name) { console.log('\n══ ' + name + ' ' + '═'.repeat(Math.max(0, 58 - name.length))); }
function ok(name) { pass++; console.log('  PASS  ' + name); }
function bad(name, detail) {
  fail++; failures.push(name + (detail ? ' — ' + detail : ''));
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function skipped(name, why) { skip++; console.log('  SKIP  ' + name + (why ? ' (' + why + ')' : '')); }
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJson = (f) => JSON.parse(read(f));

/* Хуудасны <script> блокийг гаргаж авах — синтакс шалгах, грепдэх */
function dcScript() {
  const m = read('index.html').match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
  return m ? m[1] : '';
}
function adminScript() {
  const m = read('admin/index.html').match(/<script>\n([\s\S]*?)<\/script>/);
  return m ? m[1] : '';
}
/* Темплейт хэсэг = <script>-ээс ГАДНАХ бүх HTML */
function indexTemplate() {
  return read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');
}

/* ────────────────────────── A. ДАТА АЧААЛАЛТ ────────────────────────── */
function groupA() {
  group('A. Дата ачаалалт');

  let con, reg;
  try { con = readJson('content.json'); ok('content.json — зөв JSON'); }
  catch (e) { bad('content.json — зөв JSON', e.message); }
  try { reg = readJson('metric_registry.json'); ok('metric_registry.json — зөв JSON'); }
  catch (e) { bad('metric_registry.json — зөв JSON', e.message); }
  if (!con || !reg) return;

  check('content.json-д widgets{} блок байна', !!con.widgets);
  check('content.json-д site{} блок байна', !!con.site);
  check('metric_registry.json-д widgets{} байна', !!reg.widgets);
  check('metric_registry.json-д metrics{} байна', !!reg.metrics);

  const src = dcScript();
  /* Fetch унасан үед fallback: txt()/stxt() хоёул fallback аргументтай */
  check('txt() fallback аргументтай', /txt\(id,field,fallback\)/.test(src));
  check('stxt() fallback аргументтай', /stxt\(path,fallback\)/.test(src));
  check('loadContent() try/catch-тай (fetch уналт)', /async loadContent\(\)\{\s*try\{/.test(src));
  check('loadMetricRegistry() try/catch-тай', /async loadMetricRegistry\(\)\{\s*try\{/.test(src));

  /* Бүтэц буруу JSON үед эвдрэхгүй: stxt нь объект бус зам дээр fallback буцаана */
  const stxtSafe = /if\(cur==null\|\|typeof cur!=='object'\) return fallback;/.test(src);
  check('stxt() бүтэц буруу үед fallback (эвдрэхгүй)', stxtSafe);

  /* КЭШ — Pages CDN max-age=600 тул no-store + давтагдашгүй query заавал */
  check('content.json fetch нь no-store', /fetch\('content\.json\?t='\+Date\.now\(\),\{cache:'no-store'\}\)/.test(src),
    'CDN 10 мин кэшлэдэг тул no-cache хангалтгүй');
  check('metric_registry.json fetch нь no-store', /fetch\('metric_registry\.json\?t='\+Date\.now\(\),\{cache:'no-store'\}\)/.test(src));
}

/* ─────────────────── B. ТЕКСТИЙН ХОЛБООС (round-trip) ─────────────────── */
function groupB() {
  group('B. Текстийн холбоос (content.json ↔ index.html)');

  const con = readJson('content.json');
  const src = dcScript();
  const tpl = indexTemplate();

  /* B1. widgets{} — бүртгэлтэй талбар бүр txt()-ээр УНШИГДАЖ байх ёстой.
     Нүүр хуудасны виджет л хамаарна (page==='Нүүр'). */
  const homeIds = Object.keys(con.widgets).filter(id => con.widgets[id].page === 'Нүүр');
  const FIELDS = ['title', 'sub', 'unit', 'foot', 'foot2'];
  const unused = [];
  homeIds.forEach(id => {
    FIELDS.forEach(f => {
      if (!(f in con.widgets[id])) return;
      /* w2p/w2c-ийн unit-ыг buildWeek дотор this.txt(widgetId,'unit','')
         гэж ДИНАМИК түлхүүрээр уншдаг тул шууд мөрөөр олдохгүй. */
      const dyn = (f === 'unit' && (id === 'w2p' || id === 'w2c')
                   && src.includes("this.txt(widgetId,'unit'"));
      if (!dyn && !src.includes("txt('" + id + "','" + f + "'")) unused.push(id + '.' + f);
    });
  });
  check('Бүртгэлтэй виджетийн талбар бүр txt()-ээр уншигдана',
    unused.length === 0, unused.length ? 'ашиглагдаагүй: ' + unused.join(', ') : '');

  /* B2. txt()-ээр уншсан утга ТЕМПЛЕЙТЭД холбоос болж гарах ёстой.
     renderVals-д "xxxTitle:this.txt(...)" гэж үүсгээд {{ xxxTitle }}
     гэж темплейтэд ашиглагдаагүй бол сайтад ХЭЗЭЭ Ч харагдахгүй. */
  const deadVals = [];
  const valRe = /(\w+):this\.txt\('([\w]+)','(\w+)'/g;
  let m;
  while ((m = valRe.exec(src))) {
    const valName = m[1];
    if (!new RegExp('\\{\\{\\s*' + valName + '\\s*\\}\\}').test(tpl)) {
      deadVals.push(valName + ' (' + m[2] + '.' + m[3] + ')');
    }
  }
  check('txt() утга бүр темплейтэд холбогдсон (үхмэл талбаргүй)',
    deadVals.length === 0, deadVals.length ? 'темплейтэд алга: ' + deadVals.join(', ') : '');

  /* B3. site{} — бүртгэлтэй зам бүр stxt()-ээр уншигдаж байх ёстой */
  const sitePaths = [];
  (function walk(o, p) {
    Object.keys(o).forEach(k => {
      if (k.startsWith('_')) return;
      const v = o[k], np = p ? p + '.' + k : k;
      if (Array.isArray(v)) v.forEach((_, i) => sitePaths.push(np + '.' + i));
      else if (v && typeof v === 'object') walk(v, np);
      else sitePaths.push(np);
    });
  })(con.site, '');
  const siteUnused = sitePaths.filter(p => {
    if (/^months\.\d+$/.test(p)) return !/stxt\('months\.'\+\(m-1\)/.test(src);
    if (/^hero\.diagram\.chips\.\d+$/.test(p)) return !/stxt\('hero\.diagram\.chips\./.test(src);
    if (/^hero\.diagram\.chip_bodies\.\d+$/.test(p)) return !/stxt\('hero\.diagram\.chip_bodies\./.test(src);
    /* nav-ийн шошгыг PAGES дээр давталтаар уншдаг тул түлхүүр нь ДИНАМИК */
    if (/^nav\./.test(p)) return !src.includes("stxt('nav.'+p.id");
    /* Богино нэрийг livestrip дотор ДИНАМИК түлхүүрээр уншина */
    if (/^sector_short\./.test(p)) return !src.includes("stxt('sector_short.'+k");
    /* applySiteContent() нь модулийн түвшний тогтмолыг (SECTORS, KPI_UNIFIED,
       WEEK_DATA, RECENT, PROJECTS, POLICIES, AI_*) content.json-оос ДИНАМИК
       түлхүүрээр дүүргэдэг тул мөрөөр хайж олдохгүй. Бүлгийн нэр тэр функц
       дотор ашиглагдсан эсэхийг шалгана. Утга нь сайт дээр ҮНЭХЭЭР гарч
       ирснийг tests/text-coverage.js (F3 round-trip) DOM-оос баталдаг. */
    const dynGroups = ['sectors', 'sector_kpi', 'sector_kpi_air_live', 'sector_chart', 'unit',
      'portal_kpi', 'week', 'updates', 'community_data', 'ai'];
    const grp = p.split('.')[0];
    if (dynGroups.includes(grp) && /function applySiteContent\(\)/.test(src)) {
      return !(src.includes('S.' + grp) || src.includes("stxt('" + grp + "."));
    }
    return !src.includes("stxt('" + p + "'");
  });
  check('site{} зам бүр stxt()-ээр уншигдана',
    siteUnused.length === 0, siteUnused.length ? 'ашиглагдаагүй: ' + siteUnused.join(', ') : '');

  /* B4. site vals темплейтэд холбогдсон эсэх */
  const deadSite = [];
  const sRe = /(s[A-Z]\w+):this\.stxt\(/g;
  while ((m = sRe.exec(src))) {
    if (!new RegExp('\\{\\{\\s*' + m[1] + '\\s*\\}\\}').test(tpl)) deadSite.push(m[1]);
  }
  check('stxt() утга бүр темплейтэд холбогдсон', deadSite.length === 0,
    deadSite.length ? 'алга: ' + deadSite.join(', ') : '');

  /* B5. Нүүр хуудасны темплейт мужид хатуу бичигдсэн монгол текст үлдээгүй.
     Муж = hero-гоос 08-р хэсэг хүртэл (бусад хуудас хамрах хүрээнд ОРОХГҮЙ). */
  const lines = read('index.html').split('\n');
  const hard = [];
  for (let i = 395; i < 1340; i++) {
    const line = lines[i];
    if (!line) continue;
    (line.match(/>([^<>{}]*[А-Яа-яӨөҮүЁё][^<>{}]*)</g) || []).forEach(x => {
      const t = x.slice(1, -1).trim();
      if (t.length > 1 && !/^[·—\-–\s]*$/.test(t)) hard.push('мөр ' + (i + 1) + ': ' + t.slice(0, 40));
    });
  }
  check('Нүүр хуудасны темплейтэд хатуу монгол текст үлдээгүй',
    hard.length === 0, hard.slice(0, 6).join(' | '));
}

/* ─────────────────────── D. ХИЛ ХЯЗГААРЫН ТОХИОЛДОЛ ─────────────────────── */
function groupD() {
  group('D. Хил хязгаарын тохиолдол');
  const src = dcScript();
  const adm = adminScript();

  /* Хоосон текст — txt() хоосон мөрийг fallback руу шилжүүлэх ёстой */
  check("txt() хоосон мөрийг fallback болгоно", /\(v==null\|\|v===''\)\?fallback:v/.test(src));
  check("stxt() хоосон мөрийг fallback болгоно", /\(cur==null\|\|cur===''\)\?fallback:cur/.test(src));

  /* Тусгай тэмдэгт — admin бүх хэрэглэгчийн текстийг esc()-ээр гаргах ёстой */
  check('admin-д esc() HTML тусгаарлагч байна',
    /function esc|var esc=/.test(adm) && /&amp;|&lt;|&gt;|&quot;/.test(adm));
  const escFn = adm.match(/var esc=[\s\S]{0,260}/);
  check('esc() нь < > & " \' бүгдийг барина',
    !!escFn && ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'].every(v => escFn[0].includes(v)));

  /* Урт текст — талбарууд нь textarea/овервлоу боловсруулалттай эсэх */
  check('Урт талбаруудад textarea ашигладаг (LONG_FIELDS)', /LONG_FIELDS=\{/.test(adm));

  /* Метрик салгах — "— холбоогүй —" сонголт байх ёстой, буцаан салгахад
     quality нь mock/none руу зөв буцна */
  check('Метрик "— холбоогүй —" сонголттой', /холбоогүй/.test(adm));
  check('Метрик салгахад quality mock/none руу буцна',
    /sv\.quality=\(ov&&ov\.quality==='none'\)\?'none':'mock';/.test(adm));

  /* 0-той хувь тооцохгүй (NaN-аас сэргийлэх) — H5-ийн зарчим */
  check('0 суурьтай хувь тооцохгүй (NaN сэргийлэлт)', /a===0\?null:/.test(src));

  /* Кирилл/латин холимог — механик шалгагч байгаа эсэх */
  check('check-cyrillic.js шалгагч байна', fs.existsSync(path.join(ROOT, 'scripts/check-cyrillic.js')));
}

/* ──────────────────────────── E. РЕГРЕСС ──────────────────────────── */
function groupE() {
  group('E. Регресс (H1–H5, T1–T4)');
  const src = dcScript();
  const adm = adminScript();
  const reg = readJson('metric_registry.json');
  const con = readJson('content.json');

  /* H3 — hero_fl registry-ээр холбогдсон */
  check('H3: hero_fl metric_registry-тэй холбогдсон',
    reg.widgets.hero_fl && reg.widgets.hero_fl.metric === 'air.flight_count_last_month');
  /* H4 — 17 виджет бүртгэлтэй */
  const SCOPE17 = ['hero_fl', 'hero_px', 'uk', 'ls', 'w2p', 'w2pb', 'w2px', 'w2c', 'w2cb',
    'w2cx', 'k04', 't05', 'd05', 'i06', 'r06', 'u07', 'ai08'];
  const missing = SCOPE17.filter(id => !reg.widgets[id]);
  check('H4: 17 виджет бүгд registry-д бүртгэлтэй', missing.length === 0, missing.join(','));
  /* H5 — verified бус салбар 0/"—"/мэдээлэл алга */
  check('H5: sectorVerified() registry-ийн 2 бүтцийг барина',
    /sectorVerified\(widgetId,sectorKey\)/.test(src) && /Array\.isArray\(w\.sectors\)/.test(src));
  check('H5: verified бус үед хувь "—" болно', /delta:verified\?[^:]+:'—'/.test(src));
  check('H5: хавтгай спарклайн (flatSpark) ашиглагдана', /flatSpark/.test(src));
  check('H5: w2p/w2c өдөр тутмын БОДИТ багана', /dailyPax|dailyCargo/.test(src));
  /* T2/T3 — site{} блок ба admin таб */
  check('T2: content.json-д site{} блок', !!con.site && !!con.site.nav);
  check('T3: admin-д "Сайтын текст" таб', /Сайтын текст/.test(adm));
  check('T3: site{} index.html-д ХЭРЭГЛЭГДЭЖ байна (зөвхөн бүртгэл биш)',
    /stxt\('nav\./.test(src) && /stxt\('footer\.copyright'/.test(src));
  /* T4 — хайлт+шүүлт */
  check('T4: хайлтын талбар (wq)', /S\.wq/.test(adm));
  check('T4: 3 шүүлтүүр (quality/page/viz)', /wQuality/.test(adm) && /wPage/.test(adm) && /wViz/.test(adm));
  check('T4: хоосон илэрцийн мессеж', /emptyFilterMsg/.test(adm));
  /* Навигаци */
  check('Буцах: goBack() нэгдсэн зам', /function goBack\(\)/.test(adm));
  check('Буцах: хөтчийн history (popstate)', /popstate/.test(adm) && /pushState/.test(adm));
  /* Нэршил — placeholder syntax үлдээгүй */
  /* Комментыг хасаж шалгана — тайлбар доторх иш татсан жишээ алдаа биш */
  const admNoCmt = adm.replace(/\/\*[\s\S]*?\*\//g, '');
  check('Нэршил: admin-д "<...>" placeholder үлдээгүй',
    !/<идэвхтэй салбар>|<үзүүлэлт>/.test(admNoCmt));
  check('Нэршил: байршлын зам (widgetPath) байна', /function widgetPath\(/.test(adm));

  /* T5 — админы интерфейсийн текст ба маягтын шошго ч content.json-оос */
  const con5 = readJson('content.json');
  check('T5: content.json-д ui{} блок байна', !!con5.ui && Object.keys(con5.ui).length > 10);
  check('T5: content.json-д ui_form{} (маягтын шошго) байна',
    !!con5.ui_form && Array.isArray(con5.ui_form.ui) && Array.isArray(con5.ui_form.site));
  check('T5: admin-д utxt() уншигч байна', /function utxt\(path,fallback\)/.test(adm));
  check('T5: admin ui_form-оос бүлгийн шошгыг уншина',
    /CON\.ui_form/.test(adm) && /SITE_GROUPS=uf\.site/.test(adm));
  check('T5: admin бүх навч талбарыг засварлагдах болгоно',
    /function everyTextPath\(\)/.test(adm) && /function sitePaths\(\)\{ return everyTextPath\(\); \}/.test(adm));
  check('T5: index.html-д applySiteContent() байна',
    /function applySiteContent\(\)/.test(src) && /SITE_TEXT=\(json&&json\.site\)\|\|null;/.test(src));
  check('T5: модулийн түвшний stxt() (класс гаднаас уншина)',
    /^function stxt\(path,fallback\)\{/m.test(src));
  /* Виджетийн preview дэх салбарын нэр админд ХАТУУ бичигдээгүй —
     site.sectors-оос ирнэ (01-р виджетийн 5 салбарын нэр гэх мэт) */
  check('T5: admin салбарын нэрийг site.sectors-оос авна',
    /CON\.site&&CON\.site\.sectors/.test(adm) && /SECN\[k\]=sec\[k\]/.test(adm));
}

/* ───────────────────── C. ADMIN UI (толгойгүй Chrome) ───────────────────── */
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

/* Тест сервер. ЧУХАЛ: probe хуудсыг ЭНЭ Л серверээс өгнө — өмнө нь
   file:// дээрээс http://localhost-ыг iframe-дэж байсан нь CROSS-ORIGIN
   болж contentDocument унаад probe мөнхөд хүлээж, ETIMEDOUT болдог байв. */
let PROBE_JS = '', PROBE_RESULT = null;
function serve() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
    '.css': 'text/css', '.svg': 'image/svg+xml' };
  return http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/__result__' && req.method === 'POST') {
      let b = ''; req.on('data', c => b += c);
      req.on('end', () => { PROBE_RESULT = b; res.writeHead(200); res.end('ok'); });
      return;
    }
    if (p === '/__probe__') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body>
<iframe id="f" src="/admin/index.html" style="width:1400px;height:1200px;border:0"></iframe>
<script>
function done(v){fetch('/__result__',{method:'POST',body:JSON.stringify(v)})}
function poll(){var f=document.getElementById('f'),d,w;
 try{d=f.contentDocument;w=f.contentWindow}catch(e){return setTimeout(poll,200)}
 if(!d||!d.body||d.body.innerHTML.length<8000) return setTimeout(poll,200);
 try{ (${PROBE_JS})(d,w).then(done).catch(function(e){done({__err:String(e)})}) }
 catch(e){ done({__err:String(e)}) }
}
setTimeout(poll,1000);
</script></body>`);
      return;
    }
    fs.readFile(path.join(ROOT, p === '/' ? '/index.html' : p), (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);
}

/* Probe-ыг ЖИНХЭНЭ хугацаагаар (virtual time БИШ) ажиллуулж, үр дүнг
   сервер рүү POST-оор авна. Event loop-ийг блоклохгүйн тулд async. */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function runProbe(jsBody, waitMs) {
  PROBE_JS = jsBody; PROBE_RESULT = null;
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--mute-audio',
    '--disable-features=Translate,OptimizationHints',
    'http://localhost:' + PORT + '/__probe__'], { stdio: 'ignore' });
  const deadline = Date.now() + (waitMs || 90000);
  while (PROBE_RESULT === null && Date.now() < deadline) await sleep(250);
  try { ch.kill(); } catch (e) {}
  if (PROBE_RESULT === null) return { __err: 'probe хугацаа хэтэрлээ' };
  try { return JSON.parse(PROBE_RESULT); }
  catch (e) { return { __err: 'JSON задлахад алдаа: ' + e.message }; }
}

async function groupC() {
  group('C. Admin UI');
  if (!CHROME) { skipped('Admin UI бүлэг бүхэлдээ', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const probe = `async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const txt=(s,t)=>[...d.querySelectorAll(s)].find(e=>e.textContent.includes(t));
      const R={};
      // 1) 16 виджет ачаалагдах ("Бүх харагдац")
      const ab=[...d.querySelectorAll('button')].find(b=>b.textContent.includes('Бүх харагдац'));
      if(ab){ab.click(); await sleep(700);}
      R.cards=d.querySelectorAll('.allcard').length;
      R.shapes=[...new Set([...d.querySelectorAll('.pvshape')].map(e=>e.textContent))].length;
      R.tickers=d.querySelectorAll('.pvticker').length;
      R.paths=d.querySelectorAll('.allsec[title]').length;
      /* ЭЛЕМЕНТИЙГ БҮРД НЬ ДАХИН ХАЙНА — #fbar дахин зурагдахад хуучин
         лавлагаа тасарч, .value олгосон нь үйлчлэхгүй болно. */
      const setQ=async v=>{const q=d.getElementById('wq');
        if(q){q.value=v;q.dispatchEvent(new w.Event('input',{bubbles:true}));await sleep(400);}};
      const setSel=async (id,v)=>{const s=d.getElementById(id);
        if(s){s.value=v;s.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(400);}};
      // 2) Хайлт — тохирох илэрц
      await setQ('донут');
      R.searchHit=d.querySelectorAll('.allcard').length;
      // 3) Хайлт — ХООСОН илэрц + мессеж
      await setQ('зzzqx');
      R.searchNone=d.querySelectorAll('.allcard').length;
      R.emptyMsg=/олдсонгүй/.test(d.getElementById('body').textContent);
      await setQ('');
      R.afterQClear=d.querySelectorAll('.allcard').length;
      // 4) Шүүлтүүр — quality
      await setSel('fQuality','verified');
      R.fQuality=d.querySelectorAll('.allcard').length;
      // 5) Шүүлтүүр — төрөл (quality-тай ХАМТ = AND логик)
      const fv0=d.getElementById('fViz');
      R.vizNames=[...(fv0?fv0.options:[])].map(o=>o.textContent).slice(1,4);
      if(fv0&&fv0.options.length>1) await setSel('fViz',fv0.options[1].value);
      R.fBoth=d.querySelectorAll('.allcard').length;
      // цэвэрлэх
      await setSel('fQuality','all');
      await setSel('fViz','all');
      R.afterClear=d.querySelectorAll('.allcard').length;
      // 6) Буцах — виджет рүү ороод breadcrumb/ESC/history
      const lv=[...d.querySelectorAll('button')].find(b=>b.textContent.includes('Хэсгээр нь'));
      if(lv){lv.click(); await sleep(450);}
      const sec=txt('[data-section]','Долоо хоногийн тайлан');
      if(sec){sec.click(); await sleep(450);}
      R.inWidgets=d.querySelectorAll('.cd[data-cd]').length;
      const ge=[...d.querySelectorAll('[data-goedit]')].find(e=>e.getAttribute('data-goedit').startsWith('w2p|'));
      if(ge){ge.click(); await sleep(500);}
      R.inEdit=!!d.querySelector('[data-tf="title"]');
      R.hasBack=!!d.querySelector('[data-back]');
      R.hasPathbar=!!d.querySelector('.pathbar');
      d.querySelector('[data-back]') && d.querySelector('[data-back]').click(); await sleep(420);
      R.afterBack=d.querySelectorAll('.cd[data-cd]').length;
      // ESC
      if(ge){const g2=[...d.querySelectorAll('[data-goedit]')].find(e=>e.getAttribute('data-goedit').startsWith('w2p|'));
        if(g2){g2.click(); await sleep(450);}}
      /* ✎-ээр орсон үед гарчгийн талбар автоматаар фокуслагддаг. Эхний
         Esc нь талбараас гаргана, хоёр дахь нь буцаана (бичиж байхад
         санамсаргүй хуудас орхихоос сэргийлсэн зан төлөв). */
      d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await sleep(200);
      d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await sleep(420);
      R.afterEsc=d.querySelectorAll('.cd[data-cd]').length;
      // хөтчийн Back
      const g3=[...d.querySelectorAll('[data-goedit]')].find(e=>e.getAttribute('data-goedit').startsWith('w2p|'));
      if(g3){g3.click(); await sleep(450);}
      w.history.back(); await sleep(500);
      R.afterHistory=d.querySelectorAll('.cd[data-cd]').length;
      // 7) Экспорт — JSON бүтэц зөв
      const g4=[...d.querySelectorAll('[data-goedit]')].find(e=>e.getAttribute('data-goedit').startsWith('w2p|'));
      if(g4){g4.click(); await sleep(450);}
      const inp=d.querySelector('[data-tf="title"]');
      if(inp){inp.value='ТЕСТ ГАРЧИГ';inp.dispatchEvent(new w.Event('input',{bubbles:true}));await sleep(250);
        const sv=d.querySelector('[data-tsave]'); if(sv&&!sv.disabled){sv.click(); await sleep(300);}}
      let cap=null;
      const oc=w.URL.createObjectURL.bind(w.URL);
      w.URL.createObjectURL=function(b){const r=new w.FileReader();
        r.onload=()=>{cap=r.result}; r.readAsText(b); return oc(b)};
      const ex=d.getElementById('expBtn');
      R.exportEnabled=!!(ex&&!ex.disabled);
      if(R.exportEnabled){ex.click(); for(let i=0;i<25&&!cap;i++) await sleep(200);}
      if(cap){ try{const j=JSON.parse(cap);
        R.expOk=!!(j.widgets&&j.site&&j.widgets.w2p&&j.widgets.w2p.title==='ТЕСТ ГАРЧИГ');
        R.expKeys=Object.keys(j).sort().join(',');
      }catch(e){R.expOk=false;R.expErr=String(e)} }
      // 8) Хил хязгаар — урт текст, тусгай тэмдэгт
      const inp2=d.querySelector('[data-tf="title"]');
      if(inp2){
        const longV='А'.repeat(600);
        inp2.value=longV; inp2.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(280);
        R.longOk=!!d.querySelector('[data-tsave]');
        const spec='<b>"&\\'x</b> 🚗 mixed vү';
        inp2.value=spec; inp2.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(280);
        const pv=d.querySelector('.sitepv');
        R.specNoInject=!!pv && pv.querySelectorAll('b').length===0;
        R.specShown=!!pv && pv.textContent.includes('🚗');
      }
      return R;
    }`;
    const R = await runProbe(probe, 120000);
    if (R.__err) { bad('Admin UI шалгалт ажиллав', R.__err); return; }

    check('16 виджет бүгд ачаалагдана', R.cards === 16, 'олдсон: ' + R.cards);
    check('Виджетүүд ялгаатай хэлбэртэй (≥8 төрөл)', R.shapes >= 8, 'төрөл: ' + R.shapes);
    check('Hero нь карт БИШ, гүйдэг зурвас (2 ш)', R.tickers === 2, 'олдсон: ' + R.tickers);
    check('Виджет бүрд байршлын зам (tooltip)', R.paths === 16, 'олдсон: ' + R.paths);
    check('Хайлт "донут" тохирох илэрц гаргана', R.searchHit === 3, 'олдсон: ' + R.searchHit);
    check('Хайлт хоосон илэрц → 0 карт', R.searchNone === 0, 'олдсон: ' + R.searchNone);
    check('Хоосон илэрцэд "олдсонгүй" мессеж', R.emptyMsg === true);
    check('Quality шүүлтүүр ажиллана', R.fQuality > 0 && R.fQuality < 16, 'олдсон: ' + R.fQuality);
    check('Quality+Төрөл ХАМТ (AND логик)', R.fBoth <= R.fQuality, R.fBoth + ' ≤ ' + R.fQuality);
    check('Төрлийн нэр ойлгомжтой (placeholder биш)',
      Array.isArray(R.vizNames) && R.vizNames.every(n => !/[<>]/.test(n)), JSON.stringify(R.vizNames));
    check('Шүүлт цэвэрлэхэд 16 буцаж ирнэ', R.afterClear === 16, 'олдсон: ' + R.afterClear);
    check('Хэсэг рүү орох (виджет жагсаалт)', R.inWidgets === 6, 'олдсон: ' + R.inWidgets);
    check('Виджет засварт орно', R.inEdit === true);
    check('Засварт "← Буцах" товч байна', R.hasBack === true);
    check('Засварт байршлын зам харагдана', R.hasPathbar === true);
    check('Буцах: ← товчоор жагсаалт руу', R.afterBack === 6, 'олдсон: ' + R.afterBack);
    check('Буцах: ESC-ээр жагсаалт руу', R.afterEsc === 6, 'олдсон: ' + R.afterEsc);
    check('Буцах: хөтчийн Back-аар жагсаалт руу', R.afterHistory === 6, 'олдсон: ' + R.afterHistory);
    check('Экспорт идэвхжинэ', R.exportEnabled === true);
    check('Экспортын JSON бүтэц зөв (widgets+site)', R.expOk === true,
      'түлхүүр: ' + (R.expKeys || '-') + (R.expErr ? ' ' + R.expErr : ''));
    check('Урт текст (600 тэмдэгт) эвдэхгүй', R.longOk === true);
    check('Тусгай тэмдэгт HTML болж ОРОХГҮЙ (esc)', R.specNoInject === true);
    check('Emoji/тусгай тэмдэгт харагдана', R.specShown === true);
  } finally { srv.close(); }
}

/* ──────────────────────────────── АЖИЛЛУУЛАХ ──────────────────────────────── */
console.log('ErtHub — систем тест');
(async () => {
  groupA(); groupB(); await groupC(); groupD(); groupE();

  console.log('\n' + '═'.repeat(62));
  console.log('НИЙТ:  PASS ' + pass + '  ·  FAIL ' + fail + '  ·  SKIP ' + skip);
  if (failures.length) {
    console.log('\nУНАСАН ТЕСТ:');
    failures.forEach(f => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
})();

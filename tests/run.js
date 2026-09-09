#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   ErtHub — Нүүр хуудасны admin/сайт холбоосын СИСТЕМТЭЙ ТЕСТ

   Санамсаргүй биш, бүлэг бүрээр PASS/FAIL гаргана:
     A. Дата ачаалалт (fetch, fallback, эвдэрсэн JSON)
     B. Текстийн холбоос (content.json ↔ index.html round-trip)
     C. Admin UI (ачаалалт, хайлт, шүүлт, буцах, экспорт)
     D. Хил хязгаарын тохиолдол
     E. Регресс (H1–H5, T1–T4 хэвээр)
     H. Дата холболт таб (metric_registry.json → metrics{} метадата)

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
/* Гадаад feed уншигч — J бүлэгт "модуль юу бодох ёстой вэ" гэдгийг
   бодит датагаар шалгахад ашиглана. Сүлжээгүй бол дуудагч тал SKIP. */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    require('https').get(url, (r) => {
      if (r.statusCode !== 200) { reject(new Error('HTTP ' + r.statusCode)); r.resume(); return; }
      let d = ''; r.setEncoding('utf8');
      r.on('data', (c) => { d += c; }).on('end', () => resolve(d));
    }).on('error', reject).setTimeout(20000, function () { this.destroy(new Error('timeout')); });
  });
}

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
      /* `datasets` — нээлттэй өгөгдлийн каталог. stxt() биш, applySiteContent()
         дотор массиваар (индексээр) DATASETS дээр давхарлагддаг тул бусад
         динамик бүлэгтэй ижил зарчмаар шалгагдана. */
      'datasets',
      /* `services` — цахим үйлчилгээний каталог. datasets-тэй ЯГ ижил
         зарчим: applySiteContent() дотор индексээр SERVICES дээр
         давхарлагддаг тул stxt() хайлтад орохгүй. */
      'services',
      /* `eservices` — цахим үйлчилгээний хуудасны таб ба алхмууд. Таб нь
         SVC_TABS, алхам нь SERVICE_STEPS тогтмол дээр давхарлагдана. */
      'eservices','browse','community','news','history',
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
/* Probe-ийн iframe аль хуудсыг ачаалахыг сонгоно (админ / нүүр хуудас),
   мөн ямар нэг файлыг САНАХ ОЙНООС орлуулж өгч болно — репо дэх файл
   ХӨНДӨГДӨХГҮЙ. G бүлэг нь Firestore-гүйгээр нийтлэлийн давхаргыг
   шалгахад үүнийг ашиглана. */
let PROBE_SRC = '/admin/index.html';
let SERVE_OVERRIDE = null;   /* {'/js/erthub-publish.js': '<эх бичвэр>'} */
function serve() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
    '.css': 'text/css', '.svg': 'image/svg+xml' };
  return http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (SERVE_OVERRIDE && SERVE_OVERRIDE[p] != null) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'text/plain',
        'Cache-Control': 'no-store' });
      res.end(SERVE_OVERRIDE[p]);
      return;
    }
    if (p === '/__result__' && req.method === 'POST') {
      /* Байтуудыг бүтнээр нь цуглуулж ТӨГСГӨЛД нь нэг удаа задална —
         chunk тус бүрээр мөр болговол кирилл үсэг (2 байт) заагт таарч
         "�" болж, тест САНАМСАРГҮЙ унадаг байв. */
      const chunks = []; req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        PROBE_RESULT = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200); res.end('ok');
      });
      return;
    }
    if (p === '/__probe__') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body>
<iframe id="f" src="${PROBE_SRC}" style="width:1400px;height:1200px;border:0"></iframe>
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
        /* Оруулсан ТЕКСТ HTML болж хувираагүй эсэхийг ЯГ ТЭР талбар дээр
           шалгана. Өмнө нь "картад <b> элемент огт байхгүй" гэж шалгадаг
           байсан нь буруу дохио өгдөг — preview дотор ЗОРИУДААР зурсан
           <b> (донутын хувь, төлөвлөгөөний утга) ч тестийг унагаана. */
        const ti=pv&&pv.querySelector('[data-ed="title"]');
        R.specNoInject=!!ti && ti.querySelectorAll('b').length===0 &&
                       ti.textContent.indexOf('<b>')>=0;
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

const PROBE_F = "async function(d,w){\n  const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n  await sleep(3500);\n  const SEC={hero_fl:'hero',hero_px:'hero',uk:'portal-kpi',ls:'sec-01',\n    w2p:'sec-02',w2pb:'sec-02',w2px:'sec-02',w2c:'sec-02',w2cb:'sec-02',\n    w2cx:'sec-02',k04:'sec-04',t05:'sec-05',d05:'sec-05',i06:'sec-06',\n    r06:'sec-06',u07:'sec-07'};\n  const norm=t=>t.replace(/[\\s\\u00a0]+/g,' ').trim();\n  const pvT=()=>norm(d.getElementById('pvhost').innerText);\n  const edT=()=>norm(d.querySelector('.edit2').innerText);\n  const geo=()=>[].slice.call(d.querySelectorAll('#pvhost rect,#pvhost circle,#pvhost path,'+\n      '#pvhost .pvsc .v,#pvhost .pvgc .v,#pvhost .pvrow b,#pvhost .pvrk i,'+\n      '#pvhost .pvcd .d,#pvhost .sp-val'))\n    .map(e=>e.tagName+':'+(e.getAttribute('height')||e.getAttribute('d')||\n      e.getAttribute('stroke-dasharray')||e.getAttribute('style')||e.textContent)).join('|');\n  const snap=()=>({t:pvT(),g:geo()});\n  const go=id=>{ let b,n=0; while((b=d.querySelector('[data-back]'))&&n++<6) b.click();\n    const s=d.querySelector('[data-section=\"'+SEC[id]+'\"]'); if(!s) return false;\n    s.click(); const c=d.querySelector('[data-widget=\"'+id+'\"]'); if(!c) return false;\n    c.click(); return true; };\n  const probeAll=(q,attr,mk,scope)=>{ const out={};\n    [].slice.call(d.querySelectorAll(q)).map(x=>x.getAttribute(attr)).forEach(k=>{\n      const e=d.querySelector('['+attr+'=\"'+k+'\"]'); if(!e) return;\n      const ov=e.value, pr=mk(k);\n      e.value=pr; e.dispatchEvent(new w.Event('input',{bubbles:true}));\n      out[k]=scope().indexOf(pr)>=0?'PASS':'FAIL';\n      e.value=ov; e.dispatchEvent(new w.Event('input',{bubbles:true}));\n    }); return out; };\n  const R={rows:[]};\n  for(const id of Object.keys(SEC)){\n    const row={id:id};\n    if(!go(id)){ row.nav=false; R.rows.push(row); continue }\n    row.nav=true;\n    const s0=snap();\n    const sels=[].slice.call(d.querySelectorAll('[data-slot]'));\n    if(!sels.length){ row.swap='N/A'; row.back='N/A' }\n    else{\n      const sel=sels[0], cur=sel.value;\n      const en=[].slice.call(sel.options).filter(o=>!o.disabled&&o.value!==cur).map(o=>o.value);\n      const all=[].slice.call(sel.options).map(o=>o.value).filter(v=>v!==cur);\n      const pref=en.filter(v=>v);\n      const tgt=pref.length?pref[0]:(en.length?en[0]:all[0]);\n      sel.value=tgt; sel.dispatchEvent(new w.Event('change',{bubbles:true}));\n      const s1=snap();\n      row.swap=(s1.t!==s0.t||s1.g!==s0.g);\n      row.swapInfo=(cur||'—')+' → '+(tgt||'—');\n      const s2=d.querySelector('[data-slot]');\n      s2.value=cur; s2.dispatchEvent(new w.Event('change',{bubbles:true}));\n      const s3=snap();\n      row.back=(s3.t===s0.t&&s3.g===s0.g);\n    }\n    const tf=probeAll('[data-tf]','data-tf',k=>'ZZ'+k.toUpperCase()+'ZZ',pvT);\n    const sf=probeAll('.e-fm [data-sf]','data-sf',()=>'ZZSFZZ',pvT);\n    const rf=probeAll('[data-rf]','data-rf',()=>'ZZRFZZ',edT);\n    row.tfN=Object.keys(tf).length; row.sfN=Object.keys(sf).length; row.rfN=Object.keys(rf).length;\n    row.dead=[].concat(Object.entries(tf),Object.entries(sf),Object.entries(rf))\n      .filter(x=>x[1]!=='PASS').map(x=>x[0]);\n    row.text=Object.values(tf).every(v=>v==='PASS');\n    R.rows.push(row);\n  }\n  R.dirty=d.getElementById('dirtyMsg').textContent;\n  return R;\n}";

/* ══════════════════════════════════════════════════════════════════
   F. ВИДЖЕТИЙН БҮХ ТАЛБАР ЗАСВАРЛАГДАХ (16 виджет)

   Энэ бүлэг бол ДАХИН УНАЛТААС хамгаалах гол хаалт. Өмнө нь preview
   доторх зарим элемент (нэгжийн шошго, хэлбэрийн badge, тэнхлэгийн
   тайлбар, төлөвлөгөөний мөр, foot2) КОДОД ХАТУУ бичигдсэн эсвэл өөр
   эх сурвалжаас уншигддаг байсан тул админ дээр засаж байхад preview-д
   ОГТ тусдаггүй байв. Мөн w2p/w2c-ийн баганан график "энэ метрик cargo
   мөн үү?" гэсэн ГАНЦ хатуу нөхцөлөөр дата сонгодог тул метрик сольсон
   ч ӨӨРЧЛӨГДӨХГҮЙ байв.

     F1. Метрик солиход preview-ийн текст эсвэл геометр ӨӨРЧЛӨГДӨНӨ
     F2. Метрикийг буцаахад preview яг анхны төлөвтөө эргэнэ
     F3. Виджетийн текст талбар бүр preview-д ШУУД тусна
     F4. Засварын дэлгэц дээр ҮХМЭЛ (preview-д нөлөөлдөггүй) талбар алга
   ══════════════════════════════════════════════════════════════════ */
async function groupF() {
  group('F. Виджетийн бүх талбар засварлагдах (16 виджет)');
  if (!CHROME) { skipped('F бүлэг бүхэлдээ', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(PROBE_F, 240000);
    if (R.__err) { bad('F бүлэг ажиллав', R.__err); return; }
    const rows = R.rows || [];
    check('16 виджет бүгд засварын дэлгэц нээгдэнэ',
      rows.length === 16 && rows.every(r => r.nav),
      'нээгдсэн: ' + rows.filter(r => r.nav).length);
    const swapBad = rows.filter(r => r.swap === false).map(r => r.id + ' (' + r.swapInfo + ')');
    check('F1. Метрик солиход preview ӨӨРЧЛӨГДӨНӨ', swapBad.length === 0, swapBad.join(', '));
    const backBad = rows.filter(r => r.back === false).map(r => r.id);
    check('F2. Метрикийг буцаахад preview анхны төлөвт эргэнэ', backBad.length === 0, backBad.join(', '));
    const textBad = rows.filter(r => r.text === false).map(r => r.id);
    check('F3. Виджетийн текст талбар бүр preview-д ШУУД тусна', textBad.length === 0, textBad.join(', '));
    const dead = rows.filter(r => (r.dead || []).length).map(r => r.id + ': ' + r.dead.join(','));
    check('F4. Засварын дэлгэцэд ҮХМЭЛ талбар БАЙХГҮЙ', dead.length === 0, dead.join(' | '));
    const total = rows.reduce((a, r) => a + (r.tfN || 0) + (r.sfN || 0) + (r.rfN || 0), 0);
    check('Засварлагдах талбар 200-аас олон шалгагдав', total > 200, 'нийт: ' + total);
    console.log('        16 виджет · нийт ' + total + ' засварлагдах талбар шалгав');
    check('Тест дуусахад өөрчлөлт үлдээгүй', /алга/.test(R.dirty || ''), R.dirty);
  } finally { srv.close(); }
}


/* Firestore-гүй орчинд нийтлэлийн давхаргыг шалгах хуурамч модуль.
   Жинхэнэ js/erthub-publish.js-ийн ГЭРЭЭ (load/publish/canPublish/enabled)
   яг ижил — index.html-ийн холболт зөв эсэхийг шалгана. */
const STUB_NONE = 'window.EHPublish={enabled:true,load:function(){return Promise.resolve(null)},'+
  'publish:function(){return Promise.reject(new Error("stub"))},canPublish:function(){return Promise.resolve(false)}};';

function stubWith(patch) {
  return 'window.EHPublish={enabled:true,canPublish:function(){return Promise.resolve(false)},'+
    'publish:function(){return Promise.reject(new Error("stub"))},'+
    'load:function(){return fetch("content.json?s=1",{cache:"no-store"}).then(function(r){return r.json()})'+
    '.then(function(j){ (' + patch + ')(j); return {content:j,registry:null,meta:{at:"2026-09-03T00:00:00Z",by:"test"}} })}};';
}
const STUB_SOME = stubWith('function(j){ j.widgets.ls.title="ПУБ-ГАРЧИГ"; j.site.nav.home="ПУБ-НҮҮР" }');

/* Нүүр хуудсанд ямар текст гарсныг уншина */
const SITE_PROBE = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(5000);
  const q=s=>{const e=d.querySelector(s); return e?e.textContent.trim():null};
  return { ls:q('[data-eh-card="ls"][data-eh-field="title"]'),
           nav:(function(){var b=[].slice.call(d.querySelectorAll('button,a'))
                 .filter(function(x){return /^(Нүүр|ПУБ-НҮҮР)$/.test(x.textContent.trim())})[0];
                 return b?b.textContent.trim():null})() };
}`;

/* ══════════════════════════════════════════════════════════════════
   G. САЙТАД НИЙТЛЭХ ДАВХАРГА (Firestore overlay)

   Админ ФАЙЛ РУУ бичдэггүй тул засвар нь өмнө нь Экспортлох → гар
   хуулалт → commit хийж байж сайтад гардаг байв. Одоо "Сайтад нийтлэх"
   нь content.json/metric_registry.json-ий ДЭЭР давхарлагдах баримтыг
   Firestore-т бичдэг. Энэ бүлэг Firestore-гүйгээр (эх модулийг санах
   ойн хуурамч хувилбараар орлуулж) хоёр зүйлийг шалгана:
     G1. Нийтлэл БАЙХГҮЙ / уншигдахгүй үед сайт ФАЙЛААРАА ажиллана
         (нийтлэл бол НЭМЭЛТ давхарга, шаардлага биш)
     G2. Нийтлэл БАЙВАЛ сайт түүнийг файлын дээр давхарлан харуулна
   ══════════════════════════════════════════════════════════════════ */
async function groupG() {
  group('G. Сайтад нийтлэх давхарга (Firestore overlay)');
  if (!CHROME) { skipped('G бүлэг бүхэлдээ', 'Chrome олдсонгүй'); return; }

  /* Статик шалгалт — холбоос бүрэн эсэх */
  const idx = read('index.html'), adm = read('admin/index.html'), pub = read('js/erthub-publish.js');
  check('index.html нийтлэлийн модулийг ачаална',
    idx.includes('js/erthub-publish.js') && idx.includes('loadPublished()'));
  check('admin нийтлэх товч ба модультай', adm.includes('erthub-publish.js') &&
    adm.includes("id=\"pubBtn\"") && adm.includes('EHPublish.publish('));
  check('Нийтлэл JSON-г МӨРӨӨР хадгална (массив доторх массивын хязгаар)',
    pub.includes('stringValue: JSON.stringify(content)'));
  check('firestore.rules-д site_content ба admins зам бүртгэгдсэн',
    read('firestore.rules').includes('match /site_content/{docId}') &&
    read('firestore.rules').includes('match /admins/{uid}'));
  check('Нийтлэх эрхийг admins/{uid} баримтаар шийднэ (жагсаалт хатуу биш)',
    read('firestore.rules').includes('documents/admins/$(request.auth.uid)'));

  const srv = serve();
  try {
    /* ── G1. Нийтлэлгүй үед файлын утга үлдэнэ ── */
    const base = readJson('content.json').widgets.ls.title;
    PROBE_SRC = '/index.html';
    SERVE_OVERRIDE = { '/js/erthub-publish.js': STUB_NONE };
    const r1 = await runProbe(SITE_PROBE, 120000);
    if (r1.__err) { bad('G1 ачаалалт', r1.__err); }
    else check('G1. Нийтлэлгүй үед сайт файлын текстээ хэвээр харуулна',
      r1.ls === base, 'олдсон: ' + r1.ls + ' (хүлээсэн: ' + base + ')');

    /* ── G2. Нийтлэл байвал давхарлана ── */
    SERVE_OVERRIDE = { '/js/erthub-publish.js': STUB_SOME };
    const r2 = await runProbe(SITE_PROBE, 120000);
    if (r2.__err) { bad('G2 ачаалалт', r2.__err); }
    else {
      check('G2. Нийтлэгдсэн гарчиг сайтад давхарлагдана',
        r2.ls === 'ПУБ-ГАРЧИГ', 'олдсон: ' + r2.ls);
      check('G2. Нийтлэгдсэн site{} текст ч давхарлагдана',
        r2.nav === 'ПУБ-НҮҮР', 'олдсон: ' + r2.nav);
    }
  } finally {
    SERVE_OVERRIDE = null;
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* ══════════════════════════════════════════════════════════════════
   H. ДАТА ХОЛБОЛТ ТАБ (metric_registry.json → metrics{})

   Өмнө нь metrics{}-ийн МЕТАДАТА (unit/quality/filter/period_note/
   would_need) ЗӨВХӨН хөгжүүлэгч гар аргаар JSON бичиж удирддаг байсан.
   Энэ бүлэг шинэ "Дата холболт" табыг шалгана:
     H1. Таб нээгдэж, REG.metrics-ийн тоотой тэнцүү карт зурагдана
     H2. source/dataset/column ЗАСВАРЛАХ input/textarea ҮҮСГЭХГҮЙ
     H3. Метадата талбар засварлахад dirty badge нэмэгдэж, экспортын
         JSON-д тусна
     H4. Шинэ "төлөвлөгөө" метрик нэмэхэд quality:'mock'-оор эхэлнэ
   ══════════════════════════════════════════════════════════════════ */
const PROBE_H = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(3500);
  const R={};
  const tab=[...d.querySelectorAll('[data-tab="metrics"]')][0];
  if(!tab) return {__err:'metrics таб товч олдсонгүй'};
  tab.click(); await sleep(600);
  R.cards=d.querySelectorAll('[data-metric]').length;
  R.roCount=d.querySelectorAll('[data-mf$="|source"],[data-mf$="|dataset"],[data-mf$="|column"]').length;
  // H5 — "ашиглагдаж буй" жагсаалт ВИДЖЕТИЙН ЖИНХЭНЭ ГАРЧИГ харуулна (raw id биш)
  const wpCard=d.querySelector('[data-metric="air.weekly_pax"]');
  if(wpCard){
    const btns=[...wpCard.querySelectorAll('[data-mgoto]')];
    R.usedByTitle=btns.some(b=>b.textContent.trim()==='Долоо хоногийн нийт зорчигч тээвэр');
    R.usedByRawId=btns.some(b=>b.textContent.trim()==='w2p');
  }
  // H6 — гарчиг МОНГОЛ НЭРЭЭР (raw key биш), техникийн мэдээлэл анхнаасаа хаалттай <details>
  const fuCard=d.querySelector('[data-metric="air.feed_updated_at"]');
  if(fuCard){
    const h3=fuCard.querySelector('h3');
    R.headingHasName=!!h3&&/Дата сүүлд шинэчлэгдсэн огноо/.test(h3.textContent);
    R.headingHasRawKey=!!h3&&h3.textContent.indexOf('air.feed_updated_at')>=0;
    const det=fuCard.querySelector('details');
    R.detailsClosed=!!det&&!det.open;
    R.detailsHasSource=!!det&&/flightsMeta/.test(det.textContent);
  }
  // H3 — метадата талбар засвар: dirty болж, экспортод тусна
  const unitInp=d.querySelector('[data-mf$="|unit"]');
  R.hasUnitField=!!unitInp;
  if(unitInp){
    const mk=unitInp.getAttribute('data-mf').split('|')[0];
    unitInp.value='ШАЛГАЛТЫН НЭГЖ';
    unitInp.dispatchEvent(new w.Event('input',{bubbles:true}));
    await sleep(250);
    R.editedKey=mk;
    R.dirtyAfterEdit=d.getElementById('metricsN').textContent;
    R.rowDirty=!!unitInp.closest('.mfield').classList.contains('dirty');
  }
  // H4 — шинэ метрик нэмэх, quality mock-оор эхэлнэ
  const kIn=d.getElementById('mNewKey'), wnIn=d.getElementById('mNewWn'), add=d.querySelector('[data-madd]');
  if(kIn&&wnIn&&add){
    kIn.value='test.probe_metric'; kIn.dispatchEvent(new w.Event('input',{bubbles:true}));
    wnIn.value='H4 туршилт'; wnIn.dispatchEvent(new w.Event('input',{bubbles:true}));
    add.click(); await sleep(500);
    R.cardsAfterAdd=d.querySelectorAll('[data-metric]').length;
    const newCard=d.querySelector('[data-metric="test.probe_metric"]');
    R.newCardMock=!!newCard&&/Түр дата/.test(newCard.querySelector('.badge').textContent);
  }
  // Экспорт — эдитэд болон шинэ метрик хоёулаа JSON-д тусна
  let cap=null;
  const oc=w.URL.createObjectURL.bind(w.URL);
  w.URL.createObjectURL=function(b){const r=new w.FileReader();
    r.onload=()=>{cap=r.result}; r.readAsText(b); return oc(b)};
  const ex=d.getElementById('expBtn');
  R.exportEnabled=!!(ex&&!ex.disabled);
  if(R.exportEnabled){ex.click(); for(let i=0;i<25&&!cap;i++) await sleep(200);}
  if(cap){ try{ const j=JSON.parse(cap);
    /* Зөвхөн metrics{} өөрчлөгдсөн (виджет/сайт текст хөндөгдөөгүй) тул
       "Экспортлох" ЗӨВХӨН metric_registry.json-г л татна — j нь шууд
       registry обьект (j.metrics), {registry:...} гэж боолгогдоогүй. */
    R.expHasNew=!!(j.metrics&&j.metrics['test.probe_metric']&&
      j.metrics['test.probe_metric'].quality==='mock');
    R.expHasEdit=!!(j.metrics&&R.editedKey&&
      j.metrics[R.editedKey]&&j.metrics[R.editedKey].unit==='ШАЛГАЛТЫН НЭГЖ');
  }catch(e){ R.expErr=String(e) } }
  return R;
}`;
async function groupH() {
  group('H. Дата холболт таб (metric_registry.json → metrics{})');
  if (!CHROME) { skipped('H бүлэг бүхэлдээ', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const reg = readJson('metric_registry.json');
    const metricCount = Object.keys(reg.metrics || {}).length;
    const R = await runProbe(PROBE_H, 90000);
    if (R.__err) { bad('H бүлэг ажиллав', R.__err); return; }
    check('H1. Таб нээгдэж REG.metrics-ийн тоотой тэнцүү карт зурагдана',
      R.cards === metricCount, 'карт: ' + R.cards + ' (хүлээсэн: ' + metricCount + ')');
    check('H2. source/dataset/column ЗАСВАРЛАХ input/textarea ҮҮСГЭХГҮЙ',
      R.roCount === 0, 'олдсон: ' + R.roCount);
    check('H3. Метадата талбар засварлахад dirty тэмдэглэгдэнэ',
      R.hasUnitField === true && R.rowDirty === true, JSON.stringify({hasUnitField:R.hasUnitField,rowDirty:R.rowDirty}));
    check('H3. Экспортын JSON-д засвар тусна',
      R.expHasEdit === true, JSON.stringify({expHasEdit:R.expHasEdit,expErr:R.expErr}));
    check('H4. Шинэ метрик нэмэхэд карт нэг нэмэгдэж, quality:mock-оор эхэлнэ',
      R.cardsAfterAdd === metricCount + 1 && R.newCardMock === true,
      'cardsAfterAdd: ' + R.cardsAfterAdd + ', newCardMock: ' + R.newCardMock);
    check('H4. Экспортын JSON-д шинэ метрик тусна',
      R.expHasNew === true, JSON.stringify({expHasNew:R.expHasNew,expErr:R.expErr}));
    check('H5. "Ашиглагдаж буй" жагсаалт виджетийн ЖИНХЭНЭ гарчиг харуулна (raw id биш)',
      R.usedByTitle === true && R.usedByRawId === false,
      JSON.stringify({usedByTitle:R.usedByTitle,usedByRawId:R.usedByRawId}));
    check('H6. Картын гарчиг МОНГОЛ нэрээр (raw key дэд мэдээлэл болно)',
      R.headingHasName === true && R.headingHasRawKey === false,
      JSON.stringify({headingHasName:R.headingHasName,headingHasRawKey:R.headingHasRawKey}));
    check('H6. Техникийн мэдээлэл (эх сурвалж/датасэт) анхнаасаа хаалттай <details>-д',
      R.detailsClosed === true && R.detailsHasSource === true,
      JSON.stringify({detailsClosed:R.detailsClosed,detailsHasSource:R.detailsHasSource}));
  } finally { srv.close(); }
}

/* ══════════════════════════════════════════════════════════════════
   I. ЧАРТ БҮТЭЭГЧ (js/erthub-chart.js — Tableau маягийн X/Y + нэгтгэл)

   Админ КОД БИЧИХГҮЙГЭЭР чартын X тэнхлэг (бүлэглэх талбар), Y тэнхлэг
   (нэгтгэх талбар), нэгтгэлийн төрлийг сонгоно. Хөдөлгүүр нь сайт ба
   admin ХОЁУЛАНД ижил байх ёстой тул дундын модульд байрлана.
     I1. Нэгтгэл (SUM/COUNT/AVG/MIN/MAX) БОДИТООР зөв тоо гаргана
     I2. Буруу/дутуу тохиргоо → null (сайт өмнөх зан төлөв рүү унана)
     I3. Тохиргоогүй үед САЙТ өмнөх хатуу чартаа зурна (регресс хамгаалалт)
     I4. Admin-д X/Y/нэгтгэл сонгоход preview ЖИНХЭНЭ датагаар зурагдана
   ══════════════════════════════════════════════════════════════════ */
/* I5 — Админ дээрх ЖИНХЭНЭ гүйлгээ: хэмжигдэхүүн сольсон ДАРУЙД зүүн
   талын preview ӨӨРЧЛӨГДӨХ ёстой. Өмнө нь preview нь холбогдсон
   метрикийн утгыг (нислэгийн тоо) ХАТУУ уншдаг байсан тул админ
   сольсон хэрнээ "юу ч өөрчлөгдөхгүй" харагддаг байв — энэ тест тэр
   регрессийг барина. */
const PROBE_I = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(4000);
  const R={};
  const sec=d.querySelector('[data-section="sec-01"]');
  if(!sec) return {__err:'sec-01 олдсонгүй'};
  sec.click(); await sleep(700);
  const wgt=d.querySelector('[data-widget="ls"]')||d.querySelector('[data-goedit^="ls|"]');
  if(!wgt) return {__err:'ls виджет олдсонгүй'};
  wgt.click(); await sleep(1000);
  const val=()=>{const e=d.querySelector('#pvhost .pvsc .v'); return e?e.textContent.trim():null};
  const spark=()=>{const p=d.querySelector('#pvhost .pvsc .sp path,#pvhost .pvsc .sp line');
    return p?(p.getAttribute('d')||'flat'):null};
  R.hasFieldGroup=!!d.querySelector('[data-slot^="ls|"] optgroup');
  R.before=val(); R.sparkBefore=spark();
  const pick=(v)=>{const el=d.querySelector('[data-slot^="ls|sectors,air"]');
    if(!el) return false; el.value=v; el.dispatchEvent(new w.Event('change',{bubbles:true})); return true};
  pick('field:Зорчигч|SUM'); await sleep(1200);
  R.after=val(); R.sparkAfter=spark();
  R.dirtyAfter=(d.getElementById('dirtyMsg')||{}).textContent||'';
  pick('air.flight_count_last_month'); await sleep(1200);
  R.reverted=val();
  R.dirtyReverted=(d.getElementById('dirtyMsg')||{}).textContent||'';
  return R;
}`;
/* I6 — БҮХ виджетийг цувралаар шалгана. Өмнө нь зөвхөн `ls`-ийг шалгаж
   "болсон" гэж дүгнэсэн тул бусад виджет дээр утга солих боломжгүй
   байсныг тест ОГТ бариагүй. Энэ тест тэр цоорхойг хаана: слоттой
   виджет БҮРД "датаны талбараас" сонголт байх ба сонгоход preview
   ӨӨРЧЛӨГДӨХ ёстой. */
const PROBE_I6 = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(4000);
  const SEC={hero_fl:'hero',hero_px:'hero',uk:'portal-kpi',ls:'sec-01',
    w2p:'sec-02',w2pb:'sec-02',w2px:'sec-02',w2c:'sec-02',w2cb:'sec-02',
    w2cx:'sec-02',k04:'sec-04',t05:'sec-05',d05:'sec-05',i06:'sec-06',
    r06:'sec-06',u07:'sec-07'};
  const norm=t=>(t||'').replace(/[\s\u00a0]+/g,' ').trim();
  /* Текст ГАНЦААРАА хангалтгүй: шугаман график дээр сарын шошго ижил
     хэвээр үлдэж, зөвхөн МУРУЙ өөрчлөгддөг. Иймд F бүлгийн адил
     геометрийг (path/rect/өргөн) ч хамт харьцуулна. */
  const geo=()=>[].slice.call(d.querySelectorAll('#pvhost path,#pvhost rect,#pvhost circle,#pvhost .pvrk i,#pvhost .pvsc .v,#pvhost .pvgc .v,#pvhost .pvrow b,#pvhost .pvticker .v'))
    .map(function(e){return (e.getAttribute('d')||e.getAttribute('height')||e.getAttribute('style')||e.textContent||'')}).join('|');
  const pv=()=>{var e=d.getElementById('pvhost');return norm(e?e.innerText:'')+'##'+geo()};
  const rows=[];
  for(const id of Object.keys(SEC)){
    let b,n=0; while((b=d.querySelector('[data-back]'))&&n++<6) b.click();
    await sleep(280);
    const s=d.querySelector('[data-section="'+SEC[id]+'"]'); if(!s){rows.push({id:id,nav:false});continue}
    s.click(); await sleep(320);
    const c=d.querySelector('[data-widget="'+id+'"]'); if(!c){rows.push({id:id,nav:false});continue}
    c.click(); await sleep(600);
    const row={id:id,nav:true};
    const sel=d.querySelector('[data-slot^="'+id+'|sectors,air"]')||d.querySelector('[data-slot^="'+id+'|"]');
    row.hasSlot=!!sel;
    if(!sel){ rows.push(row); continue }
    const og=sel.querySelector('optgroup');
    row.hasFieldGroup=!!og;
    if(og){
      const before=pv();
      /* Эхний сонголт нь "бичлэг тоолох (COUNT)" — t05/i06-д энэ нь яг
         одоогийн метриктэй (нислэгийн тоо) ИЖИЛ үр дүн өгдөг тул
         өөрчлөлт гарахгүй нь ЗӨВ. Иймд ХЭМЖИГДЭХҮҮНТЭЙ сонголт авна. */
      const opts=[].slice.call(og.querySelectorAll('option'));
      const opt=opts.filter(function(o){return o.value.indexOf('field:|')!==0})[0]||opts[0];
      sel.value=opt.value; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
      await sleep(900);
      row.changed=pv()!==before;
      row.sample=opt.value;
    }
    rows.push(row);
  }
  return {rows:rows};
}`;
async function groupI3() {
  if (!CHROME) { skipped('I6. Бүх виджет (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(PROBE_I6, 200000);
    if (R.__err) { bad('I6. Бүх виджетийн шалгалт ажиллав', R.__err); return; }
    const rows = R.rows || [];
    check('I6. 16 виджет бүгд нээгдэнэ', rows.length === 16 && rows.every((r) => r.nav !== false),
      'нээгдээгүй: ' + rows.filter((r) => r.nav === false).map((r) => r.id).join(', '));
    /* Утга солих боломжтой виджетүүдийн жагсаалт админы эх кодоос —
       hero_px (нийтийн тээвэр, мөр түвшний дата алга) ба u07 (зөвхөн
       датасэтийн шинэчлэлт харуулдаг) энд ОРОХГҮЙ нь ЗӨВ. */
    const admSrc = read('admin/index.html');
    const vtBlock = admSrc.slice(admSrc.indexOf('var VALUE_TARGETS='), admSrc.indexOf('};', admSrc.indexOf('var VALUE_TARGETS=')));
    const targets = (vtBlock.match(/([a-z0-9_]+)s*:s*'air_flights'/g) || []).map((m) => m.split(':')[0].trim());
    check('I6. Утга солих виджетүүд бүртгэгдсэн (hero_px/u07 ЗОРИУД гадна)',
      targets.length >= 10 && targets.indexOf('hero_px') < 0 && targets.indexOf('u07') < 0,
      targets.join(','));
    const withSlot = rows.filter((r) => r.hasSlot && targets.indexOf(r.id) >= 0);
    const noGroup = withSlot.filter((r) => !r.hasFieldGroup).map((r) => r.id);
    check('I6. Бүртгэгдсэн виджет БҮРД "датаны талбараас" сонголт байна',
      noGroup.length === 0, 'дутуу: ' + noGroup.join(', '));
    const notChanged = withSlot.filter((r) => r.hasFieldGroup && r.changed === false).map((r) => r.id);
    check('I6. Талбар сонгоход виджет БҮРИЙН preview өөрчлөгдөнө',
      notChanged.length === 0, 'өөрчлөгдөөгүй: ' + notChanged.join(', '));
    console.log('        ' + withSlot.length + ' слоттой виджет · ' +
      withSlot.filter((r) => r.hasFieldGroup).length + ' талбар сонголттой');
  } finally { srv.close(); }
}

/* I7 — Хэрэглэгчийн детэйл шаардлагууд (нэг бүрчлэн):
     · Гарчгийн эх сурвалж ГАНЦ: автомат нэрийг САНАЛ болгож, нэг
       товшилтоор ЗӨВХӨН тэр талбарт тавина (давхар эх сурвалж үүсгэхгүй)
     · Талбар дээр очиход preview-ийн ТУХАЙН хэсэг тодорно
     · График дээр очиход тоон утга гарна (сайт БА админ хоёулаа) */
const PROBE_I7 = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(4000);
  const R={};
  d.querySelector('[data-section="sec-02"]').click(); await sleep(600);
  d.querySelector('[data-widget="w2pb"]').click(); await sleep(900);
  const sel=d.querySelector('[data-slot^="w2pb|"]');
  const og=sel?sel.querySelector('optgroup'):null;
  if(!og) return {__err:'талбарын бүлэг олдсонгүй'};
  const opt=[].slice.call(og.querySelectorAll('option'))
    .filter(function(o){return o.value.indexOf('field:|')!==0})[0];
  sel.value=opt.value; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  await sleep(1100);
  /* 1) Автомат нэрийн САНАЛ гарах ба гарчгийн талбар ХАРААХАН хэвээр */
  const btn=d.querySelector('[data-autoname]');
  R.hasSuggestion=!!btn;
  const pvT=()=>{const e=d.querySelector('#pvhost [data-ed="title"]');return e?e.textContent.trim():null};
  R.titleBefore=pvT();
  R.fieldBefore=(d.querySelector('[data-tf="title"]')||{}).value;
  if(btn){ btn.click(); await sleep(700); }
  R.titleAfter=pvT();
  R.fieldAfter=(d.querySelector('[data-tf="title"]')||{}).value;
  /* 2) Талбар дээр очиход preview тодрох */
  const sl=d.querySelector('[data-slot^="w2pb|"]');
  sl.dispatchEvent(new w.FocusEvent('focusin',{bubbles:true}));
  await sleep(400);
  R.hlOnSlot=d.querySelectorAll('#pvhost .pvhl,#pvhost .ed.hl').length;
  const ti=d.querySelector('[data-tf="title"]');
  ti.dispatchEvent(new w.FocusEvent('focusin',{bubbles:true}));
  await sleep(400);
  R.hlOnTitle=!!d.querySelector('#pvhost [data-ed="title"].hl');
  /* 3) Админы preview-ийн график дээр тоон утга (SVG <title>) */
  let b,n=0; while((b=d.querySelector('[data-back]'))&&n++<6) b.click();
  await sleep(300);
  d.querySelector('[data-section="sec-05"]').click(); await sleep(400);
  d.querySelector('[data-widget="t05"]').click(); await sleep(900);
  R.adminChartTips=d.querySelectorAll('#pvhost svg title').length;
  return R;
}`;
async function groupI4() {
  if (!CHROME) { skipped('I7. Детэйл шалгалт (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(PROBE_I7, 120000);
    if (R.__err) { bad('I7. Детэйл шалгалт ажиллав', R.__err); return; }
    check('I7. Утга сольсны дараа гарчгийн САНАЛ гарна', R.hasSuggestion === true);
    check('I7. Санал нь гарчгийг ӨӨРӨӨ дарж бичихгүй (ганц эх сурвалж)',
      R.titleBefore === R.fieldBefore,
      JSON.stringify({ preview: R.titleBefore, field: R.fieldBefore }));
    check('I7. "Тавих" дархад гарчиг ба preview ХАМТ шинэчлэгдэнэ',
      !!R.titleAfter && R.titleAfter === R.fieldAfter && R.titleAfter !== R.titleBefore,
      JSON.stringify({ after: R.titleAfter, field: R.fieldAfter }));
    check('I7. Слот дээр очиход preview-ийн тухайн хэсэг тодорно', R.hlOnSlot > 0, 'тодорсон: ' + R.hlOnSlot);
    check('I7. Гарчгийн талбар дээр очиход preview-ийн гарчиг тодорно', R.hlOnTitle === true);
    check('I7. Админы preview-ийн график дээр тоон утга гарна (SVG title)',
      R.adminChartTips > 0, 'олдсон: ' + R.adminChartTips);
  } finally { srv.close(); }
}

async function groupI2() {
  if (!CHROME) { skipped('I5. Админ preview (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(PROBE_I, 90000);
    if (R.__err) { bad('I5. Админ preview шалгалт ажиллав', R.__err); return; }
    check('I5. Слотын сонголтод "датаны талбараас" бүлэг гарна', R.hasFieldGroup === true);
    check('I5. Хэмжигдэхүүн сольсон ДАРУЙД preview-ийн ТОО өөрчлөгдөнө',
      !!R.before && !!R.after && R.before !== R.after,
      JSON.stringify({ before: R.before, after: R.after }));
    check('I5. Spark line ч сонгосон хэмжигдэхүүнээ дагана',
      !!R.sparkAfter && R.sparkBefore !== R.sparkAfter, 'муруй өөрчлөгдсөнгүй');
    check('I5. Тохиргоо dirty болж экспортод орно', /өөрчлөлт/.test(R.dirtyAfter), R.dirtyAfter.trim());
    check('I5. Бүртгэлтэй метрик рүү буцаавал анхны утга сэргэнэ',
      R.reverted === R.before && /алга/.test(R.dirtyReverted),
      JSON.stringify({ reverted: R.reverted, before: R.before, dirty: R.dirtyReverted.trim() }));
  } finally { srv.close(); }
}

function groupI() {
  group('I. Чарт бүтээгч (EHChart — X/Y тэнхлэг + нэгтгэл)');
  const src = read('js/erthub-chart.js');
  const sandbox = { window: {} };
  try { new Function('window', src)(sandbox.window); }
  catch (e) { bad('I. модуль ачаалагдав', e.message); return; }
  const E = sandbox.window.EHChart;
  if (!E) { bad('I. EHChart экспортлогдов', 'window.EHChart алга'); return; }

  check('I1. Талбарын каталог dimension/measure болж хуваагдана',
    E.dims('air_flights').length > 10 && E.measures('air_flights').length > 5,
    'dim: ' + E.dims('air_flights').length + ', measure: ' + E.measures('air_flights').length);

  /* Гараар бодох боломжтой ЖИЖИГ фикстур — нэгтгэл бүрийн хариу ТОДОРХОЙ */
  const rows = [
    { carr: 'A', pax: 10, year: 2026, month: 1, day: 1 },
    { carr: 'A', pax: 30, year: 2026, month: 1, day: 2 },
    { carr: 'B', pax: 5, year: 2026, month: 2, day: 1 }
  ];
  const at = (r, lb) => r.values[r.labels.indexOf(lb)];
  const sum = E.agg(rows, { dim: 'Компани', measure: 'Зорчигч', agg: 'SUM' });
  check('I1. SUM зөв (A=40, B=5)', at(sum, 'A') === 40 && at(sum, 'B') === 5, JSON.stringify(sum));
  const cnt = E.agg(rows, { dim: 'Компани', agg: 'COUNT' });
  check('I1. COUNT зөв (A=2, B=1)', at(cnt, 'A') === 2 && at(cnt, 'B') === 1, JSON.stringify(cnt));
  const avg = E.agg(rows, { dim: 'Компани', measure: 'Зорчигч', agg: 'AVG' });
  check('I1. AVG зөв (A=20)', at(avg, 'A') === 20, JSON.stringify(avg));
  const mn = E.agg(rows, { dim: 'Компани', measure: 'Зорчигч', agg: 'MIN' });
  const mx = E.agg(rows, { dim: 'Компани', measure: 'Зорчигч', agg: 'MAX' });
  check('I1. MIN/MAX зөв (A: 10 / 30)', at(mn, 'A') === 10 && at(mx, 'A') === 30,
    JSON.stringify({ min: mn.values, max: mx.values }));
  const top = E.agg(rows, { dim: 'Компани', measure: 'Зорчигч', agg: 'SUM', topN: 1 });
  check('I1. topN тайрна, эрэмбэ ихээс бага', top.n === 1 && top.labels[0] === 'A', JSON.stringify(top));

  check('I2. Буруу талбар → null', E.validate({ dim: 'БАЙХГҮЙ', measure: 'Зорчигч', agg: 'SUM' }) === null);
  check('I2. Буруу нэгтгэл → null', E.validate({ dim: 'Компани', measure: 'Зорчигч', agg: 'MEDIAN' }) === null);
  check('I2. Хоосон мөр → ТОО ЗОХИОХГҮЙ (хоосон цуваа)',
    E.agg([], { dim: 'Компани', measure: 'Зорчигч', agg: 'SUM' }).n === 0);
  check('I2. Гарчиг тохиргооноос автоматаар гарна',
    E.describe({ dim: 'Компани', measure: 'Зорчигч', agg: 'SUM' }) === 'Компани · Зорчигч (нийлбэр)',
    E.describe({ dim: 'Компани', measure: 'Зорчигч', agg: 'SUM' }));

  /* Сайт талын холболт — тохиргоогүй бол ӨМНӨХ хатуу зан төлөв */
  const idx = read('index.html');
  check('I3. Сайт тохиргоогүй үед хуучин чарт руу унана (fallback)',
    /chartFromSpec\('ds_air_monthly'\)\|\|\s*buildDualAxisChart\(sAir\.monthly\.pax/.test(idx.replace(/\n\s*/g, ' ')),
    'fallback хэлбэр олдсонгүй');
  check('I3. Чарт нь ХУУДАСНЫ ШҮҮЛТЭД орсон мөрүүд дээр ажиллана',
    idx.includes('this._airFilteredRows=filtered'));
  check('I3. index.html ба admin ХОЁУЛАА нэг модулиас уншина',
    idx.includes('js/erthub-chart.js') && read('admin/index.html').includes('js/erthub-chart.js'));

  /* ── I4. ВИДЖЕТИЙН УТГА СОЛИХ (загвар хэвээр, утга солигдоно) ── */
  const many = [];
  for (let m = 1; m <= 4; m++) for (let i = 0; i < 3; i++)
    many.push({ carr: 'A', pax: m * 10, cargoKg: 5, year: 2026, month: m, day: 1 });
  const v = E.value(many, { measure: 'Зорчигч', agg: 'SUM' });
  check('I4. Утга нь нийт нийлбэрийг зөв гаргана (10+20+30+40)*3 = 300',
    v && v.raw === 300, JSON.stringify(v && { raw: v.raw, unit: v.unit }));
  check('I4. Нэгжийн шошго хэмжигдэхүүнээ ДАГАНА (Зорчигч → хүн)',
    v.unit === 'хүн', v.unit);
  check('I4. Метрикийн НЭР ч хэмжигдэхүүнээ дагана (ЗОРЧИГЧ)',
    v.label === 'ЗОРЧИГЧ', v.label);
  check('I4. Spark line-д сар тутмын БОДИТ цуваа гарна (зохиомол биш)',
    v.n === 4 && v.series.join(',') === '30,60,90,120', JSON.stringify(v.series));
  check('I4. "Сар" цаг хугацааны дарааллаар эрэмбэлэгдэнэ (10-р сар < 2-р сар БИШ)',
    v.labels[0] === '1-р сар' && v.labels[3] === '4-р сар', JSON.stringify(v.labels));
  check('I4. Өөрчлөлтийн хувь СОНГОСОН хэмжигдэхүүнээс тооцогдоно',
    v.delta === '+50.0%' && v.dir === 'up', JSON.stringify({ delta: v.delta, dir: v.dir }));
  const vc = E.value(many, { agg: 'COUNT' });
  check('I4. COUNT үед нэгжгүй, нэр нь "НИЙТ БИЧЛЭГ"',
    vc.raw === 12 && vc.unit === '' && vc.label === 'НИЙТ БИЧЛЭГ', JSON.stringify(vc && vc.raw));
  check('I4. Тохиргоогүй/хоосон мөр → null (тоо ЗОХИОХГҮЙ)',
    E.value(many, null) === null && E.value([], { measure: 'Зорчигч', agg: 'SUM' }) === null);
  check('I4. Сайт нь виджетийн утгыг тохиргооноос уншина',
    idx.includes('valueFromSpec(\'ls\')') && idx.includes('vs?vs.value:'),
    'livestrip холболт олдсонгүй');
  check('I4. Admin-ы слот сонголтод "датаны талбараас шууд" бүлэг нэмэгдсэн',
    read('admin/index.html').includes("'field:'+c[0]") &&
    read('admin/index.html').includes('metric.from_field'), 'optgroup олдсонгүй');
}

/* ══════════════════════════════════════════════════════════════════
   J. PREVIEW ↔ САЙТ ПАРИТЕТ (архитектурын гол хамгаалалт)

   Энэ төслийн ХАМГИЙН ОЛОН давтагдсан алдааны төрөл: админы preview
   зөв мөртөө сайт буруу (эсвэл эсрэгээр). Шалтгаан нь тоог хоёр тал
   ТУС ТУСДАА бодож байсан явдал. Одоо хоёулаа js/erthub-chart.js-ийн
   ЯГ НЭГ функцээс (EHChart.value) уншдаг — энэ тест тэр гэрээг барина:
   ижил тохиргоо → ижил тоо.
   ══════════════════════════════════════════════════════════════════ */
async function groupJ() {
  group('J. Preview ↔ сайт паритет');
  const src = read('js/erthub-chart.js');
  const sb = { window: {} };
  try { new Function('window', src)(sb.window); } catch (e) { bad('J. модуль ачаалагдав', e.message); return; }
  const E = sb.window.EHChart;

  check('J1. Харуулах тоо МОДУЛЬД нэг удаа тодорхойлогдсон (rounded)',
    typeof E.value === 'function' && 'rounded' in (E.value(
      [{ carr: 'A', pax: 3, year: 2026, month: 1, day: 1 }], { measure: 'Зорчигч', agg: 'SUM' }) || {}),
    'rounded талбар алга');

  /* Хоёр тал ТУС ТУСДАА Math.round хийвэл нэг өдөр салж эхэлнэ — иймд
     эх кодод давхардсан дугуйруулалт үлдээгүйг шалгана. */
  const adm = read('admin/index.html');
  const dupRound = (adm.match(/Math\.round\([A-Za-z0-9_]+\.raw\)/g) || []);
  check('J2. Админ өөрөө дахин дугуйруулахгүй (ганц эх сурвалж)',
    dupRound.length === 0, 'олдсон: ' + dupRound.join(', '));

  /* Хоёр тал ижил модулийг ачаалж байгаа эсэх — өөр өөр хувилбар
     ачаалбал паритет чимээгүй эвдэрнэ. */
  check('J3. index.html ба admin ЯГ НЭГ модуль файл ачаална',
    read('index.html').includes('js/erthub-chart.js') && adm.includes('js/erthub-chart.js'));

  /* Тоон паритет — DOM дээр: ижил тохиргоог өгөөд админы preview ба
     сайтын виджет ЯГ ИЖИЛ тоо үзүүлэх ёстой. */
  if (!CHROME) { skipped('J4. Тоон паритет (DOM)', 'Chrome олдсонгүй'); return; }
  const regPath = path.join(ROOT, 'metric_registry.json');
  const orig = fs.readFileSync(regPath, 'utf8');
  try {
    const reg = JSON.parse(orig);
    reg.widgets.ls = reg.widgets.ls || {};
    reg.widgets.ls.value = { dataset: 'air_flights', measure: 'Зорчигч', agg: 'SUM' };
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n');

    const srv = serve();
    try {
      PROBE_SRC = '/admin/index.html';
      const a = await runProbe(`async function(d,w){
        const sleep=ms=>new Promise(r=>setTimeout(r,ms));
        await sleep(4500);
        d.querySelector('[data-section="sec-01"]').click(); await sleep(600);
        d.querySelector('[data-widget="ls"]').click(); await sleep(1200);
        const e=d.querySelector('#pvhost .pvsc .v');
        return {n:e?e.textContent.trim():null};
      }`, 90000);

      /* Хүлээгдэж буй тоог МОДУЛИАР (сайт ба админ хоёулаа ашигладаг ЯГ
         тэр функц) бодож, админы preview-тэй тулгана. Сайтын хуудсыг
         дахин ачаалж харьцуулах нь сүлжээнээс хамаарч тогтворгүй байсан
         тул ингэж хийв — J2/J3 нь "хоёр тал нэг модулиас, давхардсан
         дугуйруулалтгүй" гэдгийг батлах тул энэ гинж бүрэн хаагдана. */
      let expected = null;
      try {
        const idx = JSON.parse(await httpGet('https://otgonerdene02-cmyk.github.io/veritech-flights-dashboard/flights-index.json'));
        const y = (idx.years || []).map((x) => x.year).sort((p, q) => q - p)[0];
        const rows = JSON.parse(await httpGet('https://otgonerdene02-cmyk.github.io/veritech-flights-dashboard/flights-' + y + '.json')).flights || [];
        const v = E.value(rows, { dataset: 'air_flights', measure: 'Зорчигч', agg: 'SUM' });
        expected = v ? v.value : null;
      } catch (e) { /* сүлжээгүй бол доор SKIP */ }

      if (expected == null) skipped('J4. Preview ↔ модулийн тоон паритет', 'feed уншигдсангүй');
      else check('J4. Админы preview нь МОДУЛИЙН тоог ЯГ хэвээр үзүүлнэ',
        a.n === expected, JSON.stringify({ preview: a.n, expected }));
    } finally { srv.close(); }
  } finally {
    fs.writeFileSync(regPath, orig);   /* тест дуусахад файлыг ЯГ хэвээр нь буцаана */
  }
}

/* ══════════════════════════════════════════════════════════════════
   K. САЛБАРЫГ ВИДЖЕТЭЭС НУУХ (админаас тохируулна)

   Зарим салбар тухайн харьцуулалтад хамааралгүй байдаг (жиш. ачааны
   донут дээр нийтийн тээвэр). Үүнийг КОДООС ХАСАХГҮЙ — админ өөрөө
   асаах/унтраах тохиргоо (widgets.<id>.sectors.<key>.hidden).
     K1. Талбар байхгүй бол ХАРАГДАНА (өмнөх зан төлөв, эрсдэлгүй)
     K2. Админд салбар бүрд нуух товч байна
     K3. Нуухад preview-ээс шууд алга болно, товч буцаах болж солигдоно
     K4. Нуусан нь сайтын виджетэд ч харагдахгүй, харин НАВИГАЦИД хэвээр
   ══════════════════════════════════════════════════════════════════ */
async function groupK() {
  group('K. Салбарыг виджетээс нуух');
  const idx = read('index.html'), adm = read('admin/index.html');

  check('K1. Талбаргүй бол харагдана (hidden===true үед л нууна)',
    /return !!\(s && s\.hidden\)/.test(idx.replace(/\s+/g, ' ')) ||
    idx.includes('return !!(s&&s.hidden)'), 'sectorHidden хэрэгжээгүй');
  check('K1. Донут ба зурвас нь нуултыг ХҮНДЭТГЭНЭ',
    idx.includes("this.visibleSectorKeys('d05')") && idx.includes("this.visibleSectorKeys('ls',keys)"));
  check('K1. Харьцуулалтын мөр ч шүүгдэнэ (w2px/w2cx)',
    idx.includes('!this.sectorHidden(deltaWidgetId,d[0])'));
  check('K1. НАВИГАЦИЙН таб хөндөгдөхгүй (салбар руу орох зам хаагдахгүй)',
    idx.includes('const sectorTabs=keys.map'), 'sectorTabs шүүгдсэн байна — буруу');
  check('K2. Preview нь нуусан салбарыг гаргахгүй',
    adm.includes("!slotVal(id,s.path).hidden"));

  if (!CHROME) { skipped('K3/K4. DOM шалгалт', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(4500);
      d.querySelector('[data-section="sec-05"]').click(); await sleep(600);
      d.querySelector('[data-widget="d05"]').click(); await sleep(1100);
      const rows=()=>[].slice.call(d.querySelectorAll('#pvhost .pvrow'))
        .map(function(r){return r.textContent.trim()});
      const R={};
      R.btnCount=d.querySelectorAll('[data-hide]').length;
      R.before=rows();
      const b=d.querySelector('[data-hide="d05|sectors,public"]');
      R.hasPublicBtn=!!b;
      if(b){ b.click(); await sleep(1000); }
      R.after=rows();
      const b2=d.querySelector('[data-hide="d05|sectors,public"]');
      R.label=b2?b2.textContent.trim():null;
      R.dirty=(d.getElementById('dirtyMsg')||{}).textContent||'';
      return R;
    }`, 90000);
    if (R.__err) { bad('K3. Нуух шалгалт ажиллав', R.__err); return; }
    check('K2. Салбар бүрд нуух товч байна', R.btnCount === 5 && R.hasPublicBtn === true,
      'товч: ' + R.btnCount);
    check('K3. Нуухад preview-ээс ШУУД алга болно',
      R.before.some((x) => /Нийтийн/.test(x)) && !R.after.some((x) => /Нийтийн/.test(x)),
      JSON.stringify({ before: R.before.length, after: R.after.length }));
    check('K3. Товч "буцаах" болж солигдоно', /буцаах/i.test(R.label || ''), R.label);
    check('K3. Тохиргоо dirty болж экспортод орно', /өөрчлөлт/.test(R.dirty), R.dirty.trim());
  } finally { srv.close(); }
}

/* ══════════════════════════════════════════════════════════════════
   L. ДАТАСЭТИЙН КАТАЛОГ (админаас удирдана)

   Хэрэглэгчийн гомдол: "шинээр нэмэгдсэн төмөр замын датасэт нээлттэй
   өгөгдлийн цэсэнд орж ирээгүй". Шалтгаан нь каталог ЗӨВХӨН кодод
   (index.html → DATASETS) байсан явдал. Одоо content.json →
   site.datasets дээр бүртгэгдэж, админаас засаж, НЭМЖ болно.
     L1. Каталог content.json-д бүртгэгдсэн ба сайт түүнийг уншина
     L2. Кодтой холбоотой талбар (dq/source/bind) кодод ҮЛДСЭН
     L3. Порталын "Нээлттэй өгөгдөл" тоо каталогийн уртаас (тоо зохиохгүй)
     L4. Админд карт бүр засварлагдаж, нэмэх/хасах товчтой
     L5. Каталогийн хайлт НЭРЭЭР ажиллана (өмнө нь d.title гэж уншдаг
         байсан тул нэрээр ОГТ олддоггүй байв)
   ══════════════════════════════════════════════════════════════════ */
async function groupL() {
  group('L. Датасэтийн каталог');
  const con = readJson('content.json'), idx = read('index.html'), adm = read('admin/index.html');

  const ds = con.site && con.site.datasets;
  check('L1. Каталог content.json-д бүртгэгдсэн', Array.isArray(ds) && ds.length >= 9,
    'бичлэг: ' + (ds ? ds.length : 0));
  check('L1. Бичлэг бүр нэр ба салбартай',
    Array.isArray(ds) && ds.every((d) => d && typeof d.sector === 'string'),
    'салбаргүй бичлэг байна');
  check('L1. Сайт каталогийг content.json-оос уншина',
    idx.includes('Array.isArray(S.datasets)') && idx.includes('DATASETS[i][k]=d[k]'));

  check('L2. Нотолгоо (dq) ба метрикийн холбоос КОДОД үлдсэн',
    idx.includes('dq:{freqDays:1') && idx.includes("source:'flights'"),
    'dq/source кодоос алга болсон');
  check('L2. content.json-д dq/source/bind ОРООГҮЙ (кодтой холбоотой)',
    Array.isArray(ds) && ds.every((d) => !('dq' in d) && !('source' in d) && !('bind' in d)));

  check('L3. Порталын тоо каталогийн уртаас (тоо ЗОХИОХГҮЙ)',
    idx.includes('KPI_UNIFIED[0][1]=String(DATASETS.length)'));

  check('L4. Админд каталогийн карт, нэмэх/хасах товч байна',
    adm.includes('data-ds-card') && adm.includes('data-ds-add') && adm.includes('data-ds-del'));
  check('L4. Каталог "Дата холболт" табд холбогдсон', adm.includes('lvCharts()+lvDatasets()'));

  check('L5. Каталогийн хайлт НЭРЭЭР ажиллана (d.title БИШ)',
    idx.includes("(d.name||'')+' '+(d.agency||'')") && !idx.includes("d.title+' '+d.desc"),
    'хайлт d.title уншсаар байна');

  if (!CHROME) { skipped('L6. Админ дээр нэмэх (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(4500);
      d.querySelector('[data-tab="metrics"]').click(); await sleep(900);
      const R={};
      R.before=d.querySelectorAll('[data-ds-card]').length;
      const add=d.querySelector('[data-ds-add]'); if(!add) return {__err:'нэмэх товч алга'};
      add.click(); await sleep(800);
      R.after=d.querySelectorAll('[data-ds-card]').length;
      const i=R.after-1;
      const nm=d.querySelector('[data-df="'+i+'|name"]');
      if(nm){ nm.value='ТЕСТ ДАТАСЭТ'; nm.dispatchEvent(new w.Event('input',{bubbles:true})); }
      await sleep(700);
      R.dirty=(d.getElementById('dirtyMsg')||{}).textContent||'';
      const del=d.querySelector('[data-ds-del="'+i+'"]');
      if(del){ del.click(); await sleep(800); }
      R.afterDel=d.querySelectorAll('[data-ds-card]').length;
      return R;
    }`, 90000);
    if (R.__err) { bad('L6. Каталогийн DOM шалгалт', R.__err); return; }
    check('L6. Шинэ датасэт нэмэгдэнэ', R.after === R.before + 1,
      JSON.stringify({ before: R.before, after: R.after }));
    check('L6. Талбар засахад dirty болж экспортод орно', /өөрчлөлт/.test(R.dirty), R.dirty.trim());
    check('L6. Каталогоос хасах ажиллана', R.afterDel === R.before,
      JSON.stringify({ afterDel: R.afterDel, before: R.before }));
  } finally { srv.close(); }
}

/* ══════════════════════════════════════════════════════════════════
   M. ЦАХИМ ҮЙЛЧИЛГЭЭНИЙ КАТАЛОГ (админаас удирдана)

   Хэрэглэгчийн шаардлага: "виджетийн датасэт, ҮЙЛЧИЛГЭЭ зэрэг текстүүд
   засварлах боломжгүй байна". Датасэтийг L бүлэгт шийдсэн — энэ нь
   түүний хосорсон тал: цахим үйлчилгээний жагсаалт.
     M1. Каталог content.json-д бүртгэгдэж, сайт түүнийг уншина
     M2. Хэрэглэгчийн БҮЛЭГ (иргэн/бизнес/тээвэрлэгч) бичлэг ДЭЭРЭЭ —
         нэрээр хайдаг зураглал байхгүй. Нэр солиход бүлэг чимээгүй
         "Иргэнд" рүү унах алдаанаас хамгаална.
     M3. Порталын "Цахим үйлчилгээ" тоо жагсаалтын уртаас — тоо ЗОХИОХГҮЙ
     M4. Админд карт бүр засварлагдаж, нэмэх/хасах товчтой
     M5. Админ дээр нэмэх/засах/хасах бодитоор ажиллана (DOM)
   ══════════════════════════════════════════════════════════════════ */
async function groupM() {
  group('M. Цахим үйлчилгээний каталог');
  const con = readJson('content.json'), idx = read('index.html'), adm = read('admin/index.html');

  const sv = con.site && con.site.services;
  check('M1. Каталог content.json-д бүртгэгдсэн', Array.isArray(sv) && sv.length >= 11,
    'бичлэг: ' + (sv ? sv.length : 0));
  check('M1. Бичлэг бүр нэр ба салбартай',
    Array.isArray(sv) && sv.every((s) => s && typeof s.sector === 'string' && typeof s.name === 'string'),
    'дутуу бичлэг байна');
  check('M1. Сайт каталогийг content.json-оос уншина',
    idx.includes('Array.isArray(S.services)') && idx.includes('SERVICES[i]'));

  check('M2. Бүлэг бичлэг дээрээ (нэрээр хайдаг зураглал УСТСАН)',
    !idx.includes('SERVICE_AUDIENCE'),
    'SERVICE_AUDIENCE хэвээр байна — нэр солиход бүлэг алдагдана');
  check('M2. Бүлгийн утга бичлэгээс уншигдана', idx.includes("aud:s[4]||'citizen'"));
  check('M2. content.json дахь бүлэг зөвхөн 3 утгын нэг',
    Array.isArray(sv) && sv.every((s) => !s.aud || ['citizen', 'business', 'carrier'].includes(s.aud)),
    'танихгүй бүлгийн утга');

  check('M3. Порталын тоо жагсаалтын уртаас (тоо ЗОХИОХГҮЙ)',
    idx.includes('KPI_UNIFIED[1][1]=String(SERVICES.length)'));

  check('M4. Админд үйлчилгээний карт, нэмэх/хасах товч байна',
    adm.includes('data-sv-card') && adm.includes('data-sv-add') && adm.includes('data-sv-del'));
  check('M4. Каталог "Дата холболт" табд холбогдсон', adm.includes('lvDatasets()+lvServices()'));

  /* M6. Хуудасны бусад текст (таб, алхам, тоолуурын үг) ч засварлагдана —
     каталог засварлагдаж мөртөө хажуугийн бичиг код дотор үлдвэл
     "хагас засварлагдах" байдал үүснэ. */
  const es = con.site && con.site.eservices;
  check('M6. Хуудасны таб ба алхам content.json-д бүртгэгдсэн',
    !!es && Array.isArray(es.tabs) && es.tabs.length === 3 &&
    Array.isArray(es.steps) && es.steps.length === 4);
  check('M6. Сайт табыг тогтмолоос уншина (темплейтэд хатуу бичээгүй)',
    idx.includes('this.subNav(SVC_TABS,st') && !idx.includes("[['citizen','Иргэнд'"));
  check('M6. Таб ба алхам content.json-оос давхарлагдана',
    idx.includes('SVC_TABS[i][1]=t.label') && idx.includes('SERVICE_STEPS[i][1]=t.title'));
  check('M6. Тоолуурын үг ба нөхөх текст ч stxt()-ээр',
    idx.includes("stxt('eservices.count_word'") &&
    idx.includes("stxt('eservices.stat_fallback'") &&
    idx.includes("stxt('eservices.featured_stat'"));
  check('M6. Бүлгийн нэр админд ДАВХАРДААГҮЙ (сайтын табнаас уншина)',
    adm.includes('CON.site.eservices.tabs') && !adm.includes('svc_cat.aud_citizen'),
    'админ бүлгийн нэрийг тусад нь хадгалсаар байна');

  /* M8. Хуудасны толгойн тоо. Өмнө нь темплейтэд "11" гэж ХАТУУ бичигдсэн
     тул админ үйлчилгээ нэмэхэд толгойн тоо хуучнаараа үлдэж байв. */
  check('M8. Толгойн тоо ЖАГСААЛТААС гарна (темплейтэд хатуу бичээгүй)',
    idx.includes('total:      String(SERVICES.length)') &&
    idx.includes('{{ svcHero.total }}'));
  check('M8. Эх сурвалжгүй тоо ЗОХИОХГҮЙ — хоосон бол "—"',
    idx.includes("taken:      svcTaken||'—'") &&
    !!(con.site.eservices.hero) && con.site.eservices.hero.taken === '',
    'эх сурвалжгүй тоо хэвээр бичигдсэн байна');
  check('M8. Толгойн текст бүр content.json-оос',
    idx.includes("stxt('eservices.hero.kicker'") &&
    idx.includes("stxt('eservices.hero.lead'") &&
    !idx.includes('>Хэнд ямар <span'));

  /* M7. Сайтын текст табд ui_form-ын НЭРЛЭЛТИЙН бүлэг нь жинхэнэ текстийн
     бүлэгтэй ЯГ ижил гарчигтай гарч, засварлагч аль нь сайт дээр
     харагдахыг ялгаж чаддаггүй байв. */
  check('M7. Нэрлэлтийн бүлгийн гарчиг ялгагдана',
    adm.includes("utxt('site_tab.ufh_suffix'"),
    'ui_form бүлэг жинхэнэ бүлэгтэй ижил гарчигтай хэвээр');

  if (!CHROME) { skipped('M5. Админ дээр нэмэх (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(4500);
      d.querySelector('[data-tab="metrics"]').click(); await sleep(900);
      const R={};
      R.before=d.querySelectorAll('[data-sv-card]').length;
      const add=d.querySelector('[data-sv-add]'); if(!add) return {__err:'нэмэх товч алга'};
      add.click(); await sleep(800);
      R.after=d.querySelectorAll('[data-sv-card]').length;
      const i=R.after-1;
      const nm=d.querySelector('[data-vf="'+i+'|name"]');
      if(nm){ nm.value='ТЕСТ ҮЙЛЧИЛГЭЭ'; nm.dispatchEvent(new w.Event('input',{bubbles:true})); }
      await sleep(700);
      R.dirty=(d.getElementById('dirtyMsg')||{}).textContent||'';
      const del=d.querySelector('[data-sv-del="'+i+'"]');
      if(del){ del.click(); await sleep(800); }
      R.afterDel=d.querySelectorAll('[data-sv-card]').length;
      return R;
    }`, 90000);
    if (R.__err) { bad('M5. Үйлчилгээний DOM шалгалт', R.__err); return; }
    check('M5. Шинэ үйлчилгээ нэмэгдэнэ', R.after === R.before + 1,
      JSON.stringify({ before: R.before, after: R.after }));
    check('M5. Талбар засахад dirty болж экспортод орно', /өөрчлөлт/.test(R.dirty), R.dirty.trim());
    check('M5. Каталогоос хасах ажиллана', R.afterDel === R.before,
      JSON.stringify({ afterDel: R.afterDel, before: R.before }));
  } finally { srv.close(); }
}

/* ══════════════════════════════════════════════════════════════════
   N. КАТАЛОГИЙН МОД · ХАДГАЛАХ МӨР · НУУСАН КАРТЫН ЗАЙ

   Хэрэглэгчийн 3 гомдол:
     (1) "hide хийсэн картын зай шууд хоосон үлдэж байна" — grid-ийн
         багана repeat(5,…) гэж ХАТУУ бичигдсэн тул салбар нуухад
         нүд хоосон үлдэж, үлдсэн нь шахагдахгүй байв.
     (2) "өөрчлөлтийг яаж хадгалах нь ойлгомжгүй" — "Экспортлох" нь
         цэнхэр (гол) товч мэт харагдаж байсан ч тэр нь хөгжүүлэгчийн
         зам. Эцсийн хэрэглэгчийн гол үйлдэл нь "Сайтад нийтлэх".
     (3) "виджет каталогийг ангилах шаардлагатай, шатлалтай байх" —
         зүүн багана зөвхөн ХАВТГАЙ датасэтийн жагсаалт байв.
   ══════════════════════════════════════════════════════════════════ */
async function groupN() {
  group('N. Каталогийн мод ба хадгалах мөр');
  const idx = read('index.html'), adm = read('admin/index.html'), con = readJson('content.json');

  /* ── N1. Нуусан салбарын зай ── */
  check('N1. Grid-ийн багана ХАРАГДАХ мөрийн тооноос',
    idx.includes('repeat({{ lsCols }}') &&
    idx.includes('repeat({{ weekPaxDeltaCols }}') &&
    idx.includes('repeat({{ weekCargoDeltaCols }}'),
    'багана хатуу бичигдсэн хэвээр');
  check('N1. Тоо жагсаалтын уртаас, 0 үед ч grid эвдрэхгүй',
    idx.includes('lsCols:String(Math.max(1,livestrip.length))') &&
    idx.includes('Math.max(1,wPax.delta.length)') &&
    idx.includes('Math.max(1,wCargo.delta.length)'));
  check('N1. repeat(5, … хатуу бичиглэл ҮЛДЭЭГҮЙ',
    !idx.includes('repeat(5,minmax(0,1fr))'),
    'хаа нэгтээ 5 багана хатуу үлдсэн');

  /* ── N2. Хадгалах мөр ── */
  check('N2. "Сайтад нийтлэх" нь ГОЛ товч (Экспортлох биш)',
    adm.includes('<button class="btn pri" id="pubBtn"') &&
    adm.includes('<button class="btn sm" id="expBtn"'),
    'Экспортлох хэвээр гол товч');
  check('N2. Төлөв бүрт дараагийн алхам ил гарна',
    adm.includes('function refreshSaveHint()') &&
    ["save.hint_clean","save.hint_ready","save.hint_login",
     "save.hint_norights","save.hint_off","save.hint_done"]
      .every((k) => adm.includes("utxt('" + k + "'")));
  check('N2. Зааврын текст content.json-д бүртгэгдсэн',
    !!(con.ui && con.ui.save && con.ui.save.hint_ready && con.ui.save.next_step));

  /* ── N3. Каталогийн мод ── */
  check('N3. Дөрвөн өнцөг тодорхойлогдсон',
    adm.includes('function facetDefs()') && adm.includes("['page',") &&
    adm.includes("['data',") && adm.includes("['sector',") && adm.includes("['state',"));
  check('N3. Өнцөг бүрд мод байгуулагчтай',
    ['treePage', 'treeData', 'treeSector', 'treeState']
      .every((f) => adm.includes('function ' + f + '(')));
  check('N3. Хамрах хүрээ сонгосон ЗАНГИЛААНААС гарна',
    adm.includes('function scopeIds()') && adm.includes('findNode(S.node)'),
    'scopeIds хуучнаараа зөвхөн датасэтээс уншиж байна');
  check('N3. Мод дэлгэх ба сонгох тусдаа үйлдэл',
    adm.includes('data-twx') && adm.includes('data-node') && adm.includes('data-facet'));
  check('N3. Өнцгийн нэр/тайлбар content.json-д',
    !!(con.ui && con.ui.cat && con.ui.cat.facet_page && con.ui.cat.note_sector));

  if (!CHROME) { skipped('N4. Каталогийн мод (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(4500);
      const R={};
      R.facets=[...d.querySelectorAll('[data-facet]')].map(b=>b.dataset.facet);
      R.roots={};
      for(const f of ['page','data','sector','state']){
        const b=d.querySelector('[data-facet="'+f+'"]'); if(!b) return {__err:'өнцөг алга: '+f};
        b.click(); await sleep(700);
        R.roots[f]=d.querySelectorAll('[data-node]').length;
      }
      /* Цэсээр — мөчир дэлгэх, зангилаа сонгох, навч дарж засвар нээх */
      d.querySelector('[data-facet="page"]').click(); await sleep(700);
      R.before=d.querySelectorAll('[data-node]').length;
      const x=d.querySelector('[data-twx]'); if(!x) return {__err:'дэлгэх сум алга'};
      x.click(); await sleep(500);
      R.afterExpand=d.querySelectorAll('[data-node]').length;
      const sec=d.querySelector('[data-node^="page:"]'); sec.click(); await sleep(900);
      R.scoped=d.querySelectorAll('[data-cd]').length;
      R.crumb=(d.querySelector('.crumbnav')||{}).textContent||'';
      const leaf=d.querySelector('[data-node^="w:"]');
      if(leaf){ leaf.click(); await sleep(1100) }
      R.editor=!!d.querySelector('[data-tf]');
      R.hint=(d.getElementById('saveHint')||{}).textContent||'';
      return R;
    }`, 90000);
    if (R.__err) { bad('N4. Каталогийн модны DOM шалгалт', R.__err); return; }
    check('N4. Дөрвөн өнцөг зурагдана',
      R.facets.join(',') === 'page,data,sector,state', R.facets.join(','));
    check('N4. Өнцөг бүр зангилаа гаргана',
      ['page', 'data', 'sector', 'state'].every((f) => R.roots[f] > 0),
      JSON.stringify(R.roots));
    check('N4. Мөчир дэлгэхэд дэд зангилаа нэмэгдэнэ', R.afterExpand > R.before,
      JSON.stringify({ before: R.before, after: R.afterExpand }));
    check('N4. Зангилаа сонгоход хамрах хүрээ хумигдана', R.scoped > 0 && R.scoped < 17,
      'виджет: ' + R.scoped);
    check('N4. Зам мөр давхардахгүй',
      (R.crumb.match(/02 · Долоо/g) || []).length <= 1, R.crumb.replace(/\s+/g, ' '));
    check('N4. Навч дарахад засварын дэлгэц нээгдэнэ', R.editor === true);
    check('N4. Хадгалах мөр дараагийн алхмыг хэлнэ', /Дараагийн алхам/.test(R.hint), R.hint);
  } finally { srv.close(); }
}

/* ══════════════════════════════════════════════════════════════════
   O. ДАТА САН — ДАТА ТӨВТЭЙ ХОЛБООС (MAP)

   Хэрэглэгчийн шаардлага: "Ирсэн датаг нэг жагсаалтаар харуулах.
   Түүнээс сонгоод виджеттэй MAP үүсгээд шууд нийтлэх. Бүх төрлөөр нь,
   салбараар нь шүүж хардаг байх."

   Архитектур: ХОЁР ХАРАГДАЦ, НЭГ ХОЛБООСЫН ЗАГВАР. Виджетийн талаас ч,
   датаны талаас ч ЯГ НЭГ газар (metric_registry.json) бичнэ — тусдаа
   хадгалалт үүсгэвэл "виджетээс өөр, датанаас өөр" гэсэн зөрүү гарна.
     O1. Мөр бүр холбогдож болох НЭГ утга (метрик ба түүхий талбар)
     O2. Шүүлт нь МӨРҮҮДЭЭС өөрөө гарна (шинэ датасэт нэмэхэд дагана)
     O3. Зөвхөн НЭГЖ НЬ ТОХИРОХ байрлал санал болгоно (why() дахин)
     O4. Холбох → салгах нэг товчоор, нэг өөрчлөлт нэг л удаа тоологдоно
     O5. Хоёр тал ТОХИРНО: датанаас холбосон нь виджетийн дэлгэцэд гарна
   ══════════════════════════════════════════════════════════════════ */
async function groupO() {
  group('O. Дата сан — дата төвтэй холбоос');
  const adm = read('admin/index.html'), con = readJson('content.json');

  check('O1. Дата сан хоёр төрлийн мөр үүсгэнэ (метрик + талбар)',
    adm.includes('function invRows()') &&
    adm.includes("kind:'metric'") && adm.includes("kind:'field'"));
  check('O1. Түүхий талбар нь МАССИВ хэлбэрээр уншигдана (f[0], f.name БИШ)',
    adm.includes('var fn=f[0]') && !adm.includes('invFieldUsers(ds,f.name,ag)'),
    'measures() массив буцаадаг — f.name уншвал undefined');
  check('O1. Дата сан "Дата холболт" табын ЭХЭНД',
    adm.includes('var invHtml=lvInventory();') && adm.includes('return invHtml+'));

  check('O2. Таван шүүлт (салбар, датасэт, нэгж, төрөл, төлөв)',
    ["'sector'", "'dataset'", "'unit'", "'kind'", "'state'"]
      .every((k) => adm.includes('[' + k + ',')),
    'шүүлтийн бүрдэл дутуу');
  check('O2. Шүүлтийн утга мөрүүдээс тооцогдоно (гараар бүртгээгүй)',
    adm.includes('all.forEach(function(r){var v=invValue(r,fk);'));

  check('O3. Зөвхөн нэгж нийцэх байрлал (why() дахин ашиглана)',
    adm.includes('function invTargets(r)') &&
    adm.includes('if(why(r.metric,requiredUnit(id,s.key))!==null) return;'));
  check('O3. Ижил нэртэй виджет байрлалаараа ялгагдана',
    adm.includes("+' · '+posInSection(id)"),
    'w2pb/w2cb хоёр ижил нэртэй тул ялгах боломжгүй болно');

  check('O4. Нэг товч холбох ба салгах',
    adm.includes('data-invbind') && adm.includes("log(wid,'Метрик салгав: '") &&
    adm.includes("delete w.value"));
  check('O4. Хавтгай виджетийн өөрчлөлт ДАВХАР тоологдохгүй',
    adm.includes('function slotCmp(v,path)') &&
    adm.includes("if(k!=='value'&&k!=='chart')"),
    'slotVal нь хавтгай виджетэд БҮХЭЛ объект буцаадаг тул value давхар тоологдоно');
  check('O4. Мөрөөс шууд нийтлэх боломжтой',
    adm.includes('data-invpub') && adm.includes("$('pubBtn')"));

  check('O5. Дата сангийн текст content.json-д бүртгэгдсэн',
    !!(con.ui && con.ui.inv && con.ui.inv.heading && con.ui.inv.map && con.ui.inv.f_sector));

  if (!CHROME) { skipped('O6. Дата сан (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(4500);
      d.querySelector('[data-tab="metrics"]').click(); await sleep(1400);
      const R={};
      R.rows=d.querySelectorAll('[data-inv-card]').length;
      R.facets=d.querySelectorAll('.invf').length;
      /* Шүүлт — зөвхөн түүхий талбар */
      const kf=d.querySelector('[data-invf="kind|field"]');
      if(!kf) return {__err:'төрлийн шүүлт алга'};
      kf.click(); await sleep(800);
      R.fieldRows=d.querySelectorAll('[data-inv-card]').length;
      const cards=[...d.querySelectorAll('[data-inv-card]')];
      const card=cards.filter(c=>/Зорчигч · SUM/.test(c.textContent))[0];
      if(!card) return {__err:'"Зорчигч · SUM" мөр алга'};
      R.label=card.querySelector('h3').textContent.trim();
      card.querySelector('[data-invopen]').click(); await sleep(800);
      R.targets=d.querySelectorAll('[data-invbind]').length;
      R.dirty0=(d.getElementById('dirtyMsg')||{}).textContent||'';
      const t=[...d.querySelectorAll('[data-invbind]')][0];
      t.click(); await sleep(1200);
      R.dirty1=(d.getElementById('dirtyMsg')||{}).textContent||'';
      const again=[...d.querySelectorAll('[data-inv-card]')]
        .filter(c=>/Зорчигч · SUM/.test(c.textContent))[0];
      R.used=again?again.textContent.replace(/\s+/g,' '):'';
      /* Хоёр тал тохирох эсэх — виджет рүү очиж слотын сонголтыг харна */
      const go=[...again.querySelectorAll('[data-mgoto]')][0];
      if(go){ go.click(); await sleep(1600) }
      R.slotText=[...d.querySelectorAll('select')]
        .map(s=>s.options[s.selectedIndex]?s.options[s.selectedIndex].text:'').join(' | ');
      /* Салгах — буцаад дата сан руу */
      return R;
    }`, 90000);
    if (R.__err) { bad('O6. Дата сангийн DOM шалгалт', R.__err); return; }
    check('O6. Ирсэн бүх дата нэг жагсаалтад', R.rows >= 50, 'мөр: ' + R.rows);
    check('O6. Таван шүүлтийн мөр зурагдана', R.facets === 5, 'шүүлт: ' + R.facets);
    check('O6. Төрлөөр шүүхэд жагсаалт хумигдана',
      R.fieldRows > 0 && R.fieldRows < R.rows,
      JSON.stringify({ all: R.rows, field: R.fieldRows }));
    check('O6. Талбарын нэр зөв (undefined БИШ)',
      /^Зорчигч · SUM/.test(R.label) && !/undefined/.test(R.label), R.label);
    check('O6. Нэгж нийцэх байрлал санал болгоно', R.targets > 0, 'байрлал: ' + R.targets);
    check('O6. Холбоход ЯГ НЭГ өөрчлөлт тоологдоно',
      /Өөрчлөлт алга/.test(R.dirty0) && /^1 /.test(R.dirty1.trim()),
      JSON.stringify({ before: R.dirty0.trim(), after: R.dirty1.trim() }));
    check('O6. Холбосны дараа мөр "холбогдсон" болно',
      /1 виджетэд холбогдсон/.test(R.used),
      R.used.slice(0, 140));
    check('O6. Датанаас холбосон нь ВИДЖЕТИЙН дэлгэцэд ч гарна',
      /Зорчигч/.test(R.slotText) && /SUM/.test(R.slotText), R.slotText.slice(0, 120));
  } finally { srv.close(); }
}

/* ══════════════════════════════════════════════════════════════════
   P. ДЭД ХУУДСУУДЫН ТОЛГОЙ — ЗОХИОМОЛ ТООГ БОДИТ БОЛГОСОН

   Хуудсуудын толгойн тоо бүгд ТЕМПЛЕЙТЭД ХАТУУ бичигдсэн байсан бөгөөд
   бодит агуулгатай ЗӨРЖ байв:
     Нээлттэй өгөгдөл "24 датасет"  ← каталогт 10
     Коммунити        "18 бүтээл"   ← жагсаалтад 6
     Салбарын түүх    "32 үйл явдал" ← бүртгэлд 9,  "24 нэр" ← 8
     Мэдээ            "86 баримт"   ← санд 46,      "5 ангилал" ← 7
     Баримтын ангилал "119 / 86 …"  ← бодит 14 / 10 …
   Энэ бол "Тоо ЗОХИОХГҮЙ" дүрмийн зөрчил — хуудас өөрийнхөө хэмжээг
   ХУДАЛ бичиж байсан.
     P1. Тоо бүр ЖАГСААЛТААСАА гарна
     P2. Эх сурвалжгүй тоо "—" болно, content.json-оос л утга авна
     P3. Толгойн текст ба таб админаас засварлагдана
     P4. Хатуу бичсэн тоо ҮЛДЭЭГҮЙ
   ══════════════════════════════════════════════════════════════════ */
function groupP() {
  group('P. Дэд хуудсуудын толгой');
  const idx = read('index.html'), adm = read('admin/index.html'), con = readJson('content.json');

  check('P1. Датасэт ба endpoint-ийн тоо жагсаалтаас',
    idx.includes('value:String(DATASETS.length)') &&
    idx.includes('value:String(API_ENDPOINTS.length)'));
  check('P1. Бүтээл ба бодлогын саналын тоо жагсаалтаас',
    idx.includes('value:String(PROJECTS.length)') &&
    idx.includes('value:String(POLICIES.length)'));
  check('P1. Түүхийн жил, үйл явдал, нэрийн тоо бүртгэлээс',
    idx.includes('new Date().getFullYear()-histFrom+1') &&
    idx.includes('value:String(HISTORY.length)') &&
    idx.includes('value:String(PEOPLE.length)'));
  check('P1. Баримт, ангилал, мэдээний тоо сангаасаа',
    idx.includes('const docTotal=Object.keys(DOCS).reduce') &&
    idx.includes('value:String(DOC_CATS.length)') &&
    idx.includes('value:String(NEWS_ITEMS.length)'));
  check('P1. Ангилал бүрийн тоо БОДИТ баримтаас',
    idx.includes('count:(DOCS[c[0]]||[]).length') &&
    !/const DOC_CATS=\[\['research','Судалгаа',\d/.test(idx),
    'DOC_CATS-д гараар бичсэн тоо үлдсэн');
  check('P1. Алдартны "+N бусад" жагсаалтаас',
    idx.includes("more:'+'+Math.max(0,PEOPLE.length-3)"));

  check('P2. Эх сурвалжгүй тоо "—" болно',
    ["browse.hero.c3_value", "browse.hero.c2_sub", "community.hero.c2_value"]
      .every((k) => idx.includes("stxt('" + k + "','')||'—'")),
    'эх сурвалжгүй утга хатуу тоогоор үлдсэн');
  check('P2. content.json-д тэдгээр хоосон бүртгэгдсэн',
    con.site.browse.hero.c3_value === '' &&
    con.site.community.hero.c2_value === '',
    'зохиомол тоо content.json-д бичигдсэн байна');

  check('P3. Дөрвөн хуудасны толгой content.json-д',
    ['browse', 'community', 'news', 'history']
      .every((p) => con.site[p] && con.site[p].hero && con.site[p].hero.lead));
  check('P3. Таб тогтмол болж, content.json-оос давхарлагдана',
    idx.includes('const BROWSE_TABS=[') && idx.includes('const COMM_TABS=[') &&
    idx.includes('const NEWS_TABS=[') && idx.includes('const tabOverlay=('));
  check('P3. Табын түлхүүр КОДОД үлдэнэ (зөвхөн нэр солигдоно)',
    idx.includes('if(t.label) list[i][1]=t.label;') &&
    !idx.includes('list[i][0]='),
    'түлхүүр засагдвал хуудас ажиллахаа болино');
  check('P3. Админд хуудас бүрийн толгой ба таб бүлэгтэй',
    adm.includes("{path:['browse','hero']") && adm.includes("{path:['community','hero']") &&
    adm.includes("{path:['news','hero']") && adm.includes("{path:['history','hero']") &&
    adm.includes('var PAGE_TABS=['));
  check('P3. Табын бүлгийг хуудас бүрд ХУУЛЖ бичээгүй (нэг давталт)',
    (adm.match(/Array\.isArray\(node\.tabs\)/g) || []).length === 1 &&
    !adm.includes('if(esv&&Array.isArray(esv.tabs)){'),
    'eservices-ийн хуучин блок үлдсэн — давхар зурагдана');

  check('P4. Темплейтэд хатуу тоо ҮЛДЭЭГҮЙ',
    ['>24</div>', '>18</div>', '>3.3K</div>', '>101</div>', '>32</div>',
      '>86</div>', '>1.1M</div>', '+21 бусад', '19 нээлттэй', '99.9% uptime']
      .every((t) => !idx.includes(t)),
    'хатуу бичсэн тоо үлдсэн');
}

/* ══════════════════════════════════════════════════════════════════
   Q. ДЭЛГЭРЭНГҮЙ (ДАТАСЭТ) ХУУДСЫН БИЧИГ

   Каталогоос датасэт дээр дарахад нээгддэг хамгийн том хуудас (720
   мөр). Шүүлтийн шошго, хүснэгтийн толгой, лиценз, эрхийн мэдэгдэл,
   товчнууд бүгд ТЕМПЛЕЙТЭД хатуу бичигдсэн тул админ засаж чаддаггүй
   байв.
     Q1. Бичиг бүр content.json → site.detail дээр
     Q2. Темплейт нэг объектоор холбогдоно (detail.t.*)
     Q3. Админд бүлэг болж бүртгэгдсэн
     Q4. Хатуу бичсэн текст ҮЛДЭЭГҮЙ
   ══════════════════════════════════════════════════════════════════ */
function groupQ() {
  group('Q. Дэлгэрэнгүй хуудасны бичиг');
  const idx = read('index.html'), adm = read('admin/index.html'), con = readJson('content.json');
  const d = con.site && con.site.detail;

  check('Q1. site.detail бүртгэгдсэн', !!d && Object.keys(d).length >= 30,
    'түлхүүр: ' + (d ? Object.keys(d).length : 0));
  check('Q1. Бичиг бүр stxt()-ээр уншигдана',
    Object.keys(d || {}).every((k) => idx.includes("stxt('detail." + k + "'")),
    'зарим түлхүүр кодод уншигдахгүй');

  check('Q2. Нэг объектоор холбогдоно',
    idx.includes('const detailT={') && idx.includes('t:detailT,'));
  check('Q2. Темплейт detail.t.* ашиглана',
    ['{{ detail.t.year }}', '{{ detail.t.filter }}', '{{ detail.t.license }}',
      '{{ detail.t.schema_head }}', '{{ detail.t.excel_btn }}']
      .every((b) => idx.includes(b)));

  check('Q3. Админд "Дэлгэрэнгүй хуудас" бүлэгтэй',
    adm.includes("{key:'detail', title:'Дэлгэрэнгүй (датасэт) хуудас'"));
  check('Q3. ui_form-д ч бүртгэгдсэн (файлын тодорхойлолт давуу эрхтэй)',
    (con.ui_form.site || []).some((g) => g.key === 'detail'));

  check('Q4. Темплейтэд хатуу бичсэн текст ҮЛДЭЭГҮЙ',
    ['>Жил:</div>', '>Багануудын тодорхойлолт<', '>Татах боломжтой хувилбарууд<',
      'Лиценз: CC-BY 4.0 — эх сурвалжийг дурдана.</',
      '>⇩ Excel татах<', '>Түлхүүр авах<']
      .every((t) => !idx.includes(t)),
    'хатуу бичсэн текст үлдсэн');
}

/* ──────────────────────────────── АЖИЛЛУУЛАХ ──────────────────────────────── */
console.log('ErtHub — систем тест');
(async () => {
  groupA(); groupB(); await groupC(); groupD(); groupE(); await groupF(); await groupG(); await groupH();
  groupI(); await groupI2(); await groupI3(); await groupI4(); await groupJ(); await groupK(); await groupL(); await groupM(); await groupN(); await groupO(); groupP(); groupQ();

  console.log('\n' + '═'.repeat(62));
  console.log('НИЙТ:  PASS ' + pass + '  ·  FAIL ' + fail + '  ·  SKIP ' + skip);
  if (failures.length) {
    console.log('\nУНАСАН ТЕСТ:');
    failures.forEach(f => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
})();

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
const { listenFree } = require('./lib/listen');
let PORT = 0;   /* serve() бүр OS-оос сул порт онооно — tests/lib/listen.js */
let pass = 0, fail = 0, skip = 0;
const failures = [];

const NLc = String.fromCharCode(10), CR_LF = String.fromCharCode(13, 10);
function group(name) { console.log('\n══ ' + name + ' ' + '═'.repeat(Math.max(0, 58 - name.length))); }
function ok(name) { pass++; console.log('  PASS  ' + name); }
function bad(name, detail) {
  fail++; failures.push(name + (detail ? ' — ' + detail : ''));
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function skipped(name, why) { skip++; console.log('  SKIP  ' + name + (why ? ' (' + why + ')' : '')); }
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }

/* Мөрийн төгсгөлийг НЭГТГЭНЭ. Windows дээр core.autocrlf=true тул
   checkout хийсний дараа ажлын мод CRLF болдог; тэгэхээр эх код дотор
   LF-тэй хэв маяг хайдаг шалгуурууд ЧИМЭЭГҮЙ гажина. Хоёр төрлийн эвдрэл
   гардаг: (а) regex таарахгүй болж тест унана (жиш. adminScript — 17
   тест "esc() алга" гэсэн төөрөгдүүлсэн нэрээр уначихсан), (б) СӨРӨГ
   шалгуур (!src.includes('...')) ҮРГЭЛЖ ҮНЭН болж тест ХУДАЛ ногоон
   болно — энэ нь илүү аюултай. Тиймээс эх сурвалжийг нэг л газар
   нормчилно. */
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
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
  /* CRLF-тэй ажлын мод дээр ч ажиллана. Windows дээр core.autocrlf=true
     үед checkout хийхэд <script> шошгын ард CR+LF ирдэг тул хатуу LF
     хайвал эх код ОЛДОХГҮЙ — админы 17 тест ЧИМЭЭГҮЙ уначихдаг байв
     (алдаа нь "esc() алга", "utxt() алга" гэх мэт төөрөгдүүлсэн нэрээр). */
  const m = read('admin/index.html').match(/<script>\r?\n([\s\S]*?)<\/script>/);
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
    const dynGroups = ['sectors', 'sector_kpi', 'sector_kpi_air_live', 'sector_kpi_rail_live', 'sector_chart', 'unit',
      /* `ds_schema_rail_wagon` — вагон ачилтын датасэтийн баганын нэр/тайлбар.
         applyRailWagonData() дотор stxt('ds_schema_rail_wagon.head.'+i) гэж
         ИНДЕКСЭЭР уншдаг тул бүтэн зам мөрөөр олдохгүй (sector_kpi_*_live-тэй
         ижил зарчим). */
      'ds_schema_rail_wagon',
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
  /* k04-ийн эхний карт утгын тохиргоог дагадаг болсон тул бичиглэл нь
     delta:vs?(…):(verified?…:'—') хэлбэртэй байж болно — ЗОРИЛГО нь
     хэвээр: баталгаажаагүй үед хувь "—" гарна. */
  check('H5: verified бус үед хувь "—" болно', /delta:(?:vs\?\(vs\.delta\|\|'—'\):\()?verified\?[^:]+:'—'/.test(src));
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
  /* E7 — Сэтгэгдэл нэмэхэд "Хадгалах" төлөв АРЧИГДАХГҮЙ (регресс).
     Өмнө нь submitDocReview-ийн локал замд `docSaved:null` байсан тул
     баримт хадгалсан хэрэглэгч сэтгэгдэл бичмэгц БҮХ хадгалсан баримт
     нь алга болдог байв. Функцийг эх кодоос нь салгаж, жижиг фикстур
     дээр (2 хадгалсан баримт, 1 сэтгэгдэл) ЖИНХЭНЭЭР ажиллуулна. */
  const srM = src.match(/const submitDocReview=\(\)=>\{[\s\S]*?\n    \};/);
  if (!srM) {
    bad('E7: submitDocReview эх кодонд олдсонгүй');
  } else {
    const saved0 = { 'research:Өөр баримт': 1, 'research:Энэ баримт': 1 };
    const runReview = (storeStub) => {
      const ctx = {
        state: { authed: true, authFull: 'Тест хэрэглэгч', docReviewDraft: 'Хэрэгтэй судалгаа',
          docReviews: null, docSaved: Object.assign({}, saved0), docShareOpen: true },
        setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); },
        fadeToast() {}, docItemId() { return 'doc__research-энэ-баримт'; }, loadDocData() {}
      };
      const make = new Function('cat', 'd', 'dkey', 'myStars', 'window',
        srM[0] + '\nreturn submitDocReview;');
      const fn = make.call(ctx, 'research', ['road', 'Энэ баримт'], 'research:Энэ баримт', 4,
        { erthubStore: storeStub });
      fn();
      return ctx.state;
    };
    const sLocal = runReview(undefined);
    const rows = (sLocal.docReviews && sLocal.docReviews['research:Энэ баримт']) || [];
    check('E7: локал горим — сэтгэгдэл нэмэгдэнэ (1 ш, 4 од)',
      rows.length === 1 && rows[0].stars === 4, JSON.stringify(sLocal.docReviews));
    check('E7: локал горим — хадгалсан 2 баримт ХЭВЭЭР (docSaved арчигдахгүй)',
      JSON.stringify(sLocal.docSaved) === JSON.stringify(saved0), JSON.stringify(sLocal.docSaved));
    check('E7: локал горим — ноорог цэвэрлэгдэж, хуваалцах цэс хаагдана',
      sLocal.docReviewDraft === '' && sLocal.docShareOpen === false);
    const sRemote = runReview({ available: true, addReview: () => Promise.resolve({}) });
    check('E7: Firestore горим — хадгалсан 2 баримт ХЭВЭЭР',
      JSON.stringify(sRemote.docSaved) === JSON.stringify(saved0), JSON.stringify(sRemote.docSaved));
  }

  /* E8 — Тестийн порт мөргөлдөхгүй (регресс). Өмнө нь хатуу 8971/8973
     порт эзлэгдсэн байхад (өөр сешн, worktree, хоцорсон процесс) бүх
     гүйлт C бүлэг дээр unhandled EADDRINUSE-ээр унадаг байв. Одоо
     эзлэгдсэн порт + ЗЭРЭГЦЭЭ 2 сервер нөхцлийг яг давтана. */
  const tfiles = ['tests/run.js', 'tests/text-coverage.js'];
  const hard = tfiles.filter((f) => /\bconst PORT\s*=\s*\d+/.test(read(f)) || /\.listen\(\s*[1-9]\d*\s*\)/.test(read(f)));   /* listen(0) = сул порт, зөвшөөрнө */
  check('E8: тестүүдэд хатуу порт үлдээгүй', hard.length === 0, hard.join(', '));
  const envPort = process.env.TEST_PORT;
  delete process.env.TEST_PORT;
  const blocker = http.createServer().listen(0);
  const taken = blocker.address().port;
  const s1 = http.createServer(), s2 = http.createServer();
  const p1 = listenFree(s1), p2 = listenFree(s2);
  check('E8: зэрэгцээ 2 сервер тус тусдаа сул порт авна',
    p1 > 0 && p2 > 0 && p1 !== p2 && p1 !== taken && p2 !== taken, [taken, p1, p2].join(' / '));
  [blocker, s1, s2].forEach((s) => s.close());
  if (envPort !== undefined) process.env.TEST_PORT = envPort;
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
  const srv = http.createServer((req, res) => {
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
  });
  PORT = listenFree(srv);
  return srv;
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

const PROBE_F = "async function(d,w){\n  const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n  await sleep(3500);\n  const SEC={hero_fl:'hero',hero_px:'hero',uk:'portal-kpi',ls:'sec-01',\n    w2p:'sec-02',w2pb:'sec-02',w2px:'sec-02',w2c:'sec-02',w2cb:'sec-02',\n    w2cx:'sec-02',k04:'sec-04',t05:'sec-05',d05:'sec-05',i06:'sec-06',\n    r06:'sec-06',u07:'sec-07'};\n  const norm=t=>t.replace(/[\\s\\u00a0]+/g,' ').trim();\n  const pvT=()=>norm(d.getElementById('pvhost').innerText);\n  const edT=()=>norm(d.querySelector('.edit2').innerText);\n  const geo=()=>[].slice.call(d.querySelectorAll('#pvhost rect,#pvhost circle,#pvhost path,'+\n      '#pvhost .pvsc .v,#pvhost .pvgc .v,#pvhost .pvrow b,#pvhost .pvrk i,'+\n      '#pvhost .pvcd .d,#pvhost .sp-val'))\n    .map(e=>e.tagName+':'+(e.getAttribute('height')||e.getAttribute('d')||\n      e.getAttribute('stroke-dasharray')||e.getAttribute('style')||e.textContent)).join('|');\n  const snap=()=>({t:pvT(),g:geo()});\n  const go=id=>{ let b,n=0; while((b=d.querySelector('[data-back]'))&&n++<6) b.click();\n    const s=d.querySelector('[data-section=\"'+SEC[id]+'\"]'); if(!s) return false;\n    s.click(); const c=d.querySelector('[data-widget=\"'+id+'\"]'); if(!c) return false;\n    c.click(); return true; };\n  const probeAll=(q,attr,mk,scope)=>{ const out={};\n    [].slice.call(d.querySelectorAll(q)).map(x=>x.getAttribute(attr)).forEach(k=>{\n      const e=d.querySelector('['+attr+'=\"'+k+'\"]'); if(!e) return;\n      const ov=e.value, pr=mk(k);\n      e.value=pr; e.dispatchEvent(new w.Event('input',{bubbles:true}));\n      out[k]=scope().indexOf(pr)>=0?'PASS':'FAIL';\n      e.value=ov; e.dispatchEvent(new w.Event('input',{bubbles:true}));\n    }); return out; };\n  const R={rows:[]};\n  for(const id of Object.keys(SEC)){\n    const row={id:id};\n    if(!go(id)){ row.nav=false; R.rows.push(row); continue }\n    row.nav=true;\n    const pw=()=>!!d.querySelector('[data-periodwarn]');\n    row.pw0=pw();\n    const s0=snap();\n    const sels=[].slice.call(d.querySelectorAll('[data-slot]'));\n    if(!sels.length){ row.swap='N/A'; row.back='N/A' }\n    else{\n      const sel=sels[0], cur=sel.value;\n      const en=[].slice.call(sel.options).filter(o=>!o.disabled&&o.value!==cur).map(o=>o.value);\n      const all=[].slice.call(sel.options).map(o=>o.value).filter(v=>v!==cur);\n      const pref=en.filter(v=>v);\n      const tgt=pref.length?pref[0]:(en.length?en[0]:all[0]);\n      sel.value=tgt; sel.dispatchEvent(new w.Event('change',{bubbles:true}));\n      const s1=snap();\n      row.pwSwap=pw();\n      row.swap=(s1.t!==s0.t||s1.g!==s0.g);\n      row.swapInfo=(cur||'—')+' → '+(tgt||'—');\n      const s2=d.querySelector('[data-slot]');\n      s2.value=cur; s2.dispatchEvent(new w.Event('change',{bubbles:true}));\n      const s3=snap();\n      row.pwBack=pw();\n      row.back=(s3.t===s0.t&&s3.g===s0.g);\n    }\n    const tf=probeAll('[data-tf]','data-tf',k=>'ZZ'+k.toUpperCase()+'ZZ',pvT);\n    const sf=probeAll('.e-fm [data-sf]','data-sf',()=>'ZZSFZZ',pvT);\n    const rf=probeAll('[data-rf]','data-rf',()=>'ZZRFZZ',edT);\n    row.tfN=Object.keys(tf).length; row.sfN=Object.keys(sf).length; row.rfN=Object.keys(rf).length;\n    row.dead=[].concat(Object.entries(tf),Object.entries(sf),Object.entries(rf))\n      .filter(x=>x[1]!=='PASS').map(x=>x[0]);\n    row.text=Object.values(tf).every(v=>v==='PASS');\n    R.rows.push(row);\n  }\n  if(go('hero_px')){\n    const sx=d.querySelector('[data-slot]');\n    sx.value='air.weekly_pax'; sx.dispatchEvent(new w.Event('change',{bubbles:true}));\n    const vis=()=>{const b=d.querySelector('[data-periodwarn]');\n      return !!b&&b.style.display!=='none'};\n    R.px={warn:vis()};\n    const fb=d.querySelector('[data-periodwarn] [data-autoname]');\n    R.px.fix=fb?fb.getAttribute('data-autoname'):null;\n    if(fb) fb.click();\n    R.px.title=(d.querySelector('[data-tf=\"title\"]')||{}).value;\n    R.px.warnAfterFix=vis();\n    const sy=d.querySelector('[data-slot]');\n    sy.value=''; sy.dispatchEvent(new w.Event('change',{bubbles:true}));\n    const cc=d.querySelector('[data-tcancel]'); if(cc&&!cc.disabled) cc.click();\n  }\n  if(go('ls')){\n    const pv=()=>{const x=d.getElementById('pendRow');return !!x&&x.style.display!=='none'};\n    const t1=d.querySelector('[data-tf=\"title\"]');\n    const orig=t1.value;\n    t1.value='ZZDRAFTZZ'; t1.dispatchEvent(new w.Event('input',{bubbles:true}));\n    R.dr={bar:pv()};\n    let q,qn=0; while((q=d.querySelector('[data-back]'))&&qn++<6) q.click();\n    R.dr.barAway=pv();\n    go('ls');\n    R.dr.kept=(d.querySelector('[data-tf=\"title\"]')||{}).value==='ZZDRAFTZZ';\n    d.querySelector('[data-penddrop]').click();\n    R.dr.dropped=(d.querySelector('[data-tf=\"title\"]')||{}).value===orig&&!pv();\n    const t2=d.querySelector('[data-tf=\"title\"]');\n    t2.value='ZZAPPLYZZ'; t2.dispatchEvent(new w.Event('input',{bubbles:true}));\n    let q2,qm=0; while((q2=d.querySelector('[data-back]'))&&qm++<6) q2.click();\n    d.querySelector('[data-pendsave]').click();\n    go('ls');\n    R.dr.applied=(d.querySelector('[data-tf=\"title\"]')||{}).value==='ZZAPPLYZZ'&&!pv();\n    const t3=d.querySelector('[data-tf=\"title\"]');\n    t3.value=orig; t3.dispatchEvent(new w.Event('input',{bubbles:true}));\n    const sv=d.querySelector('[data-tsave]'); if(sv&&!sv.disabled) sv.click();\n  }\n  if(go('hero_fl')){\n    const a1=d.querySelector('[data-slot]'), c1=a1.value;\n    const fo=[].slice.call(a1.options).filter(function(o){\n      return !o.disabled&&o.value.indexOf('field:')===0&&o.value.indexOf('field:|')!==0})[0];\n    if(fo){\n      a1.value=fo.value; a1.dispatchEvent(new w.Event('change',{bubbles:true}));\n      R.rt={pick:fo.value,mid:d.getElementById('dirtyMsg').textContent};\n      /* render() дараа select нь ШИНЭ зангилаа — ДАХИН асууж авна */\n      const a2=d.querySelector('[data-slot]');\n      R.rt.fresh=(a1!==a2);\n      a2.value=c1; a2.dispatchEvent(new w.Event('change',{bubbles:true}));\n      R.rt.back=d.getElementById('dirtyMsg').textContent;\n      R.rt.card=(d.querySelector('#pvhost')||{}).innerText;\n    }\n  }\n  R.dirty=d.getElementById('dirtyMsg').textContent;\n  return R;\n}";

/* ── Хугацааны нарийвчлалын (period grain) логикийг АДМИНЫ ЭХ КОДООС
   гаргаж авна. Тест хуулбар бичихгүй: админ юу боддог, тест ЯГ түүгээр
   бодно — эс бөгөөс "тест ногоон, дэлгэц улаан" гэсэн зөрүү үүснэ. */
function periodKit() {
  const src = adminScript();
  const cut = (from, to) => {
    const a = src.indexOf(from), b = src.indexOf(to);
    return (a < 0 || b < 0 || b <= a) ? null : src.slice(a, b);
  };
  const parts = [cut('var TEXT_ONLY={', 'var ALL_IDS='),
                 cut('function slotsOf(id){', 'function boundMetrics('),
                 cut('function curText(id,f){', 'function dirtyTextFields('),
                 cut('var VALUE_TARGETS={', 'function valueDirtyKeys('),
                 cut('var PERIODS=[', 'function titleMismatchWarn('),
                 cut('function autoNameHint(id,cur){', 'function textForm(')];
  if (parts.some(p => p === null)) return null;
  const make = new Function('REG', 'S', 'CON', 'SECN', 'esc', 'utxt', 'EHChart',
    parts.join('') + 'return {periodOfText:periodOfText,periodOfMetric:periodOfMetric,' +
    'periodOfWidget:periodOfWidget,periodLabel:periodLabel,titleIsValueLabel:titleIsValueLabel,' +
    'retitledPeriod:retitledPeriod,periodMismatchWarn:periodMismatchWarn,' +
    'periodMismatchList:periodMismatchList,statOf:statOf,autoNameHint:autoNameHint};');
  /* EHChart жинхэнэ модулиасаа — autoNameHint нэрийг ТҮҮГЭЭР гаргадаг */
  const sb = { window: {} };
  try { new Function('window', read('js/erthub-chart.js'))(sb.window); } catch (e) { return null; }
  return (reg, con) => make(reg, { widget: null, td: null }, con,
    { air: 'Агаар', public: 'Нийтийн тээвэр' }, String, (p, f) => f, sb.window.EHChart);
}

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
     F5. Хугацааны нарийвчлал (өдөр/7 хоног/сар) — нэгжийн шалгуур
         БАРЬДАГГҮЙ зөрүүг тусад нь илрүүлэх (unit тест, Chrome-гүй)
     F6. Бодит registry дээр ХУДАЛ анхааруулга гарахгүй, харин Blocker
         тохиолдол (hero_px + 7 хоногийн метрик) ИЛРЭНЭ
     F7. Браузер: анхааруулга ЖИНХЭНЭ дэлгэц дээр гарч/арилна
   ══════════════════════════════════════════════════════════════════ */
async function groupF() {
  group('F. Виджетийн бүх талбар засварлагдах (16 виджет)');

  /* ── F5. Хугацааны нарийвчлал — ГАРААР БОДОХ БОЛОМЖТОЙ фикстур ──
     ЯАГААД: "ЗОРЧИГЧ / ӨДӨР" слотод 7 хоногийн НИЙЛБЭР метрик холбогдвол
     нэгж нь ХОЁУЛАА "хүн" тул why()/нэгжийн шалгуур зөрчил ОЛОХГҮЙ, гэтэл
     сайт дээр ~7 дахин өндөр тоо "өдрийн" гэж танилцуулагдана. */
  const kit = periodKit();
  if (!kit) { bad('F5. Хугацааны логик админы эх кодоос олдсонгүй'); }
  else {
    const REG_FIX = { metrics: {
        'x.week':  { name: '7 хоногийн нийт зорчигчийн тоо', filter: 'бүтэн 7 хоног',
                     unit: 'хүн', quality: 'verified',
                     period_note: 'hero_fl-ийн "сүүлийн бүтэн сар" зарчимтай адил' },
        'x.month': { name: 'Сүүлийн бүтэн сарын нислэгийн тоо', filter: 'сүүлийн бүтэн сар',
                     unit: 'нислэг', quality: 'verified' } },
      widgets: { one: { metric: 'x.week' } } };
    const CON_FIX = { widgets: { one: { title: 'ЗОРЧИГЧ / ӨДӨР' } } };
    const K = kit(REG_FIX, CON_FIX);

    check('F5. Хугацааны үг таних (өдөр · 7 хоног · сар · хугацаагүй)',
      K.periodOfText('ЗОРЧИГЧ / ӨДӨР') === 'day' &&
      K.periodOfText('7 хоног') === 'week' &&
      K.periodOfText('Долоо хоногийн нийт зорчигч тээвэр') === 'week' &&
      K.periodOfText('НИСЛЭГ / САР') === 'month' &&
      K.periodOfText('Салбар хоорондын харьцуулалт') === null,
      [K.periodOfText('ЗОРЧИГЧ / ӨДӨР'), K.periodOfText('7 хоног'),
       K.periodOfText('Долоо хоногийн нийт зорчигч тээвэр'),
       K.periodOfText('НИСЛЭГ / САР'), K.periodOfText('Салбар хоорондын харьцуулалт')].join('/'));

    check('F5. period_note дэх ИШ ТАТСАН хугацаа метрикийг ГАЖУУДУУЛАХГҮЙ',
      K.periodOfMetric('x.week') === 'week' && K.periodOfMetric('x.month') === 'month',
      K.periodOfMetric('x.week') + '/' + K.periodOfMetric('x.month'));

    const w1 = K.periodMismatchWarn('one');
    check('F5. Гарчиг ӨДӨР + метрик 7 ХОНОГ → анхааруулга ГАРНА', !!w1, w1.slice(0, 80));
    check('F5. Анхааруулга гарчгийн засварыг САНАЛ болгоно (ЗОРЧИГЧ / 7 ХОНОГ)',
      K.retitledPeriod('one', 'week') === 'ЗОРЧИГЧ / 7 ХОНОГ' &&
      w1.indexOf('ЗОРЧИГЧ / 7 ХОНОГ') >= 0, K.retitledPeriod('one', 'week'));

    const K2 = kit({ metrics: REG_FIX.metrics, widgets: { one: { metric: 'x.month' } } },
                   { widgets: { one: { title: 'НИСЛЭГ / САР' } } });
    check('F5. Хугацаа ТААРВАЛ анхааруулга ГАРАХГҮЙ', K2.periodMismatchWarn('one') === '',
      K2.periodMismatchWarn('one').slice(0, 60));

    /* Хэсгийн гарчиг (i06 хэлбэр) — хугацааны үггүй тул ХУДАЛ анхааруулга
       ч, ХУДАЛ "нэр солих" санал ч гарах ёсгүй. */
    const K3 = kit({ metrics: REG_FIX.metrics, widgets: { one: { metric: 'x.month' } } },
                   { widgets: { one: { title: 'Салбар хоорондын харьцуулалт (индекс)' } } });
    check('F5. Хугацааны үггүй ХЭСГИЙН гарчигт худал анхааруулга гарахгүй',
      K3.periodMismatchWarn('one') === '' && K3.titleIsValueLabel('one') === false);
    check('F5. "ХЭМЖИГДЭХҮҮН / ХУГАЦАА" гарчиг нь тооны ШОШГО гэж танигдана',
      K.titleIsValueLabel('one') === true);
  }

  /* ── F8. Тоолуурын семантик: "холбогдсон" ≠ "зөв" ──
     dbt/Looker "компиляц" ба "тест" хоёрыг заагладаг шиг, хугацаа зөрсөн
     слотыг "бүрэн холбогдсон" гэж тоолбол тоолуур ХУДАЛ тайвшруулна. */
  if (kit) {
    const M = { metrics: {
        'x.week':  { name: '7 хоногийн зорчигч', filter: 'бүтэн 7 хоног', unit: 'хүн', quality: 'verified' },
        'x.day':   { name: 'Өдрийн зорчигч', filter: 'сүүлийн өдөр', unit: 'хүн', quality: 'verified' } },
      widgets: { one: { metric: 'x.day' } } };
    const con = { widgets: { one: { title: 'ЗОРЧИГЧ / ӨДӨР' } } };
    check('F8. Хугацаа ТААРВАЛ "бүрэн холбогдсон" (ok)',
      kit(M, con).statOf('one') === 'ok', kit(M, con).statOf('one'));
    const M2 = JSON.parse(JSON.stringify(M)); M2.widgets.one.metric = 'x.week';
    check('F8. Хугацаа ЗӨРВӨЛ "бүрэн" биш, "хэсэгчлэн" (mix)',
      kit(M2, con).statOf('one') === 'mix', kit(M2, con).statOf('one'));
    const M3 = JSON.parse(JSON.stringify(M)); M3.widgets.one.metric = null;
    check('F8. Огт холбоогүй слот "холбогдоогүй" хэвээр (no)',
      kit(M3, con).statOf('one') === 'no', kit(M3, con).statOf('one'));
  }

  /* ── F9. Автомат нэрийн санал виджетийн ТӨРЛИЙГ мэдэрнэ ──
     i06 мэт ХЭСГИЙН гарчгийг "ЗОРЧИГЧ (нийлбэр)" болгохыг санал болгож
     байсан — виджетийн дотоод тооцоолол (индекс) бүрэн үл хамаарна. */
  if (kit) {
    const val = { dataset: 'air_flights', measure: 'Зорчигч', agg: 'SUM' };
    const KL = kit({ metrics: {}, widgets: { one: { value: val } } },
                   { widgets: { one: { title: 'НИСЛЭГ / САР' } } });
    const KH = kit({ metrics: {}, widgets: { one: { value: val } } },
                   { widgets: { one: { title: 'Салбар хоорондын харьцуулалт (индекс)' } } });
    const hintL = KL.autoNameHint('one', 'НИСЛЭГ / САР');
    check('F9. Шошго-гарчигт санал ГАРНА, ХУГАЦАА нь хадгалагдана',
      hintL.indexOf('ЗОРЧИГЧ / САР') >= 0 && hintL.indexOf('(нийлбэр)') < 0, hintL.slice(0, 90));
    check('F9. ХЭСГИЙН гарчигт автомат нэр САНАЛ БОЛГОХГҮЙ',
      KH.autoNameHint('one', 'Салбар хоорондын харьцуулалт (индекс)') === '',
      KH.autoNameHint('one', 'x').slice(0, 60));
  }

  /* ── F6. Бодит файлууд дээр ── */
  if (kit) {
    const REG_R = readJson('metric_registry.json'), CON_R = readJson('content.json');
    const KR = kit(REG_R, CON_R);
    const noisy = Object.keys(REG_R.widgets).filter(id => KR.periodMismatchWarn(id) !== '');
    check('F6. Бодит registry — виджетүүдэд ХУДАЛ анхааруулга алга',
      noisy.length === 0, noisy.join(', '));
    const REG_B = JSON.parse(JSON.stringify(REG_R));
    REG_B.widgets.hero_px.sectors.public.metric = 'air.weekly_pax';
    const wb = kit(REG_B, CON_R).periodMismatchWarn('hero_px');
    check('F6. Blocker регресс: "ЗОРЧИГЧ / ӨДӨР" + 7 хоногийн метрик → ИЛРЭНЭ',
      !!wb && wb.indexOf('7 ХОНОГ') >= 0, wb ? wb.slice(0, 90) : '(анхааруулга гарсангүй)');
  }

  if (!CHROME) { skipped('F1–F4, F7 (браузерын хэсэг)', 'Chrome олдсонгүй'); return; }
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
    /* ── F7. Анхааруулга ЖИНХЭНЭ дэлгэц дээр. Загвар (kit) ба бодит DOM
       хоёрыг ТУЛГАНА — "preview зөв, сайт буруу" зөрүү энэ төсөлд хамгийн
       олон удаа давтагдсан алдаа тул хоёр талыг ХАМТ шалгана. */
    const pw0 = rows.filter(r => r.pw0).map(r => r.id);
    check('F7. Анхны төлөвт хугацааны анхааруулга алга (худал дохио үгүй)',
      pw0.length === 0, pw0.join(', '));
    const pwBack = rows.filter(r => r.pwBack).map(r => r.id);
    check('F7. Метрикийг буцаахад анхааруулга АРИЛНА', pwBack.length === 0, pwBack.join(', '));
    if (kit) {
      const REG_R = readJson('metric_registry.json'), CON_R = readJson('content.json');
      const misfit = [];
      rows.forEach(r => {
        if (!r.swapInfo || typeof r.pwSwap !== 'boolean') return;
        const tgt = r.swapInfo.split('→').pop().trim();
        const reg = JSON.parse(JSON.stringify(REG_R));
        const w = reg.widgets[r.id];
        const mk = REG_R.metrics[tgt] ? tgt : null;
        if (w.sectors && !Array.isArray(w.sectors)) w.sectors[Object.keys(w.sectors)[0]].metric = mk;
        else w.metric = mk;
        const exp = kit(reg, CON_R).periodMismatchWarn(r.id) !== '';
        if (exp !== r.pwSwap) misfit.push(r.id + ' (' + r.swapInfo + ') загвар:' + exp + ' дэлгэц:' + r.pwSwap);
      });
      check('F7. Метрик сольсны дараах анхааруулга ЗАГВАРТАЙ тохирно (16 виджет)',
        misfit.length === 0, misfit.join(' | '));
    }
    /* hero_px — Blocker-ийн ЯГ гүйлгээ: ГАНЦ "зөвшөөрөгдсөн" сонголт нь
       нэгжээрээ тохирох хэрнээ 7 хоногийн нийлбэр тул "ӨДӨР" гэсэн гарчгийн
       доор ~7 дахин өндөр тоо гаргана. */
    /* Бичсэн текст ЧИМЭЭГҮЙ алдагдахгүй (Mirakl Save Bar + Cloudscape
       "unsaved changes" — хэрэглэгч ӨӨРӨӨ л цуцална). */
    const dr = R.dr || {};
    check('F10. Бичих даруйд доод мөрөнд "хэрэглээгүй" эгнээ гарна', dr.bar === true, JSON.stringify(dr));
    check('F10. Дэлгэц сольсон ч эгнээ ХЭВЭЭР харагдана', dr.barAway === true, String(dr.barAway));
    check('F10. Буцаж ирэхэд бичсэн текст ХЭВЭЭР (алдагдахгүй)', dr.kept === true, String(dr.kept));
    check('F10. "Болих" дархад ноорог цуцлагдаж, эгнээ алга болно', dr.dropped === true, String(dr.dropped));
    check('F10. Доод мөрний "Хэрэглэх" нь ӨӨР дэлгэцээс ч хэрэглэнэ', dr.applied === true, String(dr.applied));
    /* Утга солиод БУЦААХАД төлөв бүрэн цэвэр болно. "Хадгалагдаагүй
       өөрчлөлт" гэдэг дохио худал үлдвэл хэрэглэгч жинхэнэ өөрчлөлтөө
       ялгаж чадахаа болино. */
    const rt = R.rt || {};
    check('F11. Талбар сонгоход төлөв "өөрчлөгдсөн" болно',
      typeof rt.mid === 'string' && !/алга/.test(rt.mid), JSON.stringify(rt.mid));
    check('F11. Метрикээ буцаахад төлөв ЦЭВЭР болно (хуурамч dirty үлдэхгүй)',
      typeof rt.back === 'string' && /алга/.test(rt.back), JSON.stringify(rt.back));
    check('F11. Дахин зурсны дараа select ШИНЭ зангилаа болно (тестийн урхи)',
      rt.fresh === true, String(rt.fresh));
    const px = R.px || {};
    check('F7. hero_px — 7 хоногийн метрик сонгоход анхааруулга ГАРНА',
      px.warn === true, JSON.stringify(px));
    check('F7. Анхааруулга гарчгийн бэлэн засварыг санал болгоно',
      px.fix === 'ЗОРЧИГЧ / 7 ХОНОГ', String(px.fix));
    check('F7. Товч дархад гарчиг тавигдаж, анхааруулга АРИЛНА',
      px.title === 'ЗОРЧИГЧ / 7 ХОНОГ' && px.warnAfterFix === false,
      px.title + ' · анхааруулга: ' + px.warnAfterFix);
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
   G. САЙТАД НИЙТЛЭХ ДАВХАРГА (backend overlay)

   Админ ФАЙЛ РУУ бичдэггүй тул засвар нь өмнө нь Экспортлох → гар
   хуулалт → commit хийж байж сайтад гардаг байв. Одоо "Сайтад нийтлэх"
   нь content.json/metric_registry.json-ий ДЭЭР давхарлагдах баримтыг
   backend-д бичдэг. Энэ бүлэг backend-гүйгээр (эх модулийг санах
   ойн хуурамч хувилбараар орлуулж) хоёр зүйлийг шалгана:
     G1. Нийтлэл БАЙХГҮЙ / уншигдахгүй үед сайт ФАЙЛААРАА ажиллана
         (нийтлэл бол НЭМЭЛТ давхарга, шаардлага биш)
     G2. Нийтлэл БАЙВАЛ сайт түүнийг файлын дээр давхарлан харуулна
   ══════════════════════════════════════════════════════════════════ */
async function groupG() {
  group('G. Сайтад нийтлэх давхарга (backend overlay)');
  if (!CHROME) { skipped('G бүлэг бүхэлдээ', 'Chrome олдсонгүй'); return; }

  /* Статик шалгалт — холбоос бүрэн эсэх */
  const idx = read('index.html'), adm = read('admin/index.html'), pub = read('js/erthub-publish.js');
  check('index.html нийтлэлийн модулийг ачаална',
    idx.includes('js/erthub-publish.js') && idx.includes('loadPublished()'));
  check('admin нийтлэх товч ба модультай', adm.includes('erthub-publish.js') &&
    adm.includes("id=\"pubBtn\"") && adm.includes('EHPublish.publish('));
  check('Нийтлэл backend-ийн /api/site-content руу явна (Firestore БИШ)',
    pub.includes("'/api/site-content'") && !/firestore\.googleapis/.test(pub));
  /* backend-config нь ӨМНӨ ачаалагдахгүй бол ETRANSPORT_BACKEND_BASE
     тодорхойгүй → EHPublish.enabled=false болж нийтлэл ЧИМЭЭГҮЙ унтарна. */
  const before = (h, a, b) => h.indexOf(a) >= 0 && h.indexOf(a) < h.indexOf(b);
  check('index.html: backend-config.js нь erthub-publish.js-ээс ӨМНӨ',
    before(idx, 'js/backend-config.js', 'js/erthub-publish.js'));
  check('admin: backend-config.js нь erthub-publish.js-ээс ӨМНӨ',
    before(adm, '../js/backend-config.js', '../js/erthub-publish.js'));
  check('firestore.rules-д site_content/admins бичих зам ҮЛДЭЭГҮЙ (backend руу шилжсэн)',
    !read('firestore.rules').includes('match /site_content/') &&
    !read('firestore.rules').includes('match /admins/'));
  check('Админы текстэд Firestore-ийн заавар үлдээгүй',
    !/Firestore/.test(JSON.stringify(readJson('content.json').ui.publish)));

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
   G3. НИЙТЛЭЛИЙН МОДУЛЬ ↔ BACKEND ГЭРЭЭ (js/erthub-publish.js)

   Жинхэнэ модулийг vm дотор хуурамч fetch-тэй ажиллуулж, backend-ийн
   /api/site-content гэрээг (etransport-backend test/siteContent.test.js-тэй
   ИЖИЛ) гараар бодох боломжтой хариугаар шалгана.
   ══════════════════════════════════════════════════════════════════ */
async function groupG3() {
  group('G3. Нийтлэлийн модуль ↔ backend гэрээ');
  const vm = require('vm');
  const src = read('js/erthub-publish.js');
  function mk(BASE, routes, user) {
    const calls = [];
    const ctx = { window: { auth: user === undefined
        ? { currentUser: { getIdToken: () => Promise.resolve('TOK') } }
        : { currentUser: user } },
      console: { info() {}, warn() {} }, setTimeout, clearTimeout, AbortController,
      ETRANSPORT_BACKEND_BASE: BASE,
      fetch: (u, o) => {
        const c = { u, m: (o && o.method) || 'GET', h: (o && o.headers) || {},
          b: o && o.body ? JSON.parse(o.body) : null };
        calls.push(c);
        const [status, body] = routes(c);
        return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
      } };
    vm.runInNewContext(src, ctx);
    return { P: ctx.window.EHPublish, calls };
  }
  const CON = { widgets: { ls: { title: 'Т' } }, site: {} }, REG = { widgets: {} };

  const off = mk('', () => [500, {}]);
  check('G3.1 BASE хоосон → enabled=false, load=null, сүлжээ 0',
    off.P.enabled === false && (await off.P.load()) === null && off.calls.length === 0);

  /* Нийтлэл алга (404) → анхны нийтлэл baseVersion:null-тэй явна */
  const a = mk('https://x.test', (c) => c.m === 'GET' ? [404, { error: {} }]
    : [200, { version: 1, at: '2026-09-22T00:00:00Z' }]);
  const l0 = await a.P.load();
  check('G3.2 404 → load() null', l0 === null);
  check('G3.2 URL = BASE + /api/site-content', a.calls[0].u === 'https://x.test/api/site-content', a.calls[0].u);
  const r1 = await a.P.publish(CON, REG);
  const put = a.calls[1];
  check('G3.3 publish → PUT, Bearer токен', put.m === 'PUT' && put.h.Authorization === 'Bearer TOK');
  check('G3.3 404-ийн дараах нийтлэл baseVersion:null (өөр хүн хооронд нь нийтэлбэл 409)',
    put.b && 'baseVersion' in put.b && put.b.baseVersion === null, JSON.stringify(put.b && put.b.baseVersion));
  check('G3.3 content/registry ОБЪЕКТООР (мөр БИШ) явна',
    put.b.content.widgets.ls.title === 'Т' && typeof put.b.registry === 'object');
  check('G3.3 хариу {version:1}', r1.version === 1);
  await a.P.publish(CON, REG);
  check('G3.4 дараагийн нийтлэл шинэ суурь baseVersion:1-тэй', a.calls[2].b.baseVersion === 1);

  /* Нийтлэл байгаа (version 7) */
  const b = mk('https://x.test', (c) => c.m === 'GET'
    ? [200, { version: 7, content: CON, registry: null, meta: { at: 'T', by: 'a@b.mn' } }]
    : [409, { error: { message: 'Өөр хүн нийтэлсэн', latest: 9 } }]);
  const l1 = await b.P.load();
  check('G3.5 load → content объект, registry null, meta.version 7',
    l1 && l1.content.widgets.ls.title === 'Т' && l1.registry === null && l1.meta.version === 7 && l1.meta.by === 'a@b.mn');
  let e409 = null; try { await b.P.publish(CON, REG); } catch (e) { e409 = e; }
  check('G3.6 baseVersion:7 илгээгээд 409 → backend-ийн мессеж хэрэглэгчид хүрнэ',
    b.calls[1].b.baseVersion === 7 && e409 && e409.message === 'Өөр хүн нийтэлсэн', e409 && e409.message);

  /* Уншилт амжилтгүй (сүлжээ) → baseVersion илгээхгүй (шалгалтгүй) */
  const c = mk('https://x.test', (q) => q.m === 'GET' ? [500, null] : [200, { version: 3 }]);
  await c.P.load(); await c.P.publish(CON, REG);
  check('G3.7 уншилт 500 → load null, нийтлэлд baseVersion ОГТ байхгүй',
    !('baseVersion' in c.calls[1].b));

  /* canPublish */
  const d = mk('https://x.test', (q) => q.u.endsWith('/me') ? [200, { canPublish: true }] : [404, {}]);
  check('G3.8 canPublish → /me, true', (await d.P.canPublish()) === true &&
    d.calls[0].u === 'https://x.test/api/site-content/me' && d.calls[0].h.Authorization === 'Bearer TOK');
  const d2 = mk('https://x.test', () => [403, {}]);
  check('G3.8 /me 403 → false', (await d2.P.canPublish()) === false);
  const d3 = mk('https://x.test', () => [200, { canPublish: true }], null);
  check('G3.8 нэвтрээгүй → false, сүлжээ 0', (await d3.P.canPublish()) === false && d3.calls.length === 0);
  let eNo = null; try { await d3.P.publish(CON, REG); } catch (e) { eNo = e; }
  check('G3.9 нэвтрээгүй publish → "Нэвтрээгүй" алдаа', eNo && /Нэвтрээгүй/.test(eNo.message));
  const f = mk('https://x.test', (q) => q.m === 'GET' ? [200, { version: 2, content: [1], registry: 'x' }] : [200, {}]);
  check('G3.10 хэлбэр буруу content/registry → load null (сайт файлаараа)', (await f.P.load()) === null);

  /* ── G3.11 layer() — ГАРААР БОДОХ фикстур ── */
  const lay = off.P.layer;
  check('G3.11 layer экспортлогдсон', typeof lay === 'function');
  const F = { a: 1, site: { x: 'файл', y: 'файл-y' }, arr: [1, 2, 3], keep: { z: 1 } };
  const O = { a: 2, site: { x: 'нийтлэл' }, arr: [9], extra: 'o' };
  const R = lay(F, O);
  check('G3.11 нийтлэлийн утга ялна (a=2, site.x)', R.a === 2 && R.site.x === 'нийтлэл');
  check('G3.11 нийтлэлд алга түлхүүр файлаас үлдэнэ (site.y, keep.z)', R.site.y === 'файл-y' && R.keep.z === 1);
  check('G3.11 массивыг БҮТНЭЭР солино (индексээр холихгүй)', JSON.stringify(R.arr) === '[9]');
  check('G3.11 зөвхөн нийтлэлд буй түлхүүр хадгалагдана', R.extra === 'o');
  check('G3.11 түлхүүрийн дараалал файлынхаар', Object.keys(R).join() === 'a,site,arr,keep,extra', Object.keys(R).join());
  check('G3.11 оролтыг ӨӨРЧЛӨХГҮЙ', F.site.x === 'файл' && F.a === 1 && O.site.y === undefined);
  check('G3.11 null нийтлэл нь утга (слот салгах) — файлынхыг дарна',
    lay({ m: { metric: 'air.x' } }, { m: { metric: null } }).m.metric === null);
  check('G3.11 хэлбэр зөрвөл нийтлэл ялна (объект ↔ мөр)', lay({ t: { a: 1 } }, { t: 's' }).t === 's');

  /* ── G3.12 РЕГРЕСС (2026-09-22): нийтлэл version 1 нь status.rail_wagon_asof /
     rail_wagon_stale нэмэгдэхээс ӨМНӨХ снапшот. Хуучин код site{}-ийг
     бүтнээр сольдог тул эдгээр түлхүүр амьд сайт ба админд алга болж,
     дараагийн нийтлэлээр бүр мөсөн хаягдах байв. */
  const fileCon = readJson('content.json');
  const v1 = JSON.parse(JSON.stringify(fileCon));
  delete v1.site.status.rail_wagon_asof; delete v1.site.status.rail_wagon_stale;
  v1.site.status.no_data = 'НИЙТЭЛСЭН: алга';
  const lc = lay(fileCon, v1);
  check('G3.12 git-ээр нэмсэн түлхүүр нийтлэлийн дараа ч үлдэнэ',
    !!fileCon.site.status.rail_wagon_asof &&
    lc.site.status.rail_wagon_asof === fileCon.site.status.rail_wagon_asof &&
    lc.site.status.rail_wagon_stale === fileCon.site.status.rail_wagon_stale);
  check('G3.12 нийтэлсэн засвар хэвээр ялна', lc.site.status.no_data === 'НИЙТЭЛСЭН: алга');
  check('G3.12 site{}-ийн бүлгүүд бүрэн (түлхүүр тоо файлынхтай тэнцүү)',
    Object.keys(lc.site).length === Object.keys(fileCon.site).length);

  /* ── G3.13 Сайт ба админ ХОЁУЛАА ижил layer-ийг ашиглана ── */
  const idxS = read('index.html'), admS = read('admin/index.html');
  check('G3.13 админ нийтлэлийг файлын ДЭЭР давхарлана (бүтнээр солихгүй)',
    admS.includes('CON=lay(CON,pub.content)') && admS.includes('REG=lay(REG,pub.registry)') &&
    !admS.includes('CON=pub.content;') && !admS.includes('REG=pub.registry;'));
  check('G3.13 сайт EHPublish.layer-ээр давхарлана',
    idxS.includes('return EHPublish.layer(f,p);') && !idxS.includes('SITE_TEXT=(pub.content&&pub.content.site)'));

  /* ── G3.14 ДАРААЛЛААС ҮЛ ХАМААРНА — нийтлэл ТҮРҮҮЛЖ, файл ХОЖУУ ──
     Регресс: loadContent ба loadPublished зэрэг эхэлдэг. Хуучин код
     файл хожуу ирвэл SITE_TEXT-ийг файлаар ДАРЖ нийтлэлийг устгадаг байв. */
  const dcs = dcScript().split(CR_LF).join(NLc);
  const body = (name) => { const i = dcs.indexOf(NLc + '  ' + name + '('); if (i < 0) return null;
    const k = dcs.indexOf('{', i); const j = dcs.indexOf(NLc + '  }' + NLc, i); return dcs.slice(k + 1, j); };
  const bL = body('layerOf'), bC = body('applyContentLayers'), bR = body('applyRegistryLayers');
  if (!bL || !bC || !bR) { bad('G3.14 layerOf/applyContentLayers/applyRegistryLayers олдсонгүй'); return; }
  const mkComp = () => {
    const st = { SITE_TEXT: null, applied: 0 };
    const comp = { state: {}, setState(o) { Object.assign(this.state, o); }, reapplyLiveText() { st.applied++; } };
    comp.layerOf = new Function('EHPublish', 'return function(f,p){' + bL + '}')({ layer: lay });
    comp.applyContentLayers = new Function('ST', 'applySiteContent', 'return function(){' +
      bC.split('SITE_TEXT=').join('ST.SITE_TEXT=') + '}')(st, () => {});
    comp.applyRegistryLayers = new Function('return function(){' + bR + '}')();
    return { comp, st };
  };
  const FILE = { site: { a: 'файл', b: 'файл-b' } }, PUB = { site: { a: 'нийтлэл' } };
  const X = mkComp();
  X.comp._pubContent = PUB; X.comp.applyContentLayers();
  X.comp._fileContent = FILE; X.comp.applyContentLayers();
  check('G3.14 нийтлэл түрүүлж, файл хожуу ирсэн ч нийтлэл ЯЛНА',
    X.st.SITE_TEXT.a === 'нийтлэл' && X.st.SITE_TEXT.b === 'файл-b', JSON.stringify(X.st.SITE_TEXT));
  const Y = mkComp();
  Y.comp._fileContent = FILE; Y.comp.applyContentLayers();
  Y.comp._pubContent = PUB; Y.comp.applyContentLayers();
  check('G3.14 урвуу дараалалд ижил үр дүн',
    JSON.stringify(Y.st.SITE_TEXT) === JSON.stringify(X.st.SITE_TEXT) && Y.st.applied === 2);
  const Z = mkComp();
  Z.comp._fileRegistry = { widgets: { u07: { sectors: { air: { metric: 'a' }, rail: { metric: 'r' } } } } };
  Z.comp._pubRegistry = { widgets: { u07: { sectors: { air: { metric: null } } } } };
  Z.comp.applyRegistryLayers();
  const zs = Z.comp.state.metricRegistry.widgets.u07.sectors;
  check('G3.14 registry: нийтэлсэн салгалт ялж, git-ийн шинэ слот үлдэнэ',
    zs.air.metric === null && zs.rail.metric === 'r', JSON.stringify(zs));

  /* ══ G3.15–G3.17 ЗӨРҮҮГЭЭР НИЙТЛЭХ (EHPublish.diff) ══
     Регресс (2026-09-22, амьд сайт дээр илэрсэн): админ content/registry-г
     БҮТНЭЭР нийтэлдэг байв. version 1 нь тухайн үеийн git-тэй 0 зөрүүтэй
     registry хуулбар атал, дараа нь git-д нэмэгдсэн t05 (хавтгай → салбарын
     слот) ба i06/r06-ийн rail холбоосыг амьд сайт дээр ДАРЖ байв. Content ч
     мөн адил: ганц жинхэнэ засвар (ui.badge.live_service) атал git-ийн 6
     замыг далдалж байв. */
  const DP = mk('https://x.test', () => [200, { version: 2 }]).P;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('G3.15 diff: өөрчлөлтгүй → undefined (давхарга ҮҮСЭХГҮЙ)',
    DP.diff({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } }) === undefined);
  check('G3.15 diff: түлхүүрийн дараалал өөр ч утга ижил → undefined',
    DP.diff({ a: 1, b: 2 }, { b: 2, a: 1 }) === undefined);
  check('G3.15 diff: зөвхөн өөрчилсөн навч',
    same(DP.diff({ ui: { badge: { live: 'амьд · вэб сервис', mock: 'түр' } } },
      { ui: { badge: { live: 'амьд · вэб сервисээр', mock: 'түр' } } }),
    { ui: { badge: { live: 'амьд · вэб сервисээр' } } }));
  check('G3.15 diff: шинэ түлхүүр бүтнээрээ', same(DP.diff({ a: 1 }, { a: 1, n: { x: 1 } }), { n: { x: 1 } }));
  check('G3.15 diff: массив өөрчлөгдвөл БҮТНЭЭР (layer массивыг солидог)',
    same(DP.diff({ q: ['a', 'b'] }, { q: ['a', 'c'] }), { q: ['a', 'c'] }));
  /* Буцах чадвар: layer(base, diff(base, cur)) === cur */
  const CASES = [
    [{ w: { t05: { sectors: { air: { m: 'a' } } } } }, { w: { t05: { sectors: { air: { m: 'a' }, rail: { m: 'r' } } } } }],
    [{ a: [1, 2], b: { c: 1 } }, { a: [3], b: { c: 1, d: null } }],
    [{ s: 'x' }, { s: 'x' }],
  ];
  check('G3.16 layer(base, diff(base,cur)) === cur (3 тохиолдол)',
    CASES.every(([b, c]) => same(DP.layer(b, DP.diff(b, c)), c)));

  /* Бодит сценари: админ ЮУ Ч засаагүй → registry нийтлэгдэхгүй (null) тул
     git-ийн ДАРААГИЙН өөрчлөлт амьд сайт дээр харагдана. */
  const FILE_OLD = { widgets: { t05: { metric: 'air.monthly_flight_series', sectors: ['air'] }, i06: { sectors: ['air'] } } };
  const FILE_NEW = { widgets: { t05: { sectors: { air: { metric: 'air.monthly_flight_series' }, rail: { metric: 'rail.monthly_passenger_series' } } },
    i06: { sectors: ['air', 'rail'] } } };
  const adminUntouched = JSON.parse(JSON.stringify(FILE_OLD));
  const overlayOld = DP.diff(FILE_OLD, adminUntouched);           // ЗАСВАРГҮЙ нийтлэл
  const liveAfterGit = DP.layer(FILE_NEW, overlayOld);             // git шинэчлэгдсэний дараа
  check('G3.16 засваргүй нийтлэл → registry давхарга ҮҮСЭХГҮЙ', overlayOld === undefined);
  check('G3.16 дараагийн git өөрчлөлт (t05 rail, i06 rail) амьд сайтад ХҮРНЭ',
    liveAfterGit.widgets.t05.sectors.rail.metric === 'rail.monthly_passenger_series' &&
    same(liveAfterGit.widgets.i06.sectors, ['air', 'rail']), JSON.stringify(liveAfterGit.widgets.t05));
  /* Хуучин (бүтэн хуулбар) арга яг энэ алдааг гаргадгийг баримтжуулна */
  const liveOldWay = DP.layer(FILE_NEW, adminUntouched);
  check('G3.16 ХУУЧИН бүтэн хуулбар нь git-ийн шинэ t05/i06-г ДАРДАГ байсан (регрессийн баримт)',
    Array.isArray(liveOldWay.widgets.t05.sectors) && same(liveOldWay.widgets.i06.sectors, ['air']));
  /* Админы ЖИНХЭНЭ засвар хадгалагдана */
  const adminEdited = JSON.parse(JSON.stringify(FILE_OLD)); adminEdited.widgets.i06.hidden = true;
  const ov2 = DP.diff(FILE_OLD, adminEdited);
  check('G3.16 жинхэнэ засвар л давхаргад орж, git-ийн шинэ утгатай нийлнэ',
    same(ov2, { widgets: { i06: { hidden: true } } }) &&
    DP.layer(FILE_NEW, ov2).widgets.i06.hidden === true && same(DP.layer(FILE_NEW, ov2).widgets.i06.sectors, ['air', 'rail']));

  /* ── G3.17 Админ ЗӨРҮҮГЭЭР нийтэлнэ ── */
  check('G3.17 админ git файлын суурийг (REGF/CONF) давхаргагүйгээр хадгална',
    /REGF=clone\(REG\);CONF=clone\(CON\);/.test(admS) && /var REGF=null, CONF=null;/.test(admS));
  check('G3.17 нийтлэл = diff(файл, одоогийн) — бүтэн хуулбар БИШ',
    /var dCon=pubDiff\(CONF,CON\), dReg=pubDiff\(REGF,REG\);/.test(admS) &&
    /EHPublish\.publish\(pCon,pReg\)/.test(admS) && !/EHPublish\.publish\(CON,REG\)/.test(admS));
  check('G3.17 content-д widgets{} үргэлж (PUT шалгалт), registry өөрчлөлтгүй бол null',
    /var pCon=Object\.assign\(\{widgets:\{\}\},dCon\|\|\{\}\);/.test(admS) &&
    /var pReg=dReg\?Object\.assign\(\{widgets:\{\}\},dReg\):null;/.test(admS));
}

/* ══════════════════════════════════════════════════════════════════
   G4. ЛОКАЛ ХУУРАМЧ BACKEND (scripts/mock-publish.js · js/publish-mock.js)

   Тестийн агент "Сайтад нийтлэх"-ийг дарж чаддаггүй байв: Google нэвтрэлт
   + portal_admins + амьд сайт руу бичилт. Mock нь урсгалыг бүтэн (нэвтрэх
   → нийтлэх → сайт дээр харагдах → 409) локалд дуусгах боломж өгнө.
   Энд (а) mock нь жинхэнэ backend-ийн гэрээг давтаж буйг, (б) клиент
   талын mock амьд хаяг дээр ЮУ Ч ХИЙХГҮЙг шалгана.
   ══════════════════════════════════════════════════════════════════ */
async function groupG4() {
  group('G4. Локал хуурамч нийтлэлийн backend');
  const vm = require('vm');
  const { createMockPublish, TOKEN, TOKEN_NOPERM } = require('../scripts/mock-publish');
  const mock = createMockPublish();
  const srv = http.createServer((q, s) => { if (!mock.handle(q, s)) { s.writeHead(404); s.end(); } });
  const port = listenFree(srv);
  const U = 'http://127.0.0.1:' + port + '/api/site-content';
  const req = (method, url, tok, body) => fetch(url, {
    method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  try {
    let r = await req('GET', U);
    check('G4.1 нийтлэлгүй үед GET → 404', r.status === 404, r.status);
    r = await req('GET', U + '/me', TOKEN);
    check('G4.2 /me: админ токен → canPublish=true', r.body && r.body.canPublish === true, JSON.stringify(r.body));
    r = await req('GET', U + '/me', TOKEN_NOPERM);
    check('G4.3 /me: эрхгүй токен → canPublish=false', r.body && r.body.canPublish === false, JSON.stringify(r.body));
    r = await req('PUT', U, null, { content: {} });
    check('G4.4 токенгүй PUT → 401', r.status === 401, r.status);
    r = await req('PUT', U, TOKEN_NOPERM, { content: {} });
    check('G4.5 эрхгүй PUT → 403', r.status === 403, r.status);
    r = await req('PUT', U, TOKEN, { content: { a: 1 }, registry: { b: 2 }, baseVersion: null });
    check('G4.6 анхны нийтлэл → version 1', r.status === 200 && r.body.version === 1, JSON.stringify(r.body));
    r = await req('PUT', U, TOKEN, { content: { a: 9 }, baseVersion: null });
    check('G4.7 хуучин baseVersion → 409 (амьд өөрчлөлтийг дарахгүй)', r.status === 409, r.status);
    r = await req('PUT', U, TOKEN, { content: { a: 2 }, registry: null, baseVersion: 1 });
    check('G4.8 registry=null → өмнөхийг хуулна, version 2', r.status === 200 && r.body.version === 2 &&
      mock.versions[1].registry.b === 2 && mock.versions[1].content.a === 2, JSON.stringify(mock.versions[1]));
    r = await req('GET', U);
    check('G4.9 GET сүүлийн нийтлэлийг буцаана', r.body && r.body.version === 2 && r.body.content.a === 2,
      JSON.stringify(r.body));
    await req('DELETE', U);
    r = await req('GET', U);
    check('G4.10 DELETE санах ойг цэвэрлэнэ', r.status === 404, r.status);
  } finally { srv.close(); }

  /* Клиент тал: publish-mock.js-ийг хост/хаяг бүрээр vm-д ажиллуулна */
  const src = read('js/publish-mock.js');
  function runClient(host, search, dataAuth) {
    const store = {};
    const w = {
      location: { hostname: host, search, origin: 'http://' + host + ':8090' },
      sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; } },
      document: { currentScript: { getAttribute: (a) => (a === 'data-auth' && dataAuth ? '1' : null) } },
      URLSearchParams, console: { info() {} }, setTimeout, Promise, auth: 'REAL'
    };
    w.window = w;
    vm.runInNewContext(src, w);
    return w;
  }
  let w = runClient('otgonerdene02-cmyk.github.io', '?mockpub=1', true);
  check('G4.11 амьд хост дээр ?mockpub=1 ЮУ Ч ХИЙХГҮЙ', !w.EH_PUBLISH_BASE && w.auth === 'REAL');
  w = runClient('portal.mrt.gov.mn', '?mockpub=1', true);
  check('G4.12 portal.mrt.gov.mn дээр ч идэвхгүй', !w.EH_PUBLISH_BASE && w.auth === 'REAL');
  w = runClient('localhost', '', true);
  check('G4.13 localhost ч ?mockpub-гүй бол идэвхгүй', !w.EH_PUBLISH_BASE && w.auth === 'REAL');
  w = runClient('localhost', '?mockpub=1', false);
  check('G4.14 сайт (data-auth-гүй): base солигдоно, auth ХӨНДӨГДӨХГҮЙ',
    w.EH_PUBLISH_BASE === 'http://localhost:8090' && w.auth === 'REAL');
  w = runClient('localhost', '?mockpub=1', true);
  const a = w.auth;
  const seen = [];
  a.onAuthStateChanged((u) => seen.push(u && u.email));
  await new Promise((res) => setTimeout(res, 5));
  await a.signInWithPopup();
  const tok = await a.currentUser.getIdToken();
  check('G4.15 админ: эхэндээ гарсан → Нэвтрэх дармагц админ болно',
    seen[0] === null && seen[1] === 'mock-admin@localhost' && tok === TOKEN, JSON.stringify(seen));
  w = runClient('127.0.0.1', '?mockpub=viewer', true);
  await w.auth.signInWithPopup();
  check('G4.16 ?mockpub=viewer → эрхгүй токен', (await w.auth.currentUser.getIdToken()) === TOKEN_NOPERM);

  const idx = read('index.html'), adm = read('admin/index.html');
  const before = (h, x, y) => h.indexOf(x) >= 0 && h.indexOf(x) < h.indexOf(y);
  check('G4.17 ачаалах дараалал: backend-config → publish-mock → erthub-publish (хоёр хуудас)',
    before(idx, 'js/backend-config.js', 'js/publish-mock.js') && before(idx, 'js/publish-mock.js', 'js/erthub-publish.js') &&
    before(adm, '../js/backend-config.js', '../js/publish-mock.js') && before(adm, '../js/publish-mock.js', '../js/erthub-publish.js'));
  check('G4.18 зөвхөн админ auth-ыг солино (data-auth="1")',
    /publish-mock\.js" data-auth="1"/.test(adm) && !/publish-mock\.js" data-auth/.test(idx));
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
    /* Монгол нэр ЗААВАЛ (UX QA T1) — нэргүй метрик нэмэгдэхгүй. Нэргүй
       үеийн татгалзлыг S6 тусад нь шалгана. */
    const nmIn=d.getElementById('mNewName'); if(nmIn){ nmIn.value='H4 туршилтын метрик'; nmIn.dispatchEvent(new w.Event('input',{bubbles:true})); }
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
  const pvT=()=>{const e=d.querySelector('#pvhost [data-ed="title"]');return e?e.textContent.trim():null};
  const pickField=(q)=>{const sl2=d.querySelector(q), og2=sl2?sl2.querySelector('optgroup'):null;
    if(!og2) return null;
    const o2=[].slice.call(og2.querySelectorAll('option'))
      .filter(function(o){return o.value.indexOf('field:|')!==0})[0];
    if(!o2) return null;
    sl2.value=o2.value; sl2.dispatchEvent(new w.Event('change',{bubbles:true}));
    return o2.value};
  /* 1) Гарчиг нь тооны ШОШГО болдог виджет (hero_fl · "НИСЛЭГ / САР") —
        САНАЛ ГАРНА, гарчгийн талбар ХАРААХАН хэвээр */
  d.querySelector('[data-section="hero"]').click(); await sleep(600);
  d.querySelector('[data-widget="hero_fl"]').click(); await sleep(900);
  if(!pickField('[data-slot^="hero_fl|"]')) return {__err:'hero_fl талбарын бүлэг олдсонгүй'};
  await sleep(1100);
  const btn=d.querySelector('[data-autoname]');
  R.hasSuggestion=!!btn;
  R.suggest=btn?btn.getAttribute('data-autoname'):null;
  R.titleBefore=pvT();
  R.fieldBefore=(d.querySelector('[data-tf="title"]')||{}).value;
  if(btn){ btn.click(); await sleep(700); }
  R.titleAfter=pvT();
  R.fieldAfter=(d.querySelector('[data-tf="title"]')||{}).value;
  /* 2) ХЭСГИЙН гарчигтай виджет (w2pb · "Төрлийн хуваарь · 7 хоног") —
        автомат нэр САНАЛ БОЛГОХ ЁСГҮЙ (гарчиг нь тоог тайлбарладаггүй) */
  let bk,bn=0; while((bk=d.querySelector('[data-back]'))&&bn++<6) bk.click();
  d.querySelector('[data-section="sec-02"]').click(); await sleep(600);
  d.querySelector('[data-widget="w2pb"]').click(); await sleep(900);
  if(!pickField('[data-slot^="w2pb|"]')) return {__err:'w2pb талбарын бүлэг олдсонгүй'};
  await sleep(1100);
  R.headingSuggestion=!!d.querySelector('[data-autoname]');
  /* 3) Талбар дээр очиход preview тодрох */
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
    check('I7. Утга сольсны дараа гарчгийн САНАЛ гарна (шошго-гарчиг)',
      R.hasSuggestion === true, String(R.suggest));
    check('I7. Санал нь ХУГАЦААНЫ хэсгийг хадгална (… / САР)',
      typeof R.suggest === 'string' && R.suggest.indexOf(' / ') > 0 &&
      R.suggest.indexOf('(') < 0, String(R.suggest));
    check('I7. ХЭСГИЙН гарчигтай виджетэд автомат нэр САНАЛ БОЛГОХГҮЙ',
      R.headingSuggestion === false, String(R.headingSuggestion));
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
  check('L4. Каталог "Дата холболт" табд холбогдсон', adm.includes("'<div id=\"mt-ds\">'+lvDatasets()"));

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
  check('M4. Каталог "Дата холболт" табд холбогдсон', adm.includes("'<div id=\"mt-svc\">'+lvServices()"));

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
  /* Регресс (browser, 2026-09-21): 375px-д livestrip-ийн 5 нүд бүр ~59px,
     хөл бичгийн сав 36px болж огноо/хоцролтын тэмдэглэл бүр таслагдаж
     байв. Desktop-ын lsCols гэрээг ХӨНДӨХГҮЙ — зөвхөн нарийн дэлгэцэд. */
  const css = read('style.css');
  check('N1. Livestrip нарийн дэлгэцэд мөр нэмнэ (auto-fit, desktop-ыг хөндөхгүй)',
    idx.includes('class="eh-ls-grid" style="display:grid;grid-template-columns:repeat({{ lsCols }}') &&
    css.includes('@media (max-width: 1100px) {') &&
    css.includes('.eh-ls-grid { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)) !important; }'));
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
      /* N5 — бичсэн ч «Хэрэглэх» дараагүй үед hint "Өөрчлөлт алга" гэж
         худал хэлдэг байв (амьд туршилтад агент гацсан). render()-гүйгээр
         бичих ДАРУЙД солигдох ёстой. */
      const hint=()=>(d.getElementById('saveHint')||{}).textContent||'';
      const ti=d.querySelector('[data-tf="title"]');
      if(ti){
        const orig=ti.value;
        ti.value='ZZPENDZZ'; ti.dispatchEvent(new w.Event('input',{bubbles:true}));
        R.hintPend=hint();
        const sv=d.querySelector('[data-tsave]'); if(sv) sv.click(); await sleep(400);
        R.hintApplied=hint();
        const t2=d.querySelector('[data-tf="title"]');
        t2.value=orig; t2.dispatchEvent(new w.Event('input',{bubbles:true}));
        const sv2=d.querySelector('[data-tsave]'); if(sv2&&!sv2.disabled) sv2.click(); await sleep(400);
        R.hintBack=hint();
      }
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
    const pendTxt = con.ui.save.hint_pending;
    check('N5. Бичсэн даруйд (Хэрэглэх-ээс ӨМНӨ) hint «Хэрэглэх»-ийг заана',
      !!R.hintPend && R.hintPend.includes(pendTxt), R.hintPend);
    check('N5. «Хэрэглэх» дарсны дараа pending заавар арилна',
      !!R.hintApplied && !R.hintApplied.includes(pendTxt) && /Дараагийн алхам/.test(R.hintApplied), R.hintApplied);
    check('N5. Буцааж анхны утгад оруулахад "Өөрчлөлт алга" руу буцна',
      !!R.hintBack && R.hintBack.includes(con.ui.save.hint_clean), R.hintBack);
    check('N5. Нийтлэх товчны тайлбар хэрэглээгүй ноорогт «Хэрэглэх»-ийг заана',
      adm.includes("if(pendingCount()) return utxt('publish.need_apply'"));
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
    adm.includes('var invHtml=lvInventory();') && /* Тоймын ард ШУУД — дата сан бусад хэсгээс өмнө */
    adm.includes("return toc+'<div id=\"mt-inv\">'+invHtml+'</div>'"));

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

/* ══════════════════════════════════════════════════════════════════
   R. API ЛАВЛАХ, БАРИМТЫН ХУУДАС БА НИЙТЛЭГ ҮГ

   Хуудсуудын сүүлчийн үлдэгдэл бичиг. Онцлох нь: "Илгээх" гэсэн ганц
   үг ДӨРВӨН өөр газар хатуу бичигдсэн байв. Тус бүрд нь тусдаа
   түлхүүр үүсгэвэл засварлагч нэг үгийг дөрвөн газар засах болно —
   иймд НЭГ түлхүүр, үндсэн түвшинд.
     R1. Нийтлэг үг нэг эх сурвалжтай
     R2. API лавлахын хүснэгт ба хөгжүүлэгчийн бичиг content.json-д
     R3. Баримтын дэлгэрэнгүй хуудасны бичиг content.json-д
     R4. Хатуу бичсэн текст ҮЛДЭЭГҮЙ
   ══════════════════════════════════════════════════════════════════ */
function groupR() {
  group('R. API лавлах, баримт ба нийтлэг үг');
  const idx = read('index.html'), adm = read('admin/index.html'), con = readJson('content.json');

  check('R1. "Илгээх" НЭГ түлхүүрээр, дөрвүүлэнд нь',
    (idx.match(/\{\{ t\.send \}\}/g) || []).length >= 4 &&
    idx.includes("t:{send:stxt('common.send','Илгээх')}"),
    'дөрвөн газар тус тусдаа бичигдсэн хэвээр');
  check('R1. Нийтлэг үг content.json-д', !!(con.site.common && con.site.common.send));

  check('R2. API лавлахын бичиг stxt()-ээр',
    ["browse.h_method", "browse.h_desc", "browse.h_freq", "browse.h_use",
      "browse.start_head", "browse.tier_head", "browse.more"]
      .every((k) => idx.includes("stxt('" + k + "'")));
  check('R3. Баримтын хуудасны бичиг stxt()-ээр',
    ["doc.read", "doc.share", "doc.your_rating", "doc.same_cat", "doc.reviews",
      "doc.cite", "doc.license", "doc.export", "doc.license_note", "doc.demo_note"]
      .every((k) => idx.includes("stxt('" + k + "'")));
  check('R3. Баримтын бичиг нэг объектоор холбогдоно',
    idx.includes('{{ docDetail.t.read }}') && idx.includes('{{ docDetail.t.demoNote }}'));

  check('R2/R3. Админд гурван шинэ бүлэг',
    ["{key:'common', title:'Нийтлэг үг'",
      "{key:'doc', title:'Баримтын дэлгэрэнгүй хуудас'",
      "{key:'browse', title:'Нээлттэй өгөгдөл · API лавлах'"]
      .every((t) => adm.includes(t)));

  check('R4. Хатуу бичсэн текст ҮЛДЭЭГҮЙ',
    ['>Илгээх</button>', '<div>Метод</div>', '>Онлайн унших</div>',
      '>Эшлэл (APA)</div>', '>Ижил ангиллын баримтууд</div>']
      .every((t) => !idx.includes(t)),
    'хатуу бичсэн текст үлдсэн');
}

/* ══════════════════════════════════════════════════════════════════
   S. UX QA-ИЙН 5 ЗАСВАР (qa-backlog.md)

   Техникийн мэдлэггүй хэрэглэгчийн нүдээр хийсэн QA тестээс гарсан:
     S1 (T1 Major). "+ Шинэ метрик" нь ЗӨВХӨН төлөвлөгөө нэмдэг ч
         "Холбогдлоо:" гэсэн ХУДАЛ мэдэгдэл гардаг байв. Мөн монгол
         нэр хоосон үед шалгалт алга.
     S2 (T2 Major). Чанарын шүүлтэд "Verified" / "Mock" гэсэн англи үг
         хатуу бичигдсэн — зэргэлдээх сонголтууд монгол.
     S3 (T3 Minor). "Виджеттэй холбох (MAP)" — тайлбаргүй товчлол,
         53 мөр бүр дээр давтагддаг.
     S4 (T4 Minor). Гарчигт "content.json → site" гэсэн файлын зам
         (uppercase болж "CONTENT.JSON → SITE" гэж гардаг).
     S5 (T5 Minor). Каталогийн мод дахь ✓ / ! / ✕ тэмдэгт тайлбаргүй.
   ══════════════════════════════════════════════════════════════════ */
async function groupS() {
  group('S. UX QA засвар (T1–T5)');
  const adm = read('admin/index.html'), con = readJson('content.json');

  /* ── S1 ── */
  const addStart = adm.indexOf("if(t.closest&&t.closest('[data-madd]')){");
  const addBlock = addStart >= 0 ? adm.slice(addStart, adm.indexOf('return}', adm.indexOf("log(newKey,", addStart)) + 7) : '';
  check('S1. Төлөвлөгөөт метрик нэмэхэд "Холбогдлоо" гэж хэлэхгүй',
    !!addBlock && !addBlock.includes("utxt('toast.bound'") &&
    addBlock.includes("utxt('toast.metric_planned'"),
    'төлөвлөгөө нэмэхэд холболтын мэдэгдэл гарсаар байна');
  check('S1. "toast.bound" жинхэнэ холболтод хэвээр',
    (adm.match(/utxt\('toast\.bound'/g) || []).length >= 2);
  check('S1. Монгол нэр хоосон үед шалгана',
    addBlock.includes("utxt('metrics_tab.name_required'"),
    'нэр хоосон ч метрик нэмэгдэнэ');
  check('S1. Шинэ мессеж content.json-д',
    !!(con.ui.toast.metric_planned && con.ui.metrics_tab.name_required));

  /* ── S2 ── */
  check('S2. Чанарын шүүлтэд англи үг ХАТУУ бичигдээгүй',
    !adm.includes('>Verified</option>') && !adm.includes('>Mock</option>'),
    'Verified / Mock хэвээр');
  check('S2. Сонголт utxt()-ээр, filter.* ах дүү түвшинд',
    adm.includes("utxt('filter.verified'") && adm.includes("utxt('filter.mock'") &&
    typeof con.ui.filter.quality === 'string' &&
    typeof con.ui.filter.verified === 'string' && typeof con.ui.filter.mock === 'string',
    'filter.quality мөр хэвээр байх ёстой — дэд түлхүүр болговол эвдэрнэ');
  check('S2. Сонголтын үгэнд латин үсэг алга',
    !/[A-Za-z]/.test(con.ui.filter.verified + con.ui.filter.mock));

  /* ── S3 ── */
  check('S3. "(MAP)" товчлол ҮЛДЭЭГҮЙ',
    !/\(MAP\)/.test(con.ui.inv.map) && !/\(MAP\)/.test(con.ui.inv.note) &&
    !adm.includes("utxt('inv.map','Виджеттэй холбох (MAP)')") &&
    !adm.includes('виджеттэй холбоод (MAP)'),
    'товчлол хэвээр');

  /* ── S4 ── */
  check('S4. Гарчигт файлын зам ҮЛДЭЭГҮЙ',
    !/content\.json/i.test(con.ui.site_tab.heading) &&
    !adm.includes("utxt('site_tab.heading','Сайтын текст · content.json → site')"),
    con.ui.site_tab.heading);
  check('S4. Гарчгийн дэргэдэх тоо шошготой',
    adm.includes("utxt('site_tab.count_word'") && !!con.ui.site_tab.count_word);

  /* ── S5 ── */
  check('S5. ✓ / ! / ✕ тэмдэгт тайлбартай (title + aria-label)',
    adm.includes("utxt('left.status_ok'") && adm.includes("utxt('left.status_mix'") &&
    adm.includes("utxt('left.status_no'") &&
    /<span class="st '\+cls\+'" role="img" title="'\+esc\(stl\)\+'" aria-label="'\+esc\(stl\)\+'">/.test(adm),
    'тэмдэгт тайлбаргүй');
  check('S5. Тайлбарын үг дээд тоолууртай ЯГ ижил',
    con.ui.left.status_ok === 'Бүрэн холбогдсон' &&
    con.ui.left.status_mix === 'Хэсэгчлэн холбогдсон' &&
    con.ui.left.status_no === 'Холбогдоогүй');

  if (!CHROME) { skipped('S6. QA засвар (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(4500);
      const R={};
      /* S5 — модны тэмдэгт */
      const st=d.querySelector('#dsList .st');
      R.stTitle=st?(st.getAttribute('title')||''):'';
      R.stAria=st?(st.getAttribute('aria-label')||''):'';
      /* S2 — чанарын шүүлт (хэсэг сонгоод виджетийн түвшинд гарна) */
      const sec=d.querySelector('[data-section]');
      if(sec){ sec.click(); await sleep(900) }
      const fq=d.getElementById('fQuality');
      R.qOpts=fq?[...fq.options].map(o=>o.text):[];
      /* S1 — төлөвлөгөөт метрик нэмэх */
      d.querySelector('[data-tab="metrics"]').click(); await sleep(1300);
      const k=d.getElementById('mNewKey'), nm=d.getElementById('mNewName');
      const add=d.querySelector('[data-madd]');
      if(!k||!add) return {__err:'метрик нэмэх маягт алга'};
      k.value='qa.test_planned'; if(nm) nm.value='';
      add.click(); await sleep(400);
      R.toastNoName=(d.getElementById('toast')||{}).textContent||'';
      R.addedNoName=d.querySelectorAll('[data-metric="qa.test_planned"]').length;
      const k2=d.getElementById('mNewKey'), nm2=d.getElementById('mNewName');
      k2.value='qa.test_planned'; nm2.value='QA туршилтын метрик';
      d.querySelector('[data-madd]').click(); await sleep(400);
      R.toastOk=(d.getElementById('toast')||{}).textContent||'';
      R.added=d.querySelectorAll('[data-metric="qa.test_planned"]').length;
      /* S3 — MAP товч */
      R.mapBtn=((d.querySelector('[data-invopen]')||{}).textContent||'').trim();
      return R;
    }`, 90000);
    if (R.__err) { bad('S6. QA засварын DOM шалгалт', R.__err); return; }
    check('S6. Модны тэмдэгт title ба aria-label-тай',
      /холбогдсон|Холбогдоогүй/.test(R.stTitle) && R.stTitle === R.stAria,
      JSON.stringify({ title: R.stTitle, aria: R.stAria }));
    check('S6. Чанарын шүүлтэд англи үг гарахгүй',
      R.qOpts.length >= 3 && R.qOpts.every((t) => !/[A-Za-z]/.test(t)),
      R.qOpts.join(' | '));
    check('S6. Нэргүй метрик нэмэгдэхгүй, шалтгааныг хэлнэ',
      R.addedNoName === 0 && /нэр/i.test(R.toastNoName), R.toastNoName);
    check('S6. Төлөвлөгөө нэмэхэд "Холбогдлоо" гэж ХЭЛЭХГҮЙ',
      R.added === 1 && !/Холбогдлоо/.test(R.toastOk) && /Төлөвлөгөө/.test(R.toastOk),
      R.toastOk);
    check('S6. MAP товчинд товчлол алга', !!R.mapBtn && !/MAP/.test(R.mapBtn), R.mapBtn);
  } finally { srv.close(); }

  /* ── S7. Хэрэглэгчид ХЭРЭГГҮЙ дотоод файлын нэр ──────────────────
     GOV.UK/ONS "plain language": техникийн нэр томьёог зайлсхий, аргагүй
     бол тайлбарла. `metric_registry.json` бол хэрэглэгч ХЭЗЭЭ Ч гар
     хүрдэггүй дотоод файл — түүнийг нэрлэх нь мэдээлэл өгөхгүй, зөвхөн
     "энэ надад хэцүү" гэсэн мэдрэмж төрүүлнэ. (`content.json` нь өөр —
     экспортын АЖИЛЫН урсгалд шууд оролцдог тул хэвээр үлдэнэ.) */
  const visible = [];
  (function walk(o, p) {
    if (typeof o === 'string') { visible.push([p, o]); return }
    if (o && typeof o === 'object') Object.keys(o).forEach((k) => walk(o[k], p ? p + '.' + k : k));
  })({ ui: readJson('content.json').ui, site: readJson('content.json').site,
       widgets: readJson('content.json').widgets }, '');
  const leaks = visible.filter((x) => x[1].indexOf('metric_registry.json') >= 0).map((x) => x[0]);
  check('S7. Харагдах текстэд "metric_registry.json" гарахгүй (content.json)',
    leaks.length === 0, leaks.join(', '));
  /* Кодын utxt() fallback нь content.json-той ИЖИЛ байх ёстой — эс бөгөөс
     сүлжээгүй/ачаалагдаагүй үед хуучин текст буцаж гарна. */
  const admSrc = adminScript();
  const fbLeaks = (admSrc.match(/utxt\([^)]*metric_registry\.json[^)]*\)/g) || []).length;
  check('S7. Кодын fallback текстэд ч "metric_registry.json" гарахгүй',
    fbLeaks === 0, 'олдсон: ' + fbLeaks);

  /* ── S8. Эх сурвалж уншигч CRLF-д гажихгүй ────────────────────────
     Энэ тестийн БҮХ статик шалгуур read()-ээр дамждаг. Хэрэв тэнд CR
     үлдвэл LF-тэй хэв маяг хайдаг шалгуурууд чимээгүй гажина. */
  ['admin/index.html', 'index.html', 'content.json'].forEach((f) => {
    check('S8. read("' + f + '") мөрийн төгсгөлийг нормчилно',
      read(f).indexOf(String.fromCharCode(13)) < 0,
      'CR тэмдэгт үлдсэн — LF-тэй шалгуурууд гажина');
  });
  check('S8. adminScript() эх кодыг ОЛНО (хоосон биш)',
    adminScript().length > 100000, 'урт: ' + adminScript().length);
  check('S8. dcScript() эх кодыг ОЛНО (хоосон биш)',
    dcScript().length > 100000, 'урт: ' + dcScript().length);
}

/* ══════════════════════════════════════════════════════════════════
   U. UX QA ДАХИН ТЕСТИЙН 3 ОЛДВОР (qa-backlog.md)

   ux-qa-persona агент T1–T5-ийг баталгаажуулах явцдаа илрүүлсэн:
     U1 [Major] Виджетийн утгыг датаны талбараар солиход ТОО өөрчлөгддөг
        ч НЭГЖ нь хуучнаараа ("нислэг") үлддэг — "1,870,846 нислэг/сар"
        гэсэн боломжгүй тоо нийтлэгдэх эрсдэлтэй. Гарчиг нь тооны шошго
        болдог виджетэд (hero_fl) анхааруулга ч гардаггүй байв.
        Гарчгийг ӨӨРӨӨ дарж бичихгүй (ганц эх сурвалж — I7) — санал л.
     U2 [Minor] Каталогт "silver.rail_wagon_loading" түүхий код гарна.
     U3 [Minor] Админы preview-д "тооцоологдоно датасет" эвгүй хэллэг.
   ══════════════════════════════════════════════════════════════════ */
async function groupU() {
  group('U. UX QA дахин тестийн олдвор');
  const adm = read('admin/index.html'), con = readJson('content.json');

  check('U1. Preview-ийн нэгж сонгосон утгын нэгжээс гарна',
    adm.includes('function valueUnitOf(id,sectorKey)') &&
    adm.includes("if(vu!==null) return {u:vu,src:'value'};"),
    'previewUnitInfo утгын тохиргоог хардаггүй хэвээр');
  check('U1. content.json-ийн нэгж ДАВУУ эрхтэй хэвээр',
    adm.indexOf("if(t) return {u:t,src:'content'};") < adm.indexOf("if(vu!==null) return {u:vu,src:'value'};"));
  const twStart = adm.indexOf('function titleMismatchWarn(id){');
  const twBody = twStart >= 0 ? adm.slice(twStart, adm.indexOf('function autoNameHint', twStart)) : '';
  check('U1. Гарчиг таарахгүй үед анхааруулга + "Тавих" санал',
    !!twBody && twBody.includes('data-titlewarn') && twBody.includes('data-autoname') &&
    adm.includes("+titleMismatchWarn(id)+slotForm+"));
  check('U1. Гарчгийг ӨӨРӨӨ дарж бичихгүй (ганц эх сурвалж)',
    !!twBody && !/CON\.widgets\[[^\]]+\]\.title\s*=/.test(twBody) && !/S\.td\.title\s*=/.test(twBody));
  check('U1. Анхааруулгын текст content.json-д',
    !!(con.ui.metric.title_mismatch && con.ui.metric.title_mismatch_note));

  check('U2. Төмөр замын датасэт монгол нэртэй',
    adm.includes("'silver.rail_wagon_loading':{n:") &&
    !!(con.ui.dataset.silver_rail_wagon_loading && con.ui.dataset.silver_rail_wagon_loading.name));
  check('U2. Цэгтэй түлхүүр utxt() замд эвдрэхгүй',
    adm.includes("var dk=k.replace(/\\./g,'_');") && adm.includes("utxt('dataset.'+dk+'.name'"));

  check('U3. Порталын карт бодит тоо харуулна (жагсаалтын уртаас)',
    adm.includes('CON.site.datasets.length:null') && adm.includes('CON.site.services.length:null'));
  check('U3. "тооцоологдоно" ба нэгж ЗАЛГАГДАХГҮЙ',
    !adm.includes("esc(utxt('portal_kpi.computed','тооцоологдоно')):'—')+\n          ' <span"),
    'хуучин залгаас үлдсэн');
  /* Сөрөг шалгуур ГАНЦААРАА байвал хайлтын хэв маяг гажихад чимээгүй
     ногоон болно. Одоогийн ЗӨВ хэлбэр байгааг ч баталгаажуулна. */
  check('U3. Тооцоолсон утга ба "тооцоологдоно" хоёр ӨӨР салаанд',
    adm.includes("esc(String(pkComputed[k]))+' <span") &&
    adm.includes("esc(utxt('portal_kpi.computed','тооцоологдоно'))"),
    'portal_kpi-ийн preview хэв маяг өөрчлөгдсөн байж магадгүй');

  if (!CHROME) { skipped('U4. QA дахин тестийн засвар (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(5000);
      const R={};
      const unitOf=()=>{const e=d.querySelector('#pvhost .pvticker span.t:not(.ed)');return e?e.textContent.trim():''};
      const sec=d.querySelector('[data-section="hero"]'); if(!sec) return {__err:'hero хэсэг алга'};
      sec.click(); await sleep(700);
      const wg=d.querySelector('[data-widget="hero_fl"]'); if(!wg) return {__err:'hero_fl алга'};
      wg.click(); await sleep(1200);
      R.unitBefore=unitOf();
      R.titleField0=(d.querySelector('[data-tf="title"]')||{}).value||'';
      const sel=d.querySelector('[data-slot^="hero_fl|"]'); if(!sel) return {__err:'слот алга'};
      const opt=[...sel.options].find(o=>o.value==='field:Зорчигч|SUM');
      if(!opt) return {__err:'Зорчигч·SUM сонголт алга'};
      R.registered=sel.value;
      sel.value=opt.value; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
      await sleep(1300);
      R.unitAfter=unitOf();
      R.warn=!!d.querySelector('[data-titlewarn]');
      R.titleField1=(d.querySelector('[data-tf="title"]')||{}).value||'';
      const ap=d.querySelector('[data-titlewarn] [data-autoname]');
      if(ap){ ap.click(); await sleep(700) }
      R.titleField2=(d.querySelector('[data-tf="title"]')||{}).value||'';
      const twb=d.querySelector('[data-titlewarn]');
      R.warnHidden=!twb||twb.style.display==='none';
      /* буцаах — бүртгэлтэй метрик */
      const sel2=d.querySelector('[data-slot^="hero_fl|"]');
      sel2.value=R.registered; sel2.dispatchEvent(new w.Event('change',{bubbles:true}));
      await sleep(1200);
      R.unitBack=unitOf();
      /* U2 — Датасэтийн өнцөг */
      let b,n=0; while((b=d.querySelector('[data-back]'))&&n++<6) b.click();
      await sleep(400);
      const f=d.querySelector('[data-facet="data"]'); if(f){ f.click(); await sleep(800) }
      R.dataNodes=[...d.querySelectorAll('#dsList [data-node]')].map(x=>x.textContent.trim());
      /* U3 — Порталын 4 карт */
      const pg=d.querySelector('[data-facet="page"]'); if(pg){ pg.click(); await sleep(600) }
      const ps=d.querySelector('[data-section="portal-kpi"]');
      if(ps){ ps.click(); await sleep(700) }
      const uk=d.querySelector('[data-widget="uk"]');
      if(uk){ uk.click(); await sleep(1100) }
      R.ukText=((d.querySelector('#pvhost')||{}).textContent||'').replace(/\\s+/g,' ');
      return R;
    }`, 120000);
    if (R.__err) { bad('U4. QA дахин тестийн DOM шалгалт', R.__err); return; }
    check('U4. Анхны нэгж "нислэг"', R.unitBefore === 'нислэг', R.unitBefore);
    check('U4. Зорчигч · SUM сонгоход нэгж "хүн" болно',
      R.unitAfter === 'хүн', JSON.stringify({ before: R.unitBefore, after: R.unitAfter }));
    check('U4. Гарчиг таарахгүй анхааруулга гарна', R.warn === true);
    check('U4. Сонголт гарчгийг ӨӨРӨӨ солихгүй', R.titleField1 === R.titleField0,
      JSON.stringify({ before: R.titleField0, after: R.titleField1 }));
    check('U4. "Тавих" дархад санал гарчигт тавигдаж анхааруулга алга болно',
      R.titleField2 !== R.titleField0 && /ЗОРЧИГЧ/.test(R.titleField2) && R.warnHidden === true,
      JSON.stringify({ title: R.titleField2, hidden: R.warnHidden }));
    check('U4. Бүртгэлтэй метрик рүү буцаахад нэгж "нислэг" сэргэнэ', R.unitBack === 'нислэг', R.unitBack);
    check('U4. Датасэтийн модонд түүхий код гарахгүй',
      R.dataNodes.length > 0 && R.dataNodes.every((t) => !/silver\./.test(t)) &&
      R.dataNodes.some((t) => /Төмөр замын вагон ачилт/.test(t)),
      R.dataNodes.join(' | '));
    check('U4. Порталын картад "тооцоологдоно датасет" гарахгүй, бодит тоо гарна',
      !/тооцоологдоно\s*датасет/i.test(R.ukText) && /\b10\b\s*датасет/.test(R.ukText),
      R.ukText.slice(0, 160));
  } finally { srv.close(); }
}

/* ══════════════════════════════════════════════════════════════════
   W. k04 / i06 / r06 — УТГЫН ТОХИРГОО САЙТ ДЭЭР ТУСАХ (preview ↔ сайт)

   Админы preview эдгээр 3 виджетэд утгын тохиргоог хэрэглэдэг байсан ч
   сайт огт уншдаггүй байв: админ "Зорчигч · SUM" сонгоод нийтэлсэн ч
   сайт дээр ЮУ Ч өөрчлөгддөггүй. CLAUDE.md: "preview зөв мөртөө сайт
   буруу — энэ төсөлд хамгийн олон давтагдсан алдаа".
     W1. k04 эхний карт — тоо, нэгж, шошго, хувь, spark хамт
     W2. i06 агаарын шугам сонгосон хэмжигдэхүүний сар тутмын индекс
     W3. r06 эрэмбэ ӨӨРИЙН тохиргоотой (i06-ийг хуваалцахгүй)
     W4. Тооцоолол нэг модулиас (EHChart.agg) — сар бүрийг дахин нэмэхгүй
     W5. Сайт дээр бодитоор тусна (registry-г санах ойд орлуулж)
   ══════════════════════════════════════════════════════════════════ */
const PROBE_W = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(9000);
  const R={};
  /* Runtime нь style атрибутыг ХЭВИЙН болгож бичдэг ("font-size: 40px",
     өнгийг rgb(...)) тул текстэн style сонгогч барихгүй — тооцоолсон
     style ба data-eh-card хүрээгээр олно. */
  const cs=(x)=>w.getComputedStyle(x);
  const tab=[...d.querySelectorAll('button')].find(b=>b.textContent.trim().replace(/\\uFE0F/g,'')==='✈');
  if(!tab) return {__err:'агаарын салбарын таб алга'};
  tab.click(); await sleep(2000);
  const kh=d.querySelector('[data-eh-card="k04"][data-eh-field="title"]');
  if(!kh) return {__err:'k04 гарчиг алга'};
  const grid=kh.closest('div').nextElementSibling, card=grid&&grid.firstElementChild;
  const val=card&&[...card.querySelectorAll('div')].find(x=>cs(x).fontSize==='40px');
  const lab=card&&[...card.querySelectorAll('div')].find(x=>cs(x).fontSize==='10px'&&cs(x).textTransform==='uppercase');
  R.k04Value=val?val.textContent.trim():null;
  R.k04Unit=val&&val.nextElementSibling?val.nextElementSibling.textContent.trim():null;
  R.k04Label=lab?lab.textContent.trim():null;
  let i6=d.querySelector('[data-eh-card="i06"][data-eh-field="title"]');
  while(i6&&!(i6.querySelector&&i6.querySelector('svg foreignObject'))) i6=i6.parentElement;
  const airFO=i6?[...i6.querySelectorAll('foreignObject div')].filter(x=>cs(x).color==='rgb(47, 224, 196)'):[];
  R.i06End=airFO.length?airFO[0].textContent.trim():null;
  const isRow=(x)=>cs(x).display==='grid'&&/^22px 20px /.test(cs(x).gridTemplateColumns);
  let r6=d.querySelector('[data-eh-card="r06"][data-eh-field="title"]');
  while(r6&&![...r6.querySelectorAll('div')].some(isRow)) r6=r6.parentElement;
  const rows=r6?[...r6.querySelectorAll('div')].filter(isRow):[];
  const air=rows.find(x=>x.textContent.includes('✈'));
  R.r06Ch=air?air.lastElementChild.firstElementChild.textContent.trim():null;
  R.r06SE=air?air.lastElementChild.lastElementChild.textContent.trim():null;
  return R;
}`;
async function groupW() {
  group('W. k04 / i06 / r06 — утгын тохиргоо сайтад тусах');
  const idx = read('index.html');

  check('W1. k04 утгын тохиргоог сайт уншина',
    idx.includes("(key==='air')?this.valueFromSpec('k04'):null") &&
    /buildKpis\(kpis,color,verified,spec,foot\)/.test(idx) &&
    idx.includes('const vs=(i===0&&verified&&spec)?spec:null;'));
  /* spark нь одоо ЗӨВХӨН бодит цуваанаас (hasSeries) — зохиомол
     miniSpark() устсан тул шалгуур нь тэр шинэ мөрийг барина. */
  check('W1. Тоо, нэгж, шошго, хувь, spark ХАМТ сонголтыг дагана',
    ['label:vs?vs.label:k[0]', 'value:vs?vs.value:', "unit:vs?(vs.unit||''):k[2]",
      "const delta=vs?(vs.delta||'—')", 'const spark=(vs&&vs.spark)?vs.spark:(ownSeries?pathFor(ownSeries,120,32,3).line:flatSpark);']
      .every((t) => idx.includes(t)));
  check('W2. i06 агаарын шугам утгын тохиргооноос',
    idx.includes("const airI06=airFromSpec(this.valueSpecRaw('i06'))||cw.airCounts;") &&
    idx.includes('const src=(air===undefined)?airI06:air;'));
  check('W3. r06 эрэмбэ ӨӨРИЙН тохиргоотой',
    idx.includes("const airR06=airFromSpec(this.valueSpecRaw('r06'))||cw.airCounts;") &&
    idx.includes('const t=trendFor(k,airR06),a=t[0],b=t[lastIdx];'));
  const hStart = idx.indexOf('const airFromSpec=(spec)=>{');
  const helper = hStart >= 0 ? idx.slice(hStart, idx.indexOf('};', hStart)) : '';
  check('W4. Тооцоолол EHChart.agg-аар (дахин нэмж бичээгүй)',
    helper.includes('EHChart.agg(raw,') && !helper.includes('+='),
    'сар бүрийг гараар нэмж бичсэн');

  if (!CHROME) { skipped('W5. Сайт дээр тусах (DOM)', 'Chrome олдсонгүй'); return; }
  const reg = readJson('metric_registry.json');
  const spec = { dataset: 'air_flights', measure: 'Зорчигч', agg: 'SUM' };
  const withSpec = (ids) => {
    const r = JSON.parse(JSON.stringify(reg));
    ids.forEach((id) => { r.widgets[id] = r.widgets[id] || {}; r.widgets[id].value = spec; });
    return JSON.stringify(r);
  };
  const srv = serve();
  try {
    PROBE_SRC = '/index.html';
    SERVE_OVERRIDE = null;
    const r0 = await runProbe(PROBE_W, 120000);
    SERVE_OVERRIDE = { '/metric_registry.json': withSpec(['k04', 'i06', 'r06']) };
    const r1 = await runProbe(PROBE_W, 120000);
    SERVE_OVERRIDE = { '/metric_registry.json': withSpec(['i06']) };
    const r2 = await runProbe(PROBE_W, 120000);
    const err = r0.__err || r1.__err || r2.__err;
    if (err) { bad('W5. Сайтын DOM шалгалт', err); return; }
    check('W5. Анхны утгууд уншигдав',
      !!r0.k04Value && !!r0.i06End && !!r0.r06Ch, JSON.stringify(r0));
    check('W5. k04 — тоо өөрчлөгдөж, нэгж "хүн", шошго ЗОРЧИГЧ',
      r1.k04Value !== r0.k04Value && r1.k04Unit === 'хүн' && /ЗОРЧИГЧ/i.test(r1.k04Label || ''),
      JSON.stringify({ before: [r0.k04Value, r0.k04Unit, r0.k04Label], after: [r1.k04Value, r1.k04Unit, r1.k04Label] }));
    check('W5. i06 — агаарын шугамын индекс өөрчлөгдөнө',
      r1.i06End !== r0.i06End, JSON.stringify({ before: r0.i06End, after: r1.i06End }));
    check('W5. r06 — агаарын өсөлтийн хувь өөрчлөгдөнө',
      r1.r06Ch !== r0.r06Ch, JSON.stringify({ before: [r0.r06Ch, r0.r06SE], after: [r1.r06Ch, r1.r06SE] }));
    check('W5. Зөвхөн i06-г солиход r06 ХӨНДӨГДӨХГҮЙ (тусдаа тохиргоо)',
      r2.i06End === r1.i06End && r2.r06Ch === r0.r06Ch && r2.k04Value === r0.k04Value,
      JSON.stringify({ i06: r2.i06End, r06: r2.r06Ch, k04: r2.k04Value }));
  } finally {
    SERVE_OVERRIDE = null;
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* ══════════════════════════════════════════════════════════════════
   X. ПОРТАЛЫН 4 КАРТ — ЭХ СУРВАЛЖГҮЙ "+N ЭНЭ УЛИРАЛД"

   Картын тэмдэглэл "+12 энэ улиралд", "+3", "+5", "0.0%" гэж кодод ба
   content.json-д хатуу бичигдсэн байв. Датасэт/үйлчилгээнд нэмэгдсэн
   огноо бүртгэгддэггүй тул тооцох эх сурвалж ОГТ алга — каталогт нийт
   10 датасэт байхад "+12 энэ улиралд" гэж бичдэг байсан. Мөн тэмдэглэл
   "+"-ээр эхэлбэл miniSpark() өгсөх муруй ЗОХИОЖ зурдаг байв.
     X1. Кодын тогтмолд зохиомол тэмдэглэл үлдээгүй
     X2. content.json-д тоон тэмдэглэл үлдээгүй (талбар засварлагдах хэвээр)
     X3. Жижиг график тэмдэглэлээс хамаарахгүй, хэвтээ шугам
     X4. Сайт дээр "энэ улиралд" гарахгүй, бодит тоо хэвээр
   ══════════════════════════════════════════════════════════════════ */
const PROBE_X = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(7000);
  /* Шошго цэс/hero-д ч давтагддаг тул "дээш алхаж текст агуулсан хүрээ"
     гэвэл хэт том элемент сонгогдоно. Порталын карт = ЯГ НЭГ жижиг
     график (svg path fill=none) ба 36px тоотой хамгийн ойрын эцэг. */
  const cs=x=>w.getComputedStyle(x);
  const norm=s=>s.replace(/\\s+/g,' ').trim().toUpperCase();
  const leaves=[...d.querySelectorAll('div,span')].filter(x=>x.children.length===0);
  const labels=['НЭЭЛТТЭЙ ӨГӨГДӨЛ','ЦАХИМ ҮЙЛЧИЛГЭЭ','СУДАЛГАА','ОРОЛЦОГЧ БАЙГУУЛЛАГА'];
  const cards=labels.map(lb=>{
    for(const lab of leaves.filter(x=>norm(x.textContent)===lb)){
      let c=lab;
      for(let h=0;h<6&&c;h++,c=c.parentElement){
        const paths=c.querySelectorAll('svg path[fill="none"]');
        const big=[...c.querySelectorAll('div')].find(x=>cs(x).fontSize==='36px');
        if(paths.length===1&&big){
          const dd=paths[0].getAttribute('d')||'';
          const ys=[...dd.matchAll(/[ML]\\s*[-\\d.]+[ ,]\\s*([-\\d.]+)/g)].map(m=>+m[1]);
          const chip=[...c.querySelectorAll('div')].find(x=>cs(x).fontSize==='10.5px'&&cs(x).fontWeight==='600');
          return {lb, value:big.textContent.trim(), note:chip?chip.textContent.trim():null,
                  flat:ys.length>1&&ys.every(y=>Math.abs(y-ys[0])<0.01)};
        }
      }
    }
    return {lb, err:'карт олдсонгүй'};
  });
  return {cards, pageQuarter:/энэ улиралд/i.test(d.body.innerText)};
}`;
async function groupX() {
  group('X. Порталын картын эх сурвалжгүй тэмдэглэл');
  const idx = read('index.html'), con = readJson('content.json');

  const blk = (idx.match(/const KPI_UNIFIED=\[[\s\S]*?\n\];/) || [''])[0];
  check('X1. KPI_UNIFIED-д "энэ улиралд" ба зохиомол хувь алга',
    !!blk && !/энэ улиралд/.test(blk) && !/'[+-]?\d+(\.\d+)?%'/.test(blk), blk.slice(0, 200));
  const notes = ['open_data', 'eservice', 'research', 'orgs']
    .map((k) => (con.site.portal_kpi[k] || {}).note);
  check('X2. content.json-ийн тэмдэглэл тоогүй, талбар хэвээр',
    notes.every((n) => typeof n === 'string' && !/\d/.test(n)), JSON.stringify(notes));
  const mapStart = idx.indexOf('return {unifiedKpis:KPI_UNIFIED.map(');
  const mapBody = mapStart >= 0 ? idx.slice(mapStart, idx.indexOf('}),', mapStart)) : '';
  check('X3. Жижиг график тэмдэглэлээс ЗОХИОГДОХГҮЙ (хэвтээ шугам)',
    !!mapBody && !mapBody.includes('miniSpark(') && mapBody.includes('const sp=ukFlat;'));

  if (!CHROME) { skipped('X4. Сайт дээр (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    PROBE_SRC = '/index.html';
    const r = await runProbe(PROBE_X, 120000);
    if (r.__err) { bad('X4. Сайтын DOM шалгалт', r.__err); return; }
    const byLb = Object.fromEntries((r.cards || []).map((c) => [c.lb, c]));
    check('X4. Порталын 4 карт олдов',
      (r.cards || []).length === 4 && r.cards.every((c) => !c.err), JSON.stringify(r.cards));
    check('X4. Сайтын АЛЬ Ч хэсэгт "энэ улиралд" гарахгүй', r.pageQuarter === false);
    check('X4. 4 картын тэмдэглэл хоосон',
      (r.cards || []).every((c) => c.note === ''), JSON.stringify((r.cards || []).map((c) => c.note)));
    check('X4. Жижиг график хэвтээ шугам (зохиомол муруй алга)',
      (r.cards || []).every((c) => c.flat === true), JSON.stringify((r.cards || []).map((c) => c.flat)));
    check('X4. Бодит тоо хэвээр (10 датасет, 11 үйлчилгээ)',
      (byLb['НЭЭЛТТЭЙ ӨГӨГДӨЛ'] || {}).value === '10' && (byLb['ЦАХИМ ҮЙЛЧИЛГЭЭ'] || {}).value === '11',
      JSON.stringify((r.cards || []).map((c) => c.lb + '=' + c.value)));
  } finally {
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}


/* ══════════════════════════════════════════════════════════════════
   Y. ИРГЭДЭД ХАРАГДАХ ДАВХАРГА (ux-qa-persona · амьд сайт, 2026-09-16)

   Агент амьд сайт дээр 2 Major олдвор илрүүлсэн — хоёулаа админ талд
   БИШ, иргэдийн эхний дэлгэц дээр:
     Y1/Y2. Толгойн "амьд" badge ХАТУУ бичсэн огноо ('2026-08-12')
            харуулдаг байв — ногоон цохилдог цэгийн хажууд зогссон огноо
            нь "энэ дата шинэ" гэсэн ХУДАЛ дохио (бодит feed 35 хоногоор
            хожуу). Одоо feed-ийн мета-аас л уншина.
     Y3/Y4. Хайлт 0 үр дүн өгөхөд ХООСОН хуудас гарч, хайлтаа засах ч,
            цуцлах ч газаргүй байв — иргэн "Нүүр"-ээс шинээр эхлэхээс
            өөр гарцгүй. Одоо каталог дээрээ хайх талбар, цэвэрлэх товч,
            "юу олдсонгүй, одоо яах вэ" гэсэн хоосон төлөвтэй.
   ══════════════════════════════════════════════════════════════════ */
const PROBE_Y = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(7000);
  const R={};
  const clock=d.querySelector('.eh-clock');
  R.badge=clock?clock.innerText.replace(/\\s+/g,' ').trim():null;
  R.dot=clock&&clock.querySelector('div')?clock.querySelector('div').getAttribute('style'):'';
  /* Иргэн hero-гээс утгагүй үг хайна */
  const inp=[...d.querySelectorAll('input[type=\"text\"]')][0];
  if(!inp) return Object.assign(R,{__err:'hero хайлтын талбар олдсонгүй'});
  inp.value='зззхххяяя'; inp.dispatchEvent(new w.Event('input',{bubbles:true}));
  await sleep(300);
  const go=[...d.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Хайх')[0];
  if(!go) return Object.assign(R,{__err:'Хайх товч олдсонгүй'});
  go.click(); await sleep(1200);
  R.emptyShown=d.body.innerText.indexOf('олдсонгүй')>=0;
  R.emptyText=(()=>{const e=[...d.querySelectorAll('div')]
    .filter(x=>x.innerText&&x.innerText.indexOf('олдсонгүй')>=0).pop();
    return e?e.innerText.replace(/\\s+/g,' ').trim().slice(0,120):null})();
  const ci=[...d.querySelectorAll('input[type=\"text\"]')][0];
  R.catalogInput=ci?{ph:ci.placeholder,val:ci.value}:null;
  R.clearBtns=[...d.querySelectorAll('button')]
    .map(b=>b.textContent.trim()).filter(t=>t==='✕'||t==='Хайлтыг цэвэрлэх');
  /* Цэвэрлэхэд жагсаалт СЭРГЭНЭ */
  const cb=[...d.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Хайлтыг цэвэрлэх')[0];
  if(cb){ cb.click(); await sleep(900) }
  R.afterClear={empty:d.body.innerText.indexOf('олдсонгүй')>=0,
    val:([...d.querySelectorAll('input[type=\"text\"]')][0]||{}).value};
  /* Каталог дотроо бичихэд шүүгдэж, ФОКУС алдагдахгүй */
  const ti=[...d.querySelectorAll('input[type=\"text\"]')][0];
  if(ti){ ti.focus(); ti.value='зззхххяяя';
    ti.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(900) }
  const ti2=[...d.querySelectorAll('input[type=\"text\"]')][0];
  R.inline={empty:d.body.innerText.indexOf('олдсонгүй')>=0,
    val:ti2?ti2.value:null, focus:d.activeElement===ti2};
  return R;
}`;


/* Y6 — админы үүсгэдэг гүн холбоос ("#sec-06") ЖИНХЭНЭ газар руу аваачна */
const PROBE_Y_ANCHOR = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(7500);
  const ids=['hero','portal-kpi','sec-01','sec-02','sec-04','sec-05','sec-06','sec-07','sec-08'];
  const e=d.getElementById('sec-06');
  return { exists:ids.filter(i=>!!d.getElementById(i)),
    hash:w.location.hash, scrollY:Math.round(w.scrollY),
    top:e?Math.round(e.getBoundingClientRect().top):null };
}`;

/* Y7/Y8 — хуудас бүр хаягтай, Back сайт дотор, "буцах" өөр рүүгээ заахгүй */
const PROBE_Y_ROUTE = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(7000);
  const go=async(n)=>{const b=[...d.querySelectorAll('button,a')].filter(x=>x.textContent.trim()===n)[0];
    if(b){b.click(); await sleep(1300)} return !!b};
  const back=()=>{const b=[...d.querySelectorAll('button,a')].filter(x=>/руу буцах/.test(x.textContent))[0];
    return b?b.textContent.trim():null};
  const R={start:w.location.hash};
  await go('Коммунити');
  R.c1={hash:w.location.hash, back:back()};
  await go('Коммунити');
  R.c2={hash:w.location.hash, back:back()};
  await go('Салбарын түүх');
  R.h={hash:w.location.hash, back:back()};
  w.history.back(); await sleep(1300);
  R.afterBack={hash:w.location.hash,
    onCommunity:d.body.innerText.indexOf('Төр, иргэнийг холбосон')>=0};
  /* Hero-гийн хайлт ч хаягаа шинэчилнэ */
  await go('Нүүр');
  const inp=[...d.querySelectorAll('input[type=\\"text\\"]')][0];
  if(inp){ inp.value='нислэг'; inp.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(300);
    const sb=[...d.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Хайх')[0];
    if(sb){ sb.click(); await sleep(1300) } }
  R.search={hash:w.location.hash};
  return R;
}`;


/* Y9 — датасэтийн дэлгэрэнгүй: жагсаалтаас нээхэд хаяг, Back */
const PROBE_Y_DS_OPEN = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(6500);
  const go=async(n)=>{const b=[...d.querySelectorAll('button,a')].filter(x=>x.textContent.trim()===n)[0];
    if(b){b.click(); await sleep(1300)} return !!b};
  await go('Нээлттэй өгөгдөл');
  /* ХОЁР дахь картыг нээнэ — эхнийх нь анхдагч dsIndex:0-тэй санамсаргүй
     таарч, тест хуурамчаар давах эрсдэлтэй */
  const cards=[...d.querySelectorAll('button')].filter(b=>b.innerText.length>60&&/Дэлгэрэнгүй|Үзэх/.test(b.innerText));
  const card=cards[1];
  if(!card) return {__err:'датасэтийн карт олдсонгүй ('+cards.length+')'};
  const name=(card.innerText.split('\\n').filter(x=>x.trim().length>6)[0]||'').trim();
  card.click(); await sleep(1500);
  const R={name:name, hash:decodeURIComponent(w.location.hash),
    head:((d.querySelector('h1,h2')||{}).innerText||'').trim()};
  w.history.back(); await sleep(1300);
  R.back={hash:w.location.hash};
  w.history.forward(); await sleep(1500);
  R.fwd={hash:decodeURIComponent(w.location.hash),
    head:((d.querySelector('h1,h2')||{}).innerText||'').trim()};
  return R;
}`;

/* Y9 — хаягаар ШУУД орох (хуваалцсан холбоос / F5) */
const PROBE_Y_DS_DIRECT = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(6500);
  return { hash:decodeURIComponent(w.location.hash),
    head:((d.querySelector('h1,h2')||{}).innerText||'').trim(),
    back:([...d.querySelectorAll('button,a')].filter(x=>/руу буцах/.test(x.textContent))[0]||{}).textContent||null };
}`;

/* Y9 — хуучирсан холбоос: хоосон дэлгэрэнгүй биш, каталог + тайлбар */
const PROBE_Y_DS_STALE = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let seen=false;
  for(let i=0;i<60;i++){
    if(d.body&&d.body.textContent.indexOf('Холбоосын датасэт олдсонгүй')>=0){ seen=true; break }
    await sleep(100);
  }
  await sleep(800);
  return { toast:seen, hash:w.location.hash,
    catalog:!!d.querySelector('input[placeholder=\\"Датасэт хайх…\\"]') };
}`;

async function groupY() {
  group('Y. Иргэдэд харагдах давхарга (толгойн огноо · хайлтын хоосон төлөв)');
  const idx = read('index.html');

  /* ── Статик: огноо КОДОД хатуу бичигдээгүй ── */
  const valsStart = idx.indexOf('renderVals(){');
  const valsHead = valsStart >= 0 ? idx.slice(valsStart, valsStart + 4000) : '';
  check('Y1. Толгойн огноо кодод ХАТУУ бичигдээгүй',
    !/nowLabel:\s*'20\d\d-\d\d-\d\d'/.test(idx),
    (idx.match(/nowLabel:[^,]*/) || [''])[0].slice(0, 80));
  check('Y1. Огноо feed-ийн мета-аас уншигдана (ганц эх сурвалж)',
    valsHead.includes("sourceData('flights')") && valsHead.includes('updatedAt'),
    valsHead.includes("sourceData('flights')") ? 'ok' : 'sourceData олдсонгүй');
  check('Y1. Дата ирээгүй үед огноо ЗОХИОХГҮЙ, төлөвөө хэлнэ',
    idx.includes("feed.stamp_pending") && idx.includes("feed.stamp_failed") &&
    idx.includes('feedFailed:true'));

  /* ── Y5. Иргэдэд харагдах текстэд ДОТООД нэр гоожихгүй ──
     Админ талд ижил олдвор хаагдсан ч (silver.rail_wagon_loading →
     монгол нэр) нийтийн датасэтийн тайлбарт үлдсэн байв. Энэ шалгуур
     ганц мөр биш, БҮХ АНГИЛЛЫГ барина: medallion схемийн нэр
     (bronze./silver./gold.) ба дотоод файлын нэр (*.json). */
  const conY = readJson('content.json');
  const leakY = [];
  (function walk(o, p) {
    if (typeof o === 'string') {
      if (/(bronze|silver|gold)\.[a-z_]+|[a-z_]+\.json/i.test(o)) leakY.push(p);
      return;
    }
    if (o && typeof o === 'object') Object.keys(o).forEach((k) => walk(o[k], p ? p + '.' + k : k));
  })({ site: conY.site, widgets: conY.widgets }, '');
  check('Y5. Иргэдэд харагдах текстэд дотоод хүснэгт/файлын нэр алга',
    leakY.length === 0, leakY.join(', '));

  /* ── Y6. Админы "Сайт дээр нээх ↗" гүн холбоос ЖИНХЭНЭ газар заана ──
     Админ нь content.json → widgets.<id>.anchor-оос "#sec-06" мэт холбоос
     үүсгэж, хуулах боломжтой хаяг болгон харуулдаг. Өмнө нь сайт дээр тэр
     id ОГТ байгаагүй тул холбоос нүүр рүү аваачаад хаана ч гүйлгэдэггүй
     байв. Нүүрний 17 виджетийн анкор бүр темплейтэд id болж байх ёстой. */
  const regY = readJson('metric_registry.json');
  const homeAnchors = [...new Set(Object.keys(regY.widgets)
    .map((id) => (conY.widgets[id] || {}).anchor).filter(Boolean))];
  const missingA = homeAnchors.filter((a) => idx.indexOf('id="' + a + '"') < 0);
  check('Y6. Нүүрний виджет бүрийн анкор сайт дээр id болж байна (' + homeAnchors.length + ')',
    homeAnchors.length >= 8 && missingA.length === 0, 'алга: ' + missingA.join(', '));
  check('Y7. Хуудасны хаяг "#/" угтвартай — хуучин "#sec-" холбоосыг эвдэхгүй',
    idx.includes("h.indexOf('#/')!==0") && idx.includes("hash0.indexOf('#/')!==0"));
  check('Y7. Хөтчийн Back/Forward-ийг сонсоно (popstate)',
    idx.includes("addEventListener('popstate'"));
  /* ── Y9. Датасэтийн дэлгэрэнгүй хаягтай ──
     Таних тэмдэг нь datasetSlug — үзэлтийн тоолуур ба дагалт ч үүнийг
     ашигладаг тул хаяг, тоолуур, дагалт ГУРВУУЛАА нэг эх сурвалжтай.
     Жагсаалтын индекс хаягт ОРОХГҮЙ (датасэт нэмэгдэхэд шилжинэ). */
  check('Y9. Хаяг "#/browse/<slug>" хэлбэрийг задлана',
    idx.includes("parts[0]==='browse'&&parts.length>1") && idx.includes('decodeURIComponent(raw)'));
  check('Y9. Хаяг datasetSlug-аар үүснэ (индексээр БИШ)',
    idx.includes("pushRoute('browse/'+encodeURIComponent(datasetSlug(d))") &&
    !/pushRoute\([^)]*dsIndex/.test(idx));
  check('Y9. Жагсаалтаас нээх нь ганц замаар (openDataset)',
    idx.includes('open:()=>this.openDataset(d)') && !idx.includes("this.go('detail')"));
  const slugOf = (d) => d.sector + '__' + String(d.name).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const dsSlugs = (conY.site.datasets || []).map(slugOf);
  check('Y9. Датасэт бүрийн таних тэмдэг ДАВХАРДАХГҮЙ (' + dsSlugs.length + ')',
    dsSlugs.length > 0 && new Set(dsSlugs).size === dsSlugs.length,
    'давхардал: ' + dsSlugs.filter((x, i) => dsSlugs.indexOf(x) !== i).join(', '));
  check('Y9. Хуучирсан холбоосын тайлбар content.json-д бүртгэлтэй',
    typeof (conY.site.browse || {}).link_not_found === 'string' &&
    idx.includes("stxt('browse.link_not_found'"));

  check('Y8. Байгаа хуудсаа дахин дарахад prevPage хөдлөхгүй',
    /go\(id\)\{[\s\S]{0,400}if\(this\.state\.page===id\)/.test(idx));

  if (!CHROME) { skipped('Y2–Y4 (браузер)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    PROBE_SRC = '/index.html';
    const R = await runProbe(PROBE_Y, 120000);
    if (R.__err) { bad('Y бүлэг ажиллав', R.__err); return; }

    check('Y2. Толгойн badge БОДИТ огноо харуулна (хуучин 2026-08-12 биш)',
      typeof R.badge === 'string' && /20\d\d-\d\d-\d\d/.test(R.badge) &&
      R.badge.indexOf('2026-08-12') < 0, String(R.badge));
    check('Y2. Огноо байгаа үед л "амьд" цэг цохилно',
      /pulseGlow/.test(R.dot || ''), String(R.dot).slice(0, 80));

    check('Y3. 0 үр дүнтэй хайлт "олдсонгүй"-г ХЭЛНЭ', R.emptyShown === true);
    check('Y3. Хоосон төлөв хайсан үгийг эшлэнэ',
      typeof R.emptyText === 'string' && R.emptyText.indexOf('зззхххяяя') >= 0,
      String(R.emptyText));
    check('Y3. Үр дүнгийн хуудсан дээрээ хайх талбар байна (буцахгүйгээр засна)',
      !!R.catalogInput && R.catalogInput.val === 'зззхххяяя', JSON.stringify(R.catalogInput));
    check('Y3. Цэвэрлэх боломж ХОЁУЛАА байна (✕ ба товч)',
      (R.clearBtns || []).indexOf('✕') >= 0 &&
      (R.clearBtns || []).indexOf('Хайлтыг цэвэрлэх') >= 0, JSON.stringify(R.clearBtns));
    check('Y3. Цэвэрлэхэд жагсаалт СЭРГЭНЭ (гацаа биш)',
      R.afterClear && R.afterClear.empty === false && R.afterClear.val === '',
      JSON.stringify(R.afterClear));
    check('Y4. Каталог дотроо бичихэд шүүгдэж, ФОКУС алдагдахгүй',
      R.inline && R.inline.empty === true && R.inline.val === 'зззхххяяя' &&
      R.inline.focus === true, JSON.stringify(R.inline));

    /* ── Y6 браузер: "#sec-06" холбоос тухайн хэсэг рүү гүйлгэнэ ── */
    PROBE_SRC = '/index.html#sec-06';
    const A = await runProbe(PROBE_Y_ANCHOR, 120000);
    if (A.__err) bad('Y6. Анкорын шалгалт ажиллав', A.__err);
    else {
      check('Y6. Сайт дээр 9 анкор бүгд DOM-д байна',
        (A.exists || []).length === 9, JSON.stringify(A.exists));
      check('Y6. "#sec-06" холбоос тухайн хэсэг рүү ГҮЙЛГЭНЭ (нүүрний оройд үлдэхгүй)',
        A.scrollY > 500 && A.top !== null && Math.abs(A.top) < 250,
        'scrollY=' + A.scrollY + ' top=' + A.top);
    }

    /* ── Y7/Y8 браузер: хаяг, Back, "буцах" ── */
    PROBE_SRC = '/index.html';
    const N = await runProbe(PROBE_Y_ROUTE, 120000);
    if (N.__err) bad('Y7. Навигацийн шалгалт ажиллав', N.__err);
    else {
      check('Y7. Хуудас солиход хаяг шинэчлэгдэнэ (#/community, #/history)',
        N.c1 && N.c1.hash === '#/community' && N.h && N.h.hash === '#/history',
        JSON.stringify({ c: N.c1 && N.c1.hash, h: N.h && N.h.hash }));
      check('Y7. Хөтчийн Back сайт ДОТОР өмнөх хуудас руу буцна',
        N.afterBack && N.afterBack.hash === '#/community' && N.afterBack.onCommunity === true,
        JSON.stringify(N.afterBack));
      check('Y7. Hero-гийн хайлт ч хаягаа шинэчилнэ (#/browse)',
        N.search && N.search.hash === '#/browse', JSON.stringify(N.search));
      check('Y8. Байгаа хуудсаа дахин дарахад "буцах" өөр рүүгээ ЗААХГҮЙ',
        N.c2 && N.c2.back && N.c2.back.indexOf('Коммунити') < 0 && N.c2.back === N.c1.back,
        JSON.stringify({ first: N.c1 && N.c1.back, again: N.c2 && N.c2.back }));
    }

    /* ── Y9 браузер ── */
    PROBE_SRC = '/index.html';
    const O = await runProbe(PROBE_Y_DS_OPEN, 120000);
    if (O.__err) bad('Y9. Датасэт нээх шалгалт ажиллав', O.__err);
    else {
      const want = '#/browse/' + slugOf((conY.site.datasets || []).find((x) => x.name === O.name) || {});
      check('Y9. Жагсаалтаас нээхэд хаяг тухайн датасэтийн slug болно',
        O.hash === want && O.head === O.name, JSON.stringify({ got: O.hash, want: want, head: O.head }));
      check('Y9. Back каталог руу, Forward тэр датасэт рүү буцна',
        O.back && O.back.hash === '#/browse' && O.fwd && O.fwd.hash === want && O.fwd.head === O.name,
        JSON.stringify({ back: O.back, fwd: O.fwd }));
    }
    /* Сүүлийн датасэт — анхдагч dsIndex:0-оос хамгийн ХОЛ */
    const lastDs = (conY.site.datasets || []).slice(-1)[0];
    PROBE_SRC = '/index.html#/browse/' + encodeURIComponent(slugOf(lastDs));
    const D = await runProbe(PROBE_Y_DS_DIRECT, 120000);
    if (D.__err) bad('Y9. Шууд хаягийн шалгалт ажиллав', D.__err);
    else {
      check('Y9. Хуваалцсан холбоос ЗӨВ датасэтийг нээнэ (эхнийхийг биш)',
        D.head === lastDs.name, JSON.stringify({ head: D.head, want: lastDs.name }));
      check('Y9. Шууд орсон дэлгэрэнгүйгээс "буцах" каталог руу заана',
        typeof D.back === 'string' && D.back.indexOf('Нээлттэй өгөгдөл') >= 0, String(D.back));
    }
    PROBE_SRC = '/index.html#/browse/' + encodeURIComponent('air__байхгүй-датасэт');
    const X = await runProbe(PROBE_Y_DS_STALE, 120000);
    if (X.__err) bad('Y9. Хуучирсан холбоосын шалгалт ажиллав', X.__err);
    else {
      check('Y9. Хуучирсан холбоос хоосон хуудас биш, КАТАЛОГ руу аваачна',
        X.hash === '#/browse' && X.catalog === true, JSON.stringify(X));
      check('Y9. Хуучирсан холбоосын шалтгааныг ТАЙЛБАРЛАНА',
        X.toast === true, JSON.stringify(X));
    }
  } finally {
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* ─────────── Z. Анхны сэтгэгдэл (first-impression-audit олдвор) ───────────
   Анх орж буй хүн жагсаалтын мөрийг НЭЭЛГҮЙГЭЭР таних ёстой:
   Z1 — модны төлөвийн тэмдэг худал хэлэхгүй (хэсэгчлэн = "!", текст = "·")
   Z2 — Сайтын текстийн бүлэг бүр сайтын аль хуудас/бүсэд гарахаа мэднэ
   Z3 — шинэ текст content.json-д
   Z4 — DOM: хураасан бүлэг + утгын хураангуй + хуудсаар шүүх + байршлын
        холбоос, модны навч ба виджет чип дээр preview гарна */
function adminCut(a, b) {
  const s = adminScript(), i = s.indexOf(a), j = s.indexOf(b, i + 1);
  return i >= 0 && j > i ? s.slice(i, j) : null;
}
async function groupZ() {
  group('Z. Анхны сэтгэгдэл (таних · байршил · тойм)');
  const con = readJson('content.json');

  /* ── Z1. treeStat — гараар бодох боломжтой 6 тохиолдол ── */
  const tsSrc = adminCut('function treeStat(t,n){', '/* TREE_STAT_END */');
  let treeStat = null;
  try { treeStat = tsSrc && new Function(tsSrc + 'return treeStat;')(); } catch (e) {}
  if (!treeStat) bad('Z1. treeStat() олдсонгүй');
  else {
    const T = (ok, mix, no, txt) => ({ ok, mix, no, txt });
    check('Z1. Бүгд бүрэн → ok', treeStat(T(2, 0, 0, 0), 2) === 'ok');
    check('Z1. Бүгд ХЭСЭГЧЛЭН → mix (✕ биш)', treeStat(T(0, 2, 0, 0), 2) === 'mix', treeStat(T(0, 2, 0, 0), 2));
    check('Z1. Бүрэн + холбоогүй → mix', treeStat(T(1, 0, 1, 0), 2) === 'mix');
    check('Z1. Бүгд холбоогүй → no', treeStat(T(0, 0, 2, 0), 2) === 'no');
    check('Z1. Зөвхөн текст → txt (холбоогүй гэж хэлэхгүй)', treeStat(T(0, 0, 0, 1), 1) === 'txt');
    check('Z1. Текст тооцоонд орохгүй: 2 бүрэн + 1 текст → ok', treeStat(T(2, 0, 0, 1), 3) === 'ok');
  }
  const adm = adminScript();
  check('Z1. twRow нь treeStat-аар тэмдэг сонгоно',
    adm.includes('cls=treeStat(t,n.ids.length)') && !adm.includes("cls=t.ok===n.ids.length&&n.ids.length?'ok':(t.ok?'mix':'no')"));

  /* ── Z2. Байршлын зураглал ── */
  const locSrc = adminCut('var SITE_LOC={', '/* SITE_LOC_END */');
  let L = null;
  try {
    L = locSrc && new Function('BASE', locSrc +
      'return {siteLocOf:siteLocOf,siteLocUrl:siteLocUrl,LOC_ZONES:LOC_ZONES,SITE_LOC:SITE_LOC};')('../index.html');
  } catch (e) { bad('Z2. SITE_LOC ачаалагдав', e.message); }
  if (!L) bad('Z2. SITE_LOC / siteLocOf олдсонгүй');
  else {
    const eq = (p, page, zone) => { const r = L.siteLocOf(p); return r.page === page && r.zone === zone; };
    check('Z2. brand.name → бүх хуудас · толгой', eq(['brand', 'name'], 'all', 'head'));
    check('Z2. hero.ticker.ai → нүүр · hero', eq(['hero', 'ticker', 'ai'], 'home', 'hero'));
    check('Z2. community.see_all → нүүр · 03-р хэсэг', eq(['community', 'see_all'], 'home', 's3'));
    check('Z2. community.tabs.0.label → коммунити · таб (урт зам давуу)', eq(['community', 'tabs', '0', 'label'], 'community', 'tabs'));
    check('Z2. browse.hero.lead → нээлттэй өгөгдөл · hero', eq(['browse', 'hero', 'lead'], 'browse', 'hero'));
    check('Z2. ui.* → админ', eq(['ui', 'toast', 'x'], 'admin', 'body'));
    check('Z2. URL: нүүр 03 → #sec-03', L.siteLocUrl({ page: 'home', zone: 's3' }) === '../index.html#sec-03',
      L.siteLocUrl({ page: 'home', zone: 's3' }));
    check('Z2. URL: browse hero → #/browse', L.siteLocUrl({ page: 'browse', zone: 'hero' }) === '../index.html#/browse');
    check('Z2. URL: бүх хуудасны толгой → нүүр', L.siteLocUrl({ page: 'all', zone: 'head' }) === '../index.html');
    check('Z2. URL: админ → холбоосгүй', L.siteLocUrl({ page: 'admin', zone: 'body' }) === null);
    /* content.json-д байгаа БҮХ бүлэг тодорхой байршилтай (таамгийн
       fallback-д унахгүй) — шинэ бүлэг нэмэгдвэл энд унана. */
    const groups = [].concat(
      (con.ui_form.site || []).map((g) => [g.key]),
      (con.ui_form.site_nested || []).map((g) => String(g.path).split('.')),
      Object.keys(con.site).filter((k) => k[0] !== '_').map((k) => [k]));
    const unknown = groups.filter((p) => L.siteLocOf(p.concat('x')).guess).map((p) => p.join('.'));
    check('Z2. content.json-ийн бүх бүлэг байршилтай (' + groups.length + ')', unknown.length === 0, unknown.join(', '));
    const zones = Object.keys(L.SITE_LOC).map((k) => L.SITE_LOC[k].split('|')[1]);
    const badZ = zones.filter((z) => !L.LOC_ZONES[z]);
    check('Z2. Бүсийн нэр бүр схемд зурагдана', badZ.length === 0, badZ.join(', '));
    /* Нүүрний анкор бүр сайт дээр id болж байх ёстой (Y6-тай ижил зарчим) */
    const idx = read('index.html');
    const anchors = [...new Set(Object.keys(L.LOC_ZONES).map((z) => L.LOC_ZONES[z].anchor).filter(Boolean))];
    const miss = anchors.filter((a) => idx.indexOf('id="' + a + '"') < 0);
    check('Z2. Бүсийн анкор сайт дээр байна (' + anchors.length + ')', anchors.length >= 8 && miss.length === 0, miss.join(', '));
  }

  /* ── Z3. Текст content.json-д ── */
  const stx = con.ui.site_tab || {};
  const need = ['toc_label', 'page_all', 'page_admin', 'page_other', 'open_on_site', 'expand_all', 'collapse_all', 'fields_word', 'loc_title'];
  const missT = need.filter((k) => typeof stx[k] !== 'string' || !stx[k]);
  check('Z3. Сайтын текст табын шинэ бичиг content.json-д', missT.length === 0, missT.join(', '));
  check('Z3. Модны "зөвхөн текст" тэмдгийн тайлбар content.json-д',
    typeof (con.ui.left || {}).status_txt === 'string' && adm.includes("utxt('left.status_txt'"));

  if (!CHROME) { skipped('Z4. Анхны сэтгэгдэл (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(4500);
      const R={};
      const vis=e=>!!e&&w.getComputedStyle(e).display!=='none';
      /* ── Модны тэмдэг ── */
      d.querySelector('[data-facet="state"]').click(); await sleep(300);
      const mixRoot=d.querySelector('[data-node="state:mix"] .st');
      R.mixRoot=mixRoot?mixRoot.className+'|'+mixRoot.textContent:'';
      const txtRoot=d.querySelector('[data-node="state:txt"] .st');
      R.txtRoot=txtRoot?txtRoot.className+'|'+txtRoot.textContent+'|'+txtRoot.getAttribute('title'):'';
      const x=d.querySelector('[data-twx="state:mix"]'); if(x){ x.click(); await sleep(300) }
      const mixNode=d.querySelector('[data-node="state:mix"]');
      const leaf=mixNode?mixNode.parentNode.querySelector('.tkids .tn.leaf'):null;
      R.leafSt=leaf?leaf.querySelector('.st').textContent:'';
      /* ── Навч дээр preview ── */
      R.leafTitle=leaf?(leaf.getAttribute('title')||''):'';
      R.leafNote=leaf&&leaf.querySelector('.sub')?leaf.querySelector('.sub').textContent:'';
      R.leafId=leaf?leaf.getAttribute('data-pvpop'):'';
      if(leaf){ leaf.dispatchEvent(new w.MouseEvent('mouseover',{bubbles:true})); await sleep(250) }
      let pop=d.getElementById('twpop');
      R.popVis=vis(pop); R.popPv=!!(pop&&pop.innerHTML.length>200);
      R.popFor=pop?pop.getAttribute('data-for'):'';
      if(leaf){ leaf.dispatchEvent(new w.MouseEvent('mouseout',{bubbles:true,relatedTarget:d.body})); await sleep(200) }
      R.popHidden=!vis(d.getElementById('twpop'));
      /* ── Дата холболтын виджет чип ── */
      d.querySelector('[data-tab="metrics"]').click(); await sleep(1200);
      const chip=d.querySelector('[data-mgoto][data-pvpop]');
      R.chip=!!chip;
      if(chip){ chip.dispatchEvent(new w.MouseEvent('mouseover',{bubbles:true})); await sleep(250);
        R.chipPop=vis(d.getElementById('twpop'));
        chip.dispatchEvent(new w.MouseEvent('mouseout',{bubbles:true,relatedTarget:d.body})); await sleep(150) }
      /* ── Сайтын текст ── */
      d.querySelector('[data-tab="site"]').click(); await sleep(1200);
      const groups=()=>[...d.querySelectorAll('#body .sgroup')];
      const fields=()=>d.querySelectorAll('#body [data-sf]').length;
      R.g0=groups().length; R.f0=fields();
      R.ex0=groups().filter(g=>g.querySelector('.sgex')).length;
      R.loc0=groups().filter(g=>g.querySelector('.sgloc svg')).length;
      R.toc=[...d.querySelectorAll('[data-sgpage]')].map(b=>b.getAttribute('data-sgpage'));
      /* Бүгдийг дэлгэх → бүх талбар */
      const ea=d.querySelector('[data-sgall="1"]'); if(ea){ ea.click(); await sleep(900) }
      R.fAll=fields();
      const ca=d.querySelector('[data-sgall="0"]'); if(ca){ ca.click(); await sleep(500) }
      R.fCollapsed=fields();
      /* Хуудсаар шүүх — Нүүр */
      const hp=d.querySelector('[data-sgpage="home"]'); if(hp){ hp.click(); await sleep(600) }
      R.homePages=[...new Set(groups().map(g=>g.getAttribute('data-sgpage-of')))];
      R.homeN=groups().length;
      /* Нэг бүлэг нээх → талбар + холбоос */
      const hd=d.querySelector('#body .sgroup [data-sgt]');
      const gid=hd?hd.getAttribute('data-sgt'):'';
      if(hd){ hd.click(); await sleep(500) }
      const g1=d.querySelector('#body .sgroup[data-sgid="'+gid+'"]');
      R.openFields=g1?g1.querySelectorAll('[data-sf]').length:0;
      const hd2=d.querySelector('[data-sgt="'+gid+'"]');
      R.openExp=hd2?hd2.getAttribute('aria-expanded'):'';
      const lk=g1&&g1.querySelector('a.sglink');
      R.link=lk?lk.getAttribute('href'):'';
      R.linkTarget=lk?lk.getAttribute('target'):'';
      /* Засвар → хураагаад дахин нээхэд утга хэвээр */
      const inp=g1&&g1.querySelector('[data-sf]');
      if(inp){
        R.key=inp.getAttribute('data-sf'); R.orig=inp.value;
        inp.value=R.orig+' ZZ'; inp.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(150);
        d.querySelector('[data-sgt="'+gid+'"]').click(); await sleep(300);
        R.closedDirty=d.querySelector('#body .sgroup[data-sgid="'+gid+'"]').classList.contains('dirty');
        d.querySelector('[data-sgt="'+gid+'"]').click(); await sleep(300);
        const again=d.querySelector('[data-sf="'+R.key+'"]');
        R.kept=again?again.value:'';
        if(again){ again.value=R.orig; again.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(150) }
      }
      /* Бүгд рүү буцаад хайлт → автоматаар нээгдэнэ */
      const allp=d.querySelector('[data-sgpage="any"]'); if(allp){ allp.click(); await sleep(500) }
      const q=d.getElementById('qsite');
      q.value='ErtHub'; q.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(600);
      R.qFields=fields();
      q.value=''; q.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(400);
      R.dirty=d.getElementById('dirtyMsg').textContent;
      return R;
    }`, 150000);
    if (R.__err) { bad('Z4. DOM шалгалт ажиллав', R.__err); return; }
    check('Z4. "хэсэгчлэн" бүлэг ! тэмдэгтэй (✕ биш)', /mix\|!$/.test(R.mixRoot), R.mixRoot);
    check('Z4. "зөвхөн текст" бүлэг · тэмдэг + тайлбартай', /txt\|·\|.+/.test(R.txtRoot), R.txtRoot);
    check('Z4. Хэсэгчлэн виджетийн навч ! тэмдэгтэй', R.leafSt === '!', R.leafSt);
    check('Z4. Навч бүтэн нэр + хэсгээ title-д хэлнэ', R.leafTitle.indexOf(' · ') > 0, R.leafTitle);
    check('Z4. Навч доор хэсгийн нэр харагдана (ижил нэрийг ялгана)', R.leafNote.length > 0, R.leafNote);
    check('Z4. Навч дээр хулгана барихад тухайн виджетийн preview гарна',
      R.popVis && R.popPv && R.popFor === R.leafId && !!R.leafId, JSON.stringify({ v: R.popVis, pv: R.popPv, f: R.popFor, id: R.leafId }));
    check('Z4. Хулгана гарахад preview нуугдана', R.popHidden);
    check('Z4. Дата холболтын виджет чип дээр ч preview гарна', R.chip && R.chipPop, JSON.stringify({ chip: R.chip, pop: R.chipPop }));
    check('Z4. Сайтын текст анхнаасаа ХУРААСАН (талбар 0, бүлэг ' + R.g0 + ')', R.g0 >= 20 && R.f0 === 0, 'талбар ' + R.f0);
    check('Z4. Хураасан бүлэг бүр одоогийн утгын хураангуйтай', R.ex0 === R.g0, R.ex0 + '/' + R.g0);
    check('Z4. Бүлэг бүр байршлын схемтэй', R.loc0 === R.g0, R.loc0 + '/' + R.g0);
    check('Z4. Хуудсаар тойм: Бүгд + Нүүр + Админ',
      R.toc.indexOf('any') === 0 && R.toc.indexOf('home') > 0 && R.toc.indexOf('admin') > 0, R.toc.join(','));
    check('Z4. "Бүгдийг дэлгэх" бүх талбарыг гаргана (' + R.fAll + ')', R.fAll > 1000, String(R.fAll));
    check('Z4. "Бүгдийг хураах" буцааж хураана', R.fCollapsed === 0, String(R.fCollapsed));
    check('Z4. "Нүүр" шүүлт зөвхөн нүүрний бүлгийг үлдээнэ',
      R.homeN > 0 && R.homeN < R.g0 && R.homePages.length === 1 && R.homePages[0] === 'home', JSON.stringify(R.homePages) + ' ' + R.homeN);
    check('Z4. Бүлэг нээхэд талбар гарч aria-expanded=true', R.openFields > 0 && R.openExp === 'true', R.openFields + ' ' + R.openExp);
    check('Z4. Нээсэн бүлэгт "Сайт дээр харах" холбоос шинэ цонхонд',
      /index\.html(#.*)?$/.test(R.link) && R.linkTarget === '_blank', R.link + ' ' + R.linkTarget);
    check('Z4. Хураасан бүлэг засвар хийгдсэнээ харуулна', R.closedDirty === true);
    check('Z4. Хураагаад нээхэд бичсэн утга хэвээр', R.kept === R.orig + ' ZZ', R.kept);
    check('Z4. Хайлт хийхэд тохирох бүлэг автоматаар нээгдэнэ', R.qFields > 0, String(R.qFields));
    check('Z4. Шалгалтын дараа өөрчлөлт үлдээгүй', /алга/.test(R.dirty), R.dirty);
  } finally {
    srv.close();
  }
}

/* ─────────── Z5–Z8. Анхны сэтгэгдэл — 2-р ээлж ───────────
   Z5 — жагсаалтад дотоод ID (w2pb) ил гарахгүй
   Z6 — метрик сонголт 2 алхамтай: талбар (нэг удаа) → нэгтгэл тусдаа
   Z7 — "Дата холболт" таб агуулгын тоймтой, хэсэг бүр рүү үсэрнэ
   Z8 — шинэ текст content.json-д */
async function groupZ2() {
  group('Z5–Z8. Анхны сэтгэгдэл (ID · метрик сонголт · табын тойм)');
  const con = readJson('content.json'), adm = adminScript();
  const mt = con.ui.metrics_tab || {};
  const needM = ['toc_label', 'toc_note', 'toc_inv', 'toc_metrics', 'toc_charts', 'toc_ds', 'toc_svc'];
  const missM = needM.filter((k) => typeof mt[k] !== 'string' || !mt[k]);
  check('Z8. Табын тоймын бичиг content.json-д', missM.length === 0, missM.join(', '));
  check('Z8. Нэгтгэлийн шошго content.json-д',
    typeof (con.ui.metric || {}).agg_label === 'string' && adm.includes("utxt('metric.agg_label'"));
  const ids = Object.keys(readJson('metric_registry.json').widgets);

  if (!CHROME) { skipped('Z5–Z7 (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(4500);
      const R={};
      const back=async()=>{let b,n=0;while((b=d.querySelector('[data-back]'))&&n++<6){b.click();await sleep(250)}};
      /* ── Z5 ── */
      d.querySelector('[data-section="sec-02"]').click(); await sleep(700);
      R.cdt=[...d.querySelectorAll('.cd-t')].map(e=>e.textContent).join(' || ');
      R.cdTitle=(d.querySelector('.cd-n')||{}).title||'';
      await back();
      d.getElementById('allBtn').click(); await sleep(900);
      R.allhead=[...d.querySelectorAll('.allhead')].map(e=>e.textContent).join(' || ');
      d.getElementById('allBtn').click(); await sleep(400);
      await back();
      /* ── Z6 ── */
      d.querySelector('[data-section="hero"]').click(); await sleep(600);
      d.querySelector('[data-widget="hero_fl"]').click(); await sleep(1200);
      const S0=()=>d.querySelector('[data-slot^="hero_fl|"]');
      const og=S0().querySelector('optgroup');
      const fopts=og?[...og.querySelectorAll('option')].map(o=>o.value):[];
      R.fN=fopts.length;
      R.fDup=fopts.map(v=>v.slice(6).split('|')[0]).filter((m,i,a)=>a.indexOf(m)!==i).length;
      R.total=S0().options.length;
      R.aggBefore=!!d.querySelector('[data-slotagg]');
      R.orig=S0().value;
      const pvT=()=>(d.getElementById('pvhost')||{}).innerText||'';
      S0().value='field:Зорчигч|SUM'; S0().dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(1300);
      const ag=d.querySelector('[data-slotagg]');
      R.agg=ag?ag.value:null; R.aggOpts=ag?[...ag.options].map(o=>o.value).join(','):'';
      const t1=pvT();
      if(ag){ ag.value='MAX'; ag.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(1300) }
      R.afterMax=S0().value; R.aggAfter=(d.querySelector('[data-slotagg]')||{}).value;
      R.pvChanged=pvT()!==t1;
      const s2=S0(); s2.value=R.orig; s2.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(1200);
      R.aggGone=!d.querySelector('[data-slotagg]');
      const cc=d.querySelector('[data-tcancel]'); if(cc&&!cc.disabled){ cc.click(); await sleep(300) }
      R.dirty=d.getElementById('dirtyMsg').textContent;
      /* ── Z7 ── */
      d.querySelector('[data-tab="metrics"]').click(); await sleep(1300);
      const js=[...d.querySelectorAll('[data-mtjump]')];
      R.jumps=js.map(b=>b.getAttribute('data-mtjump'));
      R.targets=R.jumps.filter(k=>d.getElementById('mt-'+k)).length;
      R.tocText=(d.querySelector('.mttoc')||{}).textContent||'';
      const last=js[js.length-1];
      if(last){ last.click(); await sleep(900);
        const r=d.getElementById('mt-'+last.getAttribute('data-mtjump')).getBoundingClientRect();
        R.lastTop=Math.round(r.top) }
      return R;
    }`, 150000);
    if (R.__err) { bad('Z5–Z7. DOM шалгалт ажиллав', R.__err); return; }
    const leak = (s) => ids.filter((id) => new RegExp('(^|[^a-z0-9_])' + id + '([^a-z0-9_]|$)').test(s));
    check('Z5. Хэсгийн жагсаалтын мета мөрөнд виджетийн ID алга', R.cdt.length > 0 && leak(R.cdt).length === 0, leak(R.cdt).join(',') + ' | ' + R.cdt.slice(0, 120));
    check('Z5. ID хөгжүүлэгчид title-д үлдсэн', /w2p/.test(R.cdTitle), R.cdTitle);
    check('Z5. Бүх харагдацын картын толгойд ID алга', R.allhead.length > 0 && leak(R.allhead).length === 0, leak(R.allhead).join(','));
    check('Z6. Талбар бүр сонголтод НЭГ л удаа (' + R.fN + ')', R.fN >= 3 && R.fDup === 0, 'давхардал ' + R.fDup);
    check('Z6. Нийт сонголт 25-аас бага (' + R.total + ')', R.total < 25, String(R.total));
    check('Z6. Бүртгэлтэй метрикт нэгтгэлийн сонголт гарахгүй', R.aggBefore === false);
    check('Z6. Талбар сонгоход нэгтгэл тусдаа гарна (SUM)', R.agg === 'SUM' && R.aggOpts === 'SUM,AVG,MIN,MAX', R.agg + ' ' + R.aggOpts);
    check('Z6. Нэгтгэл солиход утга шинэчлэгдэнэ', R.afterMax === 'field:Зорчигч|MAX' && R.aggAfter === 'MAX', R.afterMax + ' ' + R.aggAfter);
    check('Z6. Нэгтгэл солиход preview өөрчлөгдөнө', R.pvChanged === true);
    check('Z6. Метрик руу буцахад нэгтгэл нуугдаж, өөрчлөлт үлдэхгүй',
      R.aggGone && /алга/.test(R.dirty), R.aggGone + ' ' + R.dirty);
    check('Z7. Табын тойм 5 хэсэгтэй, бүгд байна', R.jumps.length === 5 && R.targets === 5, R.jumps.join(','));
    check('Z7. Тойм табын зорилгыг хэлнэ', R.tocText.length > 40, R.tocText.slice(0, 80));
    check('Z7. Хэсэг рүү үсэрнэ', typeof R.lastTop === 'number' && R.lastTop < 250 && R.lastTop > -50, String(R.lastTop));
  } finally {
    srv.close();
  }
}

/* ─────────── Z9–Z11. ux-qa-persona 3-р ээлжийн олдвор ───────────
   Z9  — датасэтийн дэлгэрэнгүйд НЭРНИЙ hash-аас зохиосон тоо гарахгүй
   Z10 — ⌖ модальд хөгжүүлэгчийн тэмдэглэл/ID анхдагчаар ил гарахгүй
   Z11 — Сайтын текст табын дэд гарчигт файлын зам алга */
async function groupZ3() {
  group('Z9–Z11. Зохиомол тоо · модалийн тэмдэглэл · файлын зам');
  const idx = read('index.html'), con = readJson('content.json'), adm = adminScript();
  check('Z9. 7 хоногийн гүйцэтгэл нэрний hash-аас тооцогдохгүй',
    !idx.includes('wpUnitList') && !/wpBase|wpWowPct|wpPlanPct/.test(idx) && idx.includes('wpNoData:true'));
  check('Z9. Мөрийн тоо нэрний уртаас зохиогдохгүй',
    !idx.includes('dsel.name.length*1370') && idx.includes('const dsRows=null'));
  check('Z9. "Эх сурвалж холбогдоогүй" тайлбар content.json-д',
    typeof (con.site.detail || {}).wp_no_source === 'string' && idx.includes("stxt('detail.wp_no_source'"));
  const st = con.ui.site_tab;
  const leaky = ['heading', 'ui_heading', 'ufh_heading', 'auto_heading', 'auto_where']
    .filter((k) => /content\.json|ui_form|→ ui\b/.test(st[k] || ''));
  check('Z11. Сайтын текст табын гарчиг/тайлбарт файлын зам алга', leaky.length === 0, leaky.join(', '));
  const fbLeak = ["'Админы интерфейсийн текст · content.json → ui'", "content.json → ui_form'", "'Бусад бүртгэлтэй текст · content.json'"]
    .filter((s) => adm.includes(s));
  check('Z11. Кодын fallback-д ч файлын зам алга', fbLeak.length === 0, fbLeak.join(', '));
  check('Z10. Техникийн мэдээлэл эвхэгддэг хэсэгт', adm.includes('<details class="acc lotech"'));

  if (!CHROME) { skipped('Z9–Z10 (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const A = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(4500);
      const R={};
      d.querySelector('[data-section="hero"]').click(); await sleep(700);
      const b=d.querySelector('[data-mo="loc|hero_fl"]'); if(!b) return {__err:'⌖ товч алга'};
      b.click(); await sleep(600);
      R.eyebrow=d.getElementById('moK').textContent;
      const body=d.getElementById('moB');
      const det=body.querySelector('details.lotech');
      R.det=!!det; R.detOpen=det?det.open:null;
      /* details хаалттай үед доторх текст innerText-д орохгүй */
      R.visible=body.innerText;
      R.link=!!body.querySelector('a[href*="#hero"]');
      return R;
    }`, 120000);
    if (A.__err) bad('Z10. DOM шалгалт ажиллав', A.__err);
    else {
      const note = String(con.widgets.hero_fl._note || '');
      check('Z10. Модалийн дээд мөрөнд виджетийн ID алга', !/hero_fl/i.test(A.eyebrow), A.eyebrow);
      check('Z10. Модалийн дээд мөр хэсгийн нэрийг хэлнэ', A.eyebrow.indexOf('·') > 0 && A.eyebrow.length > 6, A.eyebrow);
      check('Z10. Техникийн хэсэг анхдагчаар ХААЛТТАЙ', A.det === true && A.detOpen === false);
      check('Z10. Хөгжүүлэгчийн тэмдэглэл ил харагдахгүй',
        note.length > 10 && A.visible.indexOf(note.slice(0, 20)) < 0, A.visible.slice(0, 120));
      check('Z10. "Сайт дээр нээх" холбоос хэвээр', A.link === true);
      check('Z10. Ижил метрикийн хэсэгт кодын түлхүүр/салбарын код алга',
        A.visible.indexOf('air.flight_count_last_month') < 0 && !/ · air/.test(A.visible), A.visible.slice(-160));
    }
    const ds = (con.site.datasets || [])[0] || {};
    const slug = ds.sector + '__' + String(ds.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
    PROBE_SRC = '/index.html#/browse/' + encodeURIComponent(slug);
    const D = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(6000);
      const vals=[...d.querySelectorAll('[data-wp-val]')].map(e=>e.textContent.trim());
      const nd=d.querySelector('[data-wp-nodata]');
      return {vals:vals, nodata:nd?nd.textContent.trim():'', text:d.body.innerText,
              plan:!!d.querySelector('[data-wp-plan]')};
    }`, 120000);
    if (D.__err) bad('Z9. Дэлгэрэнгүй хуудас ачаалагдав', D.__err);
    else {
      check('Z9. Дөрвөн утга "—" (зохиомол тоо алга)',
        D.vals.length === 4 && D.vals.every((v) => v === '—'), JSON.stringify(D.vals));
      /* Z15 — эх сурвалжгүй үед "2025 оны төлөвлөгөө — —" гэсэн хоосон мөр гарахгүй */
      check('Z15. Эх сурвалжгүй үед төлөвлөгөөний мөр нуугдана', D.plan === false, String(D.plan));
      check('Z9. "Эх сурвалж холбогдоогүй" гэж ил хэлнэ', D.nodata === con.site.detail.wp_no_source, D.nodata);
      const fake = (12000 + String(ds.name).length * 1370).toLocaleString('en-US');
      check('Z9. Хуучин зохиомол мөрийн тоо (' + fake + ') гарахгүй', D.text.indexOf(fake) < 0);
    }
  } finally {
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* ─────────── Z12–Z14. ux-qa-persona 3-р ээлжийн үлдэгдэл ───────────
   Z12 — баримтын хуудасны тоо нэрнээс зохиогдохгүй
   Z13 — коммунитийн эсрэг санал/дэмжлэгийн хувь зохиогдохгүй
   Z14 — доод мөрийн тайлбарт git-ийн үг алга */
async function groupZ4() {
  group('Z12–Z14. Баримтын хуудас · коммунитийн хувь · доод мөр');
  const idx = read('index.html'), con = readJson('content.json');
  check('Z12. Баримтын хуудасны тоо нэрний уртаас тооцогдохгүй',
    !/const seed=\(d\[1\]\.length/.test(idx) && !idx.includes('48+seed*6'));
  check('Z12. Гарчигт зохиомол хуудасны дугаар алга',
    !/Math\.round\(pages\*0\.\d+\)/.test(idx));
  check('Z12. Хуудасны тоо тодорхойгүй гэж хэлнэ (content.json)',
    typeof (con.site.doc || {}).pages_unknown === 'string' && idx.includes("stxt('doc.pages_unknown'"));
  check('Z13. Эсрэг санал дэмжлэгийн 14% гэж зохиогдохгүй',
    !/support\*0\.14/.test(idx));
  check('Z13. Саналгүй хүсэлтэд дур мэдэн 24 өгөхгүй',
    !/\|\|24,goal/.test(idx));
  check('Z13. "Эсрэг санал: мэдээлэл алга" content.json-д',
    typeof (con.site.community_data || {}).share_unknown === 'string' &&
    idx.includes("stxt('community_data.share_unknown'"));
  check('Z14. Доод мөрийн тайлбарт "commit" үг алга',
    !/commit/i.test(con.ui.app.export_note) && !/data-ui="app\.export_note">[^<]*commit/i.test(read('admin/index.html')),
    con.ui.app.export_note);

  if (!CHROME) { skipped('Z13 (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    PROBE_SRC = '/index.html#/community';
    const C = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(6000);
      return {text:d.body.innerText};
    }`, 120000);
    if (C.__err) bad('Z13. Коммунити хуудас ачаалагдав', C.__err);
    else {
      const pcts = C.text.match(/\d+% дэмжсэн/g) || [];
      check('Z13. "NN% дэмжсэн" зохиомол хувь гарахгүй', pcts.length === 0, pcts.slice(0, 3).join(', '));
      check('Z13. Эсрэг саналын мэдээлэл алга гэж ил хэлнэ',
        C.text.indexOf(con.site.community_data.share_unknown) >= 0);
    }
  } finally {
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* ─────────── Z16–Z18. ux-qa-persona 4-р ээлжийн олдвор ───────────
   Z16 — датасэтийн "N дагагч" нэрний уртаас зохиогдохгүй
   Z17 — баримтын од/үнэлгээний тоо, жишээ сэтгэгдэл зохиогдохгүй
   Z18 — "24 датасет холбогдсон" хатуу тоо алга */
async function groupZ5() {
  group('Z16–Z18. Дагагч · баримтын үнэлгээ · AI-ийн датасетийн тоо');
  const idx = read('index.html'), con = readJson('content.json');
  check('Z16. Дагагчийн тоо нэрний уртаас тооцогдохгүй', !/dsel\.name\.length\*37/.test(idx));
  check('Z16. Бодит тоо ирээгүй үед дагагчийн тоо нуугдана',
    idx.includes('hasFollowers') && idx.includes('<sc-if value="{{ detail.hasFollowers }}">'));
  check('Z17. Үнэлгээ гарчгийн уртаас тооцогдохгүй',
    !/d\[1\]\.length\*3/.test(idx) && !/18\+\(d\[1\]\.length%23\)/.test(idx));
  check('Z17. Бүх баримтад давтагддаг жишээ сэтгэгдэл алга',
    !idx.includes('Т.Golearig') && !idx.includes('Н.Сарантуяа'));
  check('Z17. "Үнэлгээ алга" content.json-д',
    typeof (con.site.doc || {}).no_ratings === 'string' && idx.includes("stxt('doc.no_ratings'"));
  const all24 = [JSON.stringify(con), idx].join('\n').match(/24 датасет/g) || [];
  check('Z18. "24 датасет" хатуу тоо сайт ба content.json-д алга', all24.length === 0, all24.length + ' удаа');
  check('Z18. Датасетийн тоо каталогоос тооцогдоно', idx.includes("DATASETS.length+' датасет"));

  /* ── Z19. "AI ИТГЭЛ %" — хатуу жагсаалтаас гардаг чимэглэл ──
     [94,88,91,86,83] нь эх сурвалжгүй, гэтэл 2026-09-18-наас хойш яг
     хажууд нь АМЬД тоо (вагон ачилт) гарах болсон тул иргэн үүнийг
     тухайн өгөгдлийн үнэн зөвийн хэмжүүр гэж уншина. Мөрийг бүхэлд нь
     хасав — k04.foot2 ("AI итгэл") ч content.json-оос устсан байх ёстой,
     эс тэгвэл үхмэл текст үлдэнэ. */
  /* Яагаад устгасныг тайлбарласан КОММЕНТ дотор жагсаалт дурдагдаж
     болно (miniSpark-ийн ижил тохиолдол) — КОД дотор УТГА ОЛГОЛТООР
     үлдээгүй эсэхийг шалгана. */
  check('Z19. Итгэлийн хатуу жагсаалт кодод алга',
    !/=\s*\[94,\s*88,\s*91/.test(idx) && !/\[94,\s*88,\s*91[^\]]*\]\[i%5\]/.test(idx));
  check('Z19. Темплейтэд conf/confWidth үлдээгүй',
    !idx.includes('{{ k.conf }}') && !idx.includes('{{ k.confWidth }}') && !/conf,confWidth:/.test(idx));
  check('Z19. k04.foot2 ("AI итгэл") content.json-д үлдээгүй',
    con.widgets.k04 && con.widgets.k04.foot2 === undefined, JSON.stringify(con.widgets.k04));
  check('Z19. k04-ийн бусад бичиг ХЭВЭЭР (foot, title)',
    !!(con.widgets.k04 && con.widgets.k04.title && con.widgets.k04.foot));

  if (!CHROME) { skipped('Z17–Z19 (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    PROBE_SRC = '/index.html#/news';
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(6000);
      const R={};
      const b=[...d.querySelectorAll('button')].find(x=>/PDF/.test(x.innerText)&&x.innerText.length<260);
      if(!b) return {__err:'баримтын товч алга'};
      b.click(); await sleep(1500);
      R.text=d.body.innerText;
      return R;
    }`, 120000);
    if (R.__err) bad('Z17. Баримтын хуудас нээгдэв', R.__err);
    else {
      check('Z17. Бодит үнэлгээгүй баримт "Үнэлгээ алга" гэнэ', R.text.indexOf(con.site.doc.no_ratings) >= 0);
      check('Z17. "NN үнэлгээ" зохиомол тоо гарахгүй', !/\d+ үнэлгээ/.test(R.text), (R.text.match(/\d+ үнэлгээ/) || [''])[0]);
    }
    PROBE_SRC = '/index.html';
    const H = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(6000);
      return {text:d.body.innerText};
    }`, 120000);
    if (H.__err) bad('Z18. Нүүр хуудас ачаалагдав', H.__err);
    else {
      check('Z18. Нүүр хуудсанд "24 датасет" алга', H.text.indexOf('24 датасет') < 0);
      check('Z19. Нүүр хуудсанд "AI итгэл" мөр алга', !/AI\s*итгэл/i.test(H.text),
        (H.text.match(/.{0,30}AI\s*итгэл.{0,30}/i) || [''])[0]);
    }
  } finally {
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* ──────────────── BE. etransport-backend холболт (js/erthub-backend.js) ──────────────── */
/* Backend нийтийн болсон (https://portal.mrt.gov.mn, 2026-09-17) тул
   модуль URL-ийг зөв угсарч, алдаа/хоосон хариуг ЗОХИОМОЛ ТОО БОЛГОХГҮЙ
   байгааг гараар бодох боломжтой фикстураар шалгана. */
async function groupBE() {
  group('BE. etransport-backend холболт');
  const vm = require('vm');
  const cfg = read('js/backend-config.js');
  const m = cfg.match(/const ETRANSPORT_BACKEND_BASE\s*=\s*"([^"]*)"/);
  const base = m ? m[1] : null;
  check('BE1. backend-config.js-д BASE тодорхойлогдсон', base !== null);
  check('BE1. BASE хоосон эсвэл https:// (mixed content-гүй)', base === '' || /^https:\/\//.test(base), base);
  check('BE1. BASE төгсгөлд "/" алга', !base || !base.endsWith('/'), base);

  const modSrc = read('js/erthub-backend.js');
  function load(BASE, fetchImpl) {
    const calls = [];
    const ctx = { window: {}, console: { info() {} }, setTimeout, clearTimeout, AbortController,
      ETRANSPORT_BACKEND_BASE: BASE,
      fetch: (u, o) => { calls.push(u); return fetchImpl(u, o); } };
    vm.runInNewContext(modSrc, ctx);
    return { B: ctx.window.EHBackend, calls };
  }
  const okJson = (j) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(j) });

  const e = load('', okJson({}));
  const r0 = await e.B.fetchRailWagonLoading();
  check('BE2. BASE хоосон → enabled=false, сүлжээний хүсэлт 0', e.B.enabled === false && e.calls.length === 0 && r0 === null);

  const a = load('https://x.test', okJson({ sector: 'rail', status: 'ok', count: 6415 }));
  const r1 = await a.B.fetchRailWagonLoading();
  /* Вагон ачилт ТУСДАА endpoint-оос ирнэ — summary руу буцаж унавал
     gold-ийн сарын зорчигчийн тоог вагон гэж ХУДАЛ уншина. */
  check('BE3. URL = BASE + /api/sectors/rail/wagon-loading',
    a.calls[0] === 'https://x.test/api/sectors/rail/wagon-loading', a.calls[0]);
  check('BE3. JSON хариу дамжина', r1 && r1.count === 6415);
  const a2 = load('https://x.test', okJson({ sector: 'road', status: 'ok', data: [] }));
  await a2.B.fetchSectorSummary('road');
  check('BE3. fetchSectorSummary нь summary URL хэвээр',
    a2.calls[0] === 'https://x.test/api/sectors/road/summary', a2.calls[0]);

  const n = load('https://x.test', () => Promise.reject(new Error('net down')));
  check('BE4. Сүлжээний алдаа → null (унахгүй)', (await n.B.fetchRailWagonLoading()) === null);
  const h = load('https://x.test', () => Promise.resolve({ ok: false, status: 500 }));
  check('BE5. HTTP 500 → null', (await h.B.fetchRailWagonLoading()) === null);

  /* val() — index.html-ийн логикийг шууд гаргаж авч шалгана */
  const vs = dcScript().match(/\n  val\(widgetId,fallback\)\{([\s\S]*?)\n  \}\n/);
  if (!vs) { bad('BE6. val() олдсонгүй'); return; }
  const val = new Function('widgetId', 'fallback', vs[1]);
  const reg = { widgets: { w: { metric: 'rail.wagon_loading' } } };
  const call = (live) => val.call({ state: { metricRegistry: reg }, _railWagonLoading: live }, 'w', '—');
  const v0 = call({ sector: 'rail', status: 'ok', data: [] });
  check('BE6. Хоосон data:[] → fallback "—" (тоо зохиохгүй)', v0.isFallback === true && v0.value === '—', JSON.stringify(v0));
  const v1 = call(undefined);
  check('BE6. Backend хариугүй → fallback', v1.isFallback === true);
  const v2 = call({ count: 322, monthLabel: '9-р сар' });
  check('BE7. count=322 → "322", fallback биш', v2.isFallback === false && v2.value === '322', JSON.stringify(v2));

  const reg2 = readJson('metric_registry.json');
  /* 2026-09-18: УБТЗ-ийн эх файлтай 09-17-ны өдрөөр тулгаж 35/35 станц ЯГ
     таарсны ДАРАА verified болгосон. Метрик verified байхад ямар ч виджетэд
     холбогдоогүй нь ЗӨВ төлөв — холбох нь тусдаа шийдвэр. */
  check('BE8. rail.wagon_loading quality:"verified" (эх файлтай тулгасан)',
    reg2.metrics['rail.wagon_loading'] && reg2.metrics['rail.wagon_loading'].quality === 'verified');
  check('BE8. mtd багана нийлбэрт ОРОХГҮЙ гэдэг registry-д тэмдэглэгдсэн',
    /mtd/.test(reg2.metrics['rail.wagon_loading'].column) &&
    /ХУРИМТЛАЛ/.test(reg2.metrics['rail.wagon_loading'].column));
  check('BE8. rail.wagon_loading виджетэд ХОЛБОГДСОН (2026-09-18)',
    Object.values(reg2.widgets).some(w => JSON.stringify(w).includes('rail.wagon_loading')));

  /* ── BE9. Backend-ийн ХАРИУ → val()-ийн хүлээх хэлбэр ──
     Backend нь {sector,status,data:[{month,total_volume}]} буцаадаг атлаа
     val() нь `count`-ыг уншдаг байв — өгөгдөл ирж эхэлсэн ч сайт чимээгүй
     "—" хэвээр үлдэх байсан. sectorSummaryToValue() хоёрыг холбоно.
     Гараар бодох боломжтой фикстур: 2 сар → ХАМГИЙН СҮҮЛИЙНХ. */
  const bs = dcScript().match(/function sectorSummaryToValue\(json\)\{([\s\S]*?)\n\}/);
  if (!bs) { bad('BE9. sectorSummaryToValue() олдсонгүй'); return; }
  const toVal = new Function('MONTHS', 'json', bs[1])
    .bind(null, readJson('content.json').site.months);
  const row = (m, v) => ({ sector: 'rail', month: m, total_volume: v });
  check('BE9. Хоосон data → null (тоо ЗОХИОХГҮЙ)', toVal({ sector: 'rail', status: 'ok', data: [] }) === null);
  check('BE9. Хариугүй → null', toVal(null) === null && toVal(undefined) === null);
  check('BE9. status:"no_data" → null', toVal({ status: 'no_data', message: 'Мэдээлэл алга', data: [] }) === null);
  const be1 = toVal({ status: 'ok', data: [row('2026-09-01T00:00:00.000Z', '50')] });
  check('BE9. Нэг мөр → count 50, "9-р сар"', !!be1 && be1.count === 50 && be1.monthLabel === '9-р сар', JSON.stringify(be1));
  const be2 = toVal({ status: 'ok', data: [row('2026-07-01T00:00:00.000Z', '10'), row('2026-08-01T00:00:00.000Z', '7')] });
  check('BE9. Хоёр сар → СҮҮЛИЙНХ (8-р сар, 7)', !!be2 && be2.count === 7 && be2.monthLabel === '8-р сар', JSON.stringify(be2));
  check('BE9. Тоон бус утга → null', toVal({ status: 'ok', data: [row('2026-09-01T00:00:00.000Z', 'тодорхойгүй')] }) === null);
  check('BE9. Огноогүй мөр → null (сар зохиохгүй)', toVal({ status: 'ok', data: [{ total_volume: '5' }] }) === null);
  /* ── BE10. Вагон ачилтын ТУСДАА endpoint → val()-ийн хэлбэр ──
     Фикстур нь УБТЗ-ийн эх файлаар БАТАЛГААЖСАН бодит хариу (2026-09-17):
     1182 ачсан / 1027 буусан / 35 станц. Хамгийн сүүлийн ХОНОГИЙН дүн тул
     сарын шошго биш ОГНОО буцаана — хоногийн датаг "9-р сар" гэвэл бүтэн
     сарыг төлөөлж байгаа мэт ХУДАЛ уншигдана. */
  const ws = dcScript().match(/function wagonLoadingToValue\(json\)\{([\s\S]*?)\n\}/);
  if (!ws) { bad('BE10. wagonLoadingToValue() олдсонгүй'); return; }
  const toW = new Function('json', ws[1]);
  const live = { sector: 'rail', metric: 'wagon_loading', status: 'ok', date: '2026-09-17',
    unit: 'вагон', count: 1182, unloaded_count: 1027, station_count: 35 };
  const w1 = toW(live);
  check('BE10. count 1182, огноо 2026-09-17', !!w1 && w1.count === 1182 && w1.date === '2026-09-17', JSON.stringify(w1));
  check('BE10. Шошго нь ОГНОО (сарын нэр БИШ)', !!w1 && w1.monthLabel === '2026-09-17' && !/сар/.test(String(w1.monthLabel)));
  check('BE10. Нэгж ба станцын тоо дамжина', !!w1 && w1.unit === 'вагон' && w1.stationCount === 35 && w1.unloadedCount === 1027);
  check('BE10. status:"no_data" → null (тоо ЗОХИОХГҮЙ)',
    toW({ status: 'no_data', message: 'Мэдээлэл алга', count: null }) === null);
  check('BE10. Хариугүй → null', toW(null) === null && toW(undefined) === null);
  check('BE10. count дутуу/хоосон → null (0 гэж ХУДАЛ харуулахгүй)',
    toW({ status: 'ok', date: '2026-09-05' }) === null && toW({ status: 'ok', count: '' }) === null);
  check('BE10. Тоон бус count → null', toW({ status: 'ok', count: 'тодорхойгүй' }) === null);
  check('BE10. Сөрөг count → null', toW({ status: 'ok', count: -5 }) === null);
  check('BE10. count 0 бол 0 (бодит тэг ≠ дата алга)', (toW({ status: 'ok', count: 0 }) || {}).count === 0);
  check('BE10. Сайт вагон ачилтыг wagonLoadingToValue-ээр хөрвүүлнэ',
    dcScript().includes('this._railWagonLoading=wagonLoadingToValue(d)') &&
    !/this\._railWagonLoading=sectorSummaryToValue\(d\)/.test(dcScript()) &&
    !/if\(d\) this\._railWagonLoading=d;/.test(dcScript()));

  /* ── BE11. ВИДЖЕТИЙН ХОЛБООС — registry ба админы нэгжийн ГЭРЭЭ ──
     Метрик "verified" байх нь хангалтгүй: слотын ШААРДАХ НЭГЖ (админы
     FIXED_UNIT) метрикийнхтэй таарахгүй бол why() амьд холбоосыг
     "нэгж үл нийцнэ" гэж блоклоод, дараагийн хадгалалт түүнийг САЛГАНА.
     Хоёр файлын утга зөрөх нь энэ төсөлд ойр ойрхон гардаг алдаа тул
     хамтад нь шалгана. */
  const sl = (id, key) => ((reg2.widgets[id] || {}).sectors || {})[key] || {};
  check('BE11. ls.rail → rail.wagon_loading (verified)',
    sl('ls', 'rail').metric === 'rail.wagon_loading' && sl('ls', 'rail').quality === 'verified',
    JSON.stringify(sl('ls', 'rail')));
  check('BE11. k04.rail → rail.wagon_kpi_set (verified)',
    sl('k04', 'rail').metric === 'rail.wagon_kpi_set' && sl('k04', 'rail').quality === 'verified',
    JSON.stringify(sl('k04', 'rail')));
  check('BE11. u07.rail → rail.feed_updated_at (verified)',
    sl('u07', 'rail').metric === 'rail.feed_updated_at' && sl('u07', 'rail').quality === 'verified',
    JSON.stringify(sl('u07', 'rail')));
  check('BE11. u07.air холбоос ХЭВЭЭР (air.feed_updated_at)',
    sl('u07', 'air').metric === 'air.feed_updated_at');
  check('BE11. u07-ийн эх сурвалжгүй 3 мөр "мэдээлэл алга" шошготой',
    ['road', 'water', 'public'].every(k => sl('u07', k).metric === null && sl('u07', k).label && sl('u07', k).would_need));
  check('BE11. Шинэ метрик 2 нь metrics{}-д verified',
    ['rail.wagon_kpi_set', 'rail.feed_updated_at']
      .every(k => reg2.metrics[k] && reg2.metrics[k].quality === 'verified'));
  check('BE11. Шинэ метрик тус бүр датасэттэй (каталогт нэрээр гарна)',
    ['rail.wagon_kpi_set', 'rail.feed_updated_at']
      .every(k => reg2.metrics[k].dataset === 'silver.rail_wagon_loading'));

  const adm = adminScript();
  const fuBlock = (adm.match(/var FIXED_UNIT=\{([\s\S]*?)\n\};/) || [])[1] || '';
  const fixed = {};
  for (const fm of fuBlock.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) fixed[fm[1]] = fm[2];
  check('BE11. ls.rail шаардах нэгж = метрикийн нэгж ("вагон", "км" БИШ)',
    fixed['ls.rail'] === reg2.metrics['rail.wagon_loading'].unit, fixed['ls.rail']);
  check('BE11. k04.rail шаардах нэгж = "mixed" (3 мөр өөр нэгжтэй)',
    fixed['k04.rail'] === reg2.metrics['rail.wagon_kpi_set'].unit, fixed['k04.rail']);
  check('BE11. u07 салбар бүрийн шаардах нэгж "огноо"',
    ['air', 'rail', 'road', 'water', 'public'].every(k => fixed['u07.' + k] === 'огноо'));

  /* ── BE12. applyRailWagonData() — ГАРААР БОДОХ фикстур ──
     Эх файлаар баталгаажсан 2026-09-17: 1182 ачсан / 1027 буусан / 35 станц.
     Тоо · НЭГЖИЙН ШОШГО · МӨРИЙН НЭР гурвыг ХАМТ шалгана (аль нэг нь
     хуучнаараа үлдвэл хуудас ХУДАЛ тайлбарлана). */
  const arm = dcScript().match(/\n  applyRailWagonData\(\)\{([\s\S]*?)\n  \}\n/);
  if (!arm) { bad('BE12. applyRailWagonData() олдсонгүй'); return; }
  /* dataAgeDays/WAGON_STALE_DAYS-ийг ГАДНААС өгнө: эс тэгвэл тест
     "өнөөдөр" хэзээ ажиллахаас хамаарч ногоон/улаан солигдоно. */
  const mkApply = new Function('SECTORS', 'DS_SCHEMA', 'stxt', 'fmtNum',
    'dataAgeDays', 'WAGON_STALE_DAYS', 'return function(){' + arm[1] + '}');
  const RAILTXT = {
    'sector_kpi_rail_live.0': 'ХОНОГИЙН АЧИЛТ',
    'sector_kpi_rail_live.1': 'ХОНОГИЙН БУУЛГАЛТ',
    'sector_kpi_rail_live.2': 'АЧИЛТТАЙ СТАНЦ',
    'unit.wagon': 'вагон', 'unit.station': 'станц',
    'status.rail_wagon_compare': 'харьцуулах өгөгдөл алга (өмнөх хоногийн дүн ирээгүй)',
    'status.rail_wagon_asof': 'Хоногийн мэдээ:', 'status.rail_wagon_stale': 'хоног шинэчлэгдээгүй',
    'ds_schema_rail_wagon.head.0': 'Станц', 'ds_schema_rail_wagon.head.1': 'Код',
    'ds_schema_rail_wagon.head.2': 'Ачсан (вагон)', 'ds_schema_rail_wagon.head.3': 'Буулгасан (вагон)',
    'ds_schema_rail_wagon.head.4': 'Төлөв',
    'ds_schema_rail_wagon.st_loaded': 'Ачилттай', 'ds_schema_rail_wagon.st_none': 'Зөвхөн буулгалт',
    'sector_rank_rail_live': 'Станц тус бүрийн ачилт', 'sector_rank_rail_other': 'Бусад станц',
    'sector_chart2_rail_live': 'Ачилт ихтэй станц'
  };
  const runApply = (live, ageDays) => {
    const SEC = { rail: { label: 'Төмөр зам', kpis: [['НИЙТ ЗАМ', '1,815', 'км', '+0.4%', 'up']],
      rt: 'Чиглэл тус бүрийн ачаа', rank: [['УБ–Замын-Үүд', '8.4M', '37.2%']],
      c2: 'Ачааны төрлөөр (тонн)', bars: [['Нүүрс', 88, '12.4M тн']] } };
    const DSS = { rail_wagon: { head: [], types: ['string','string','int','int','enum'], notes: [], rows: [] } };
    const ctx = { _railWagonLoading: live, _meta: null, _st: null,
      setSourceMeta(id, m) { this._meta = { id, m } }, setState(s) { this._st = s } };
    mkApply(SEC, DSS, (p, f) => (RAILTXT[p] !== undefined ? RAILTXT[p] : f),
      (n) => Number(n).toLocaleString('en-US'),
      () => (ageDays === undefined ? 1 : ageDays), 2).call(ctx);
    return { SEC, ctx, DSS };
  };
  const con12 = readJson('content.json');
  const A = runApply({ count: 1182, unloadedCount: 1027, stationCount: 35, date: '2026-09-17' });
  const kr = A.SEC.rail.kpis;
  check('BE12. 3 мөр үүснэ (ачилт/буулгалт/станц)', kr.length === 3, JSON.stringify(kr));
  check('BE12. kpis[0] = ХОНОГИЙН АЧИЛТ · 1,182 · вагон',
    kr[0][0] === 'ХОНОГИЙН АЧИЛТ' && kr[0][1] === '1,182' && kr[0][2] === 'вагон', JSON.stringify(kr[0]));
  check('BE12. kpis[1] = ХОНОГИЙН БУУЛГАЛТ · 1,027 · вагон',
    kr[1][0] === 'ХОНОГИЙН БУУЛГАЛТ' && kr[1][1] === '1,027' && kr[1][2] === 'вагон', JSON.stringify(kr[1]));
  check('BE12. kpis[2] = АЧИЛТТАЙ СТАНЦ · 35 · станц',
    kr[2][0] === 'АЧИЛТТАЙ СТАНЦ' && kr[2][1] === '35' && kr[2][2] === 'станц', JSON.stringify(kr[2]));
  check('BE12. Өөрчлөлтийн хувь ЗОХИОХГҮЙ — мөр бүр "—"', kr.every(r => r[3] === '—'));
  check('BE12. Мөр бүр ЯМАР ӨДРИЙН тоо болохоо хэлнэ (огноогүй тоо = "өнөөдрийнх" мэт уншигдана)',
    kr.every(r => String(r[5] || '').includes('Хоногийн мэдээ: 2026-09-17')), JSON.stringify(kr[0][5]));
  check('BE12. ШИНЭ дата (1 хоног) үед харьцуулалтын шалтгаан хэвээр',
    kr.every(r => /харьцуулах өгөгдөл алга/.test(r[5] || '')) &&
    kr.every(r => !/шинэчлэгдээгүй/.test(r[5] || '')), JSON.stringify(kr[0][5]));
  check('BE12. Хуучин статик мөр (1,815 км) БҮРЭН солигдоно',
    !JSON.stringify(kr).includes('1,815') && !JSON.stringify(kr).includes('НИЙТ ЗАМ'));
  check('BE12. _liveKpis=true (KPI мөр амьд боллоо)', A.SEC.rail._liveKpis === true);
  check('BE12. u07-ийн огноо railWagon мета руу бичигдэнэ',
    A.ctx._meta && A.ctx._meta.id === 'railWagon' && A.ctx._meta.m.updatedAt === '2026-09-17',
    JSON.stringify(A.ctx._meta));
  const A0 = runApply(null);
  check('BE12. Дата ирээгүй → SECTORS.rail ОГТ хөндөгдөхгүй',
    A0.SEC.rail.kpis.length === 1 && A0.SEC.rail.kpis[0][1] === '1,815' && !A0.SEC.rail._liveKpis);
  const A1 = runApply({ count: 900, unloadedCount: null, stationCount: null, date: '2026-09-17' });
  check('BE12. Дутуу талбар → тэр мөр ОГТ гарахгүй (0 гэж зохиохгүй)',
    A1.SEC.rail.kpis.length === 1 && A1.SEC.rail.kpis[0][1] === '900');

  /* ── BE12b. ХОЦОРСОН дата — 2026-09-21-нд илэрсэн РЕГРЕСС ──
     Dispatcher өдөр бүр амжилттай гүйсэн (6 датасэтийн last_synced_at =
     тухайн өглөө) атал вагон ачилтын сүүлийн бичлэг 09-17 дээр зогссон:
     ETL эрүүл байхад ЭХ СУРВАЛЖ хоцорсон. Хуудсан дээр 1182 вагон
     огноогүй зогсож байсан тул өнөөдрийн дүн мэт уншигдана. */
  const AS = runApply({ count: 1182, unloadedCount: 1027, stationCount: 35, date: '2026-09-17' }, 4);
  const ks = AS.SEC.rail.kpis;
  check('BE12b. Хоцорсон үед мөр бүр "4 хоног шинэчлэгдээгүй" гэж ил хэлнэ',
    ks.length === 3 && ks.every(r => String(r[5] || '').includes('4 хоног шинэчлэгдээгүй')),
    JSON.stringify(ks[0][5]));
  check('BE12b. Хоцорсон үед: огноо + хоцролт, ЧУХАЛ нь урд (шошгогүй)',
    ks.every(r => r[5] === '2026-09-17 · 4 хоног шинэчлэгдээгүй'), JSON.stringify(ks[0][5]));
  /* Регресс (browser, 1280px): хөл бичгийн сав ~214px, 8px mono үсэг
     ~4.4–4.8px → ~44 тэмдэгт. Шошготой хувилбар 51 тэмдэгт болж
     "шинэчлэгдээгүй" гэдэг үг таслагдаж байв. 3 оронтой хоцролтод ч
     (365 хоног) 40 тэмдэгтээс хэтрэхгүй байх ёстой. */
  const s365 = String(runApply({ count: 5, unloadedCount: null, stationCount: null,
    date: '2026-09-17' }, 365).SEC.rail.kpis[0][5]);
  check('BE12b. Хоцролтын хөл бичиг 40 тэмдэгтэд багтана (таслагдахгүй)',
    ks[0][5].length <= 40 && s365.length <= 40, ks[0][5].length + ' / ' + s365.length);
  check('BE12b. Хоцролт нь харьцуулалтын тайлбарыг СОЛИНО (хөл бичиг уншигдахгүй болохгүй)',
    ks.every(r => !/харьцуулах өгөгдөл алга/.test(r[5] || '')), JSON.stringify(ks[0][5]));
  check('BE12b. ТОО нь хэвээр (хоцорлоо гээд утгыг нуухгүй/зохиохгүй)',
    ks[0][1] === '1,182' && ks[1][1] === '1,027' && ks[2][1] === '35');
  /* Хил: D+1/D+2 нь хэвийн нийтлэлийн хоцролт — сэрэмжлүүлэг ГАРАХГҮЙ. */
  const edge = (n) => String(runApply({ count: 5, unloadedCount: null, stationCount: null,
    date: '2026-09-17' }, n).SEC.rail.kpis[0][5] || '');
  check('BE12b. 2 хоног = ХЭВИЙН (сэрэмжлүүлэг алга)', !/шинэчлэгдээгүй/.test(edge(2)), edge(2));
  check('BE12b. 3 хоног = хоцорсон', /3 хоног шинэчлэгдээгүй/.test(edge(3)), edge(3));
  const AN = runApply({ count: 5, unloadedCount: null, stationCount: null, date: null }, null);
  check('BE12b. Огноогүй хариу → огноо ЗОХИОХГҮЙ, зөвхөн харьцуулалтын шалтгаан',
    !/Хоногийн мэдээ/.test(AN.SEC.rail.kpis[0][5]) &&
    /харьцуулах өгөгдөл алга/.test(AN.SEC.rail.kpis[0][5]), JSON.stringify(AN.SEC.rail.kpis[0][5]));
  check('BE12b. Хоцролтын текст content.json-д бүртгэгдсэн',
    !!(con12.site.status.rail_wagon_asof && con12.site.status.rail_wagon_stale));

  /* ── BE12c. dataAgeDays() — ГАРААР БОДОХ фикстур, "өнөөдөр"-ийг өгнө ── */
  const dam = dcScript().match(/function dataAgeDays\(dateStr,now\)\{([\s\S]*?)\n\}/);
  if (!dam) { bad('BE12c. dataAgeDays() олдсонгүй'); return; }
  const age = new Function('dateStr', 'now', dam[1]);
  const T = new Date(2026, 8, 21); // 2026-09-21 (орон нутгийн)
  check('BE12c. 09-17 → 4 хоног', age('2026-09-17', T) === 4, String(age('2026-09-17', T)));
  check('BE12c. Өнөөдөр → 0', age('2026-09-21', T) === 0);
  check('BE12c. Сарын хил дамжина (08-31 → 2)', age('2026-08-31', new Date(2026, 8, 2)) === 2,
    String(age('2026-08-31', new Date(2026, 8, 2))));
  check('BE12c. Ирээдүйн огноо сөрөг (хоцорсон гэж ХУДАЛ хэлэхгүй)', age('2026-09-22', T) === -1);
  check('BE12c. ISO цагтай огноо ч уншигдана', age('2026-09-17T00:00:00.000Z', T) === 4);
  check('BE12c. Хоосон/буруу огноо → null ("0 хоног" гэж ЗОХИОХГҮЙ)',
    age('', T) === null && age(null, T) === null && age(undefined, T) === null &&
    age('тодорхойгүй', T) === null && age('2026-9-1', T) === null);
  check('BE12c. Хуваарьт хэмжээ кодод, content.json-д БИШ (текст биш тохиргоо)',
    /const WAGON_STALE_DAYS=2;/.test(dcScript()) &&
    con12.site.status.rail_wagon_stale.indexOf('2') === -1);

  /* ── BE13. kpiVerified() — registry "verified" ≠ дата ИРСЭН ──
     Регресс: backend/feed унасан үед статик демо тоо (1,815 км / 11,979)
     амьд утга мэт харагдаж байв. */
  const kvm = dcScript().match(/\n  kpiVerified\(widgetId,sectorKey\)\{([\s\S]*?)\n  \}\n/);
  if (!kvm) { bad('BE13. kpiVerified() олдсонгүй'); return; }
  const kvFn = new Function('SECTORS', 'widgetId', 'sectorKey', kvm[1]);
  const kvCall = (q, liveKpis) => kvFn.call(
    { sectorQuality: () => ({ quality: q }) },
    { rail: { _liveKpis: liveKpis } }, 'k04', 'rail');
  check('BE13. verified + дата ирсэн → true', kvCall('verified', true) === true);
  check('BE13. verified + дата ИРЭЭГҮЙ → false (демо тоо амьд гэж харагдахгүй)',
    kvCall('verified', undefined) === false);
  check('BE13. mock + дата ирсэн ч → false', kvCall('mock', true) === false);
  check('BE13. KPI уншдаг 3 виджет бүгд kpiVerified ашиглана (ls/k04/d05)',
    /this\.kpiVerified\('ls',k\)/.test(dcScript()) &&
    /this\.kpiVerified\('k04',key\)/.test(dcScript()) &&
    /this\.kpiVerified\('d05',k\)/.test(dcScript()));
  check('BE13. air ч ижил гэрээнд орно (_liveKpis тэмдэглэгдэнэ)',
    /SECTORS\.air\._liveKpis=true;/.test(dcScript()));
  check('BE13. Амьд KPI мөрийн нэрийг статик нэрээр ДАРАХГҮЙ',
    /if\(Array\.isArray\(kl\)&&!SECTORS\[k\]\._liveKpis\)/.test(dcScript()));

  /* ── BE14. u07 — мөр бүр САЛБАРААРАА холбогдоно ── */
  const con14 = readJson('content.json');
  const recBlock = (dcScript().match(/const RECENT = \[([\s\S]*?)\n\];/) || [])[1] || '';
  const recN = (recBlock.match(/\{title:/g) || []).length;
  check('BE14. RECENT мөрийн тоо = content.json site.updates-ийн урт',
    recN === con14.site.updates.length && recN === 6, recN + ' vs ' + con14.site.updates.length);
  check('BE14. Вагон ачилтын мөр railWagon эх сурвалжтай, огноо ЗОХИОГҮЙ',
    /source:'railWagon'/.test(recBlock) && /date:'', sector:'rail'/.test(recBlock));
  check('BE14. SOURCES-д railWagon бүртгэлтэй (auditBindings анхааруулахгүй)',
    /railWagon:\{label:/.test(dcScript()));
  check('BE14. buildRecent мөр бүрийн САЛБАРААР холбоосыг шална',
    /u07Bound\(r\.sector\)/.test(dcScript()) &&
    !/const u07Bound=!!\(u07&&u07\.metric\);/.test(dcScript()));
  check('BE14. backend давхар дуудагдахгүй (SOURCES-оор л ачаална)',
    (dcScript().match(/loadEtransportBackend\(\)/g) || []).length === 2,
    String((dcScript().match(/loadEtransportBackend\(\)/g) || []).length));

  /* ── BE15. content.json — шинэ ХАРАГДАХ текст бүртгэгдсэн ── */
  /* 2026-09-22: 4 дэх мөр "ЗОРЧИГЧ / САР" нэмэгдэв (BE26) — вагоны 3 нэр хэвээр. */
  check('BE15. sector_kpi_rail_live 4 мөрийн нэртэй (вагон 3 + зорчигч 1)',
    Array.isArray(con14.site.sector_kpi_rail_live) && con14.site.sector_kpi_rail_live.length === 4 &&
    con14.site.sector_kpi_rail_live[0] === 'ХОНОГИЙН АЧИЛТ');
  check('BE15. unit.wagon / unit.station бүртгэлтэй',
    con14.site.unit.wagon === 'вагон' && con14.site.unit.station === 'станц');
  check('BE15. status.rail_wagon_compare бүртгэлтэй',
    !!con14.site.status.rail_wagon_compare);
  check('BE15. Админы required_unit-д "вагон" бүртгэлтэй (FIXED_UNIT-ийн утга)',
    con14.ui.required_unit['вагон'] === 'вагон');

  /* ── BE16. Админы preview ба сайт ХОЁУЛАА ижил эх сурвалжаас ── */
  check('BE16. Админ backend модулийг ачаална',
    /erthub-backend\.js/.test(read('admin/index.html')) && /backend-config\.js/.test(read('admin/index.html')));
  check('BE16. Админ вагон ачилтыг тусад нь (flights-ээс хамааралгүй) уншина',
    /function loadRailWagon\(\)/.test(adm) && /Promise\.all\(\[loadFeed\(\),loadRailWagon\(\),loadRailPax\(\)\]\)/.test(adm));
  check('BE16. metricValue rail.wagon_* -г RAIL-ээс өгнө (FEED-ээс БИШ)',
    /mk\.indexOf\('rail\.wagon'\)===0/.test(adm) && /RAIL\.state!=='ready'/.test(adm));
  check('BE16. u07 preview огноог МЕТРИКЭЭС уншина (хатуу air шалгалт устсан)',
    /function metricDate\(mk\)/.test(adm) &&
    !/mk==='air\.feed_updated_at'&&FEED\.fetchedAt/.test(adm));
  check('BE16. k04 preview нь verified САЛБАР БҮРИЙГ үзүүлнэ (зөвхөн эхнийх БИШ)',
    /var kp=sectorParts\(id\), ons=kp\.filter/.test(adm) &&
    !/kp\.filter\(function\(p\)\{return p\.q==='verified'\}\)\[0\]/.test(adm));
  check('BE16. ls preview-ийн цуваа МӨРИЙН метрикээс (air-ийн муруй бусдад НААГДАХГҮЙ)',
    /var useSer=\(p\.k==='air'\)\?ser5:\(p\.m\?metricAnySeries\(p\.m\):null\);/.test(adm) &&
    /q:q,m:sv\.metric\|\|null/.test(adm));

  /* ── BE17. ЗОХИОМОЛ СПАРКЛАЙН УСТСАН ──
     miniSpark() нь up/down чиглэлээс синус муруй ЗОХИОДОГ байсан. rail
     слот verified болмогц 3 карт дээр "12 сарын чиг хандлага" гэсэн
     шошготой хуурамч муруй гарах байв ("тоо ЗОХИОХГҮЙ" зөрчил). */
  /* Тайлбар дотор (яагаад устгасан тухай) нэр нь дурдагдаж болно —
     ДУУДАЛТ үлдээгүй эсэхийг шалгана. */
  check('BE17. miniSpark() кодоос БҮРЭН устсан (дуудалт үлдээгүй)',
    !/function miniSpark\(/.test(dcScript()) && !/[=?:(]\s*miniSpark\(/.test(dcScript()));
  check('BE17. Бодит цуваагүй карт ХАВТГАЙ шугамтай',
    /const hasSeries=!!\(vs&&vs\.spark\)\|\|!!ownSeries;/.test(dcScript()) &&
    /const spark=\(vs&&vs\.spark\)\?vs\.spark:\(ownSeries\?pathFor\(ownSeries,120,32,3\)\.line:flatSpark\);/.test(dcScript()));
  check('BE17. Цуваагүй үед хөл бичиг "чиг хандлагын цуваа алга" гэж ил хэлнэ',
    /stxt\('status\.no_series'/.test(dcScript()) && !!con14.site.status.no_series);
  check('BE17. Засварлагдах текст DOM-оос ХАСАГДАХГҮЙ, зөвхөн нуугдана',
    /data-eh-card="k04" data-eh-field="foot" style="\{\{ k\.footBaseStyle \}\}"/.test(read('index.html')) &&
    /data-eh-card="ls" data-eh-field="foot" style="\{\{ ls\.footBaseStyle \}\}"/.test(read('index.html')));
  check('BE17. ls-ийн хөл бичиг НҮД БҮРД өөр (ганц lsFoot давтагдахаа больсон)',
    /\{\{ ls\.footNote \}\}/.test(read('index.html')));
  check('BE17. Урт харьцуулалтын тайлбар картаас халихгүй (ellipsis)',
    /title="\{\{ k\.compareLabel \}\}">\{\{ k\.compareLabel \}\}/.test(read('index.html')));

  /* ── BE18. by_station → ДАТАСЭТИЙН хүснэгт ба салбарын бүтэц ──
     Регресс: endpoint станц тус бүрийн ачилтыг өгдөг атал тэр мөрүүд
     ХАЯГДАЖ, датасэтийн дэлгэрэнгүй хуудас DS_SCHEMA.rail-ын ЗОХИОМОЛ
     галт тэрэгний хуваарийг өөрийн дата мэт харуулж байв.
     Гараар бодохоор 4 станцын фикстур: 100 / 60 / 40 / 0, нийт 200. */
  const BS = [{ station: 'Ерөө', code: '32', loaded: 100, unloaded: 10 },
              { station: 'Багануур', code: '18', loaded: 60, unloaded: 0 },
              { station: 'Улаанбаатар', code: '84', loaded: 40, unloaded: 300 },
              { station: 'Сүхбаатар', code: '9', loaded: 0, unloaded: 25 }];
  const B = runApply({ count: 200, unloadedCount: 335, stationCount: 4, date: '2026-09-17', byStation: BS });
  const bw = B.DSS.rail_wagon;
  check('BE18. 4 станц → 4 мөр', bw.rows.length === 4, JSON.stringify(bw.rows));
  check('BE18. Мөр = [станц, код, ачсан, буулгасан, төлөв]',
    JSON.stringify(bw.rows[0]) === JSON.stringify(['Ерөө', '32', 100, 10, 'ok:Ачилттай']), JSON.stringify(bw.rows[0]));
  check('BE18. Ачилтгүй станц warn: шошготой (0-г ЗОХИОЖ ok болгохгүй)',
    bw.rows[3][4] === 'warn:Зөвхөн буулгалт' && bw.rows[3][2] === 0, JSON.stringify(bw.rows[3]));
  check('BE18. Баганын нэр content.json-оос (stxt) — 5 багана',
    bw.head.length === 5 && bw.head[0] === 'Станц' && bw.head[2] === 'Ачсан (вагон)', JSON.stringify(bw.head));
  check('BE18. Зохиомол галт тэрэгний мөр ОРОХГҮЙ',
    !JSON.stringify(bw.rows).includes('271') && !JSON.stringify(bw.rows).includes('Замын-Үүд'));
  check('BE18. rank ачилтаар эрэмбэлэгдэж, хувь нь ГАРААР БОДОХТОЙ таарна',
    JSON.stringify(B.SEC.rail.rank) === JSON.stringify([['Ерөө', '100', '50.0%'], ['Багануур', '60', '30.0%'],
      ['Улаанбаатар', '40', '20.0%'], ['Сүхбаатар', '0', '0.0%']]), JSON.stringify(B.SEC.rail.rank));
  check('BE18. Зохиомол бүтцийн хувь (37.2%) БҮРЭН солигдоно',
    !JSON.stringify(B.SEC.rail.rank).includes('37.2%') && B.SEC.rail.rt === 'Станц тус бүрийн ачилт');
  check('BE18. bars — хамгийн их ачилт 100%, бусад нь түүнд харьцуулсан хувь',
    JSON.stringify(B.SEC.rail.bars) === JSON.stringify([['Ерөө', 100, '100 вагон'], ['Багануур', 60, '60 вагон'],
      ['Улаанбаатар', 40, '40 вагон'], ['Сүхбаатар', 0, '0 вагон']]), JSON.stringify(B.SEC.rail.bars));
  check('BE18. Зохиомол багана (12.4M тн) БҮРЭН солигдоно',
    !JSON.stringify(B.SEC.rail.bars).includes('12.4M') && B.SEC.rail.c2 === 'Ачилт ихтэй станц');
  const B0 = runApply({ count: 200, unloadedCount: null, stationCount: null, date: '2026-09-17', byStation: [] });
  check('BE18. by_station ХООСОН → хүснэгт ч, бүтэц ч ОГТ хөндөгдөхгүй',
    B0.DSS.rail_wagon.rows.length === 0 && B0.SEC.rail.rt === 'Чиглэл тус бүрийн ачаа');
  check('BE18. wagonLoadingToValue by_station-ыг ХАДГАЛНА',
    JSON.stringify((toW({ status: 'ok', count: 5, by_station: BS }) || {}).byStation) === JSON.stringify(BS));
  check('BE18. by_station ирээгүй бол хоосон массив (undefined БИШ)',
    JSON.stringify((toW({ status: 'ok', count: 5 }) || {}).byStation) === '[]');

  /* ── BE19. station_count: 0 нь мөрийг БҮРМӨСӨН алга болгодог байв ── */
  check('BE19. station_count 0 → 0 (Number()||null нь null болгож мөрийг залгидаг байв)',
    (toW({ status: 'ok', count: 5, station_count: 0 }) || {}).stationCount === 0);
  check('BE19. station_count ирээгүй → null (0 гэж ЗОХИОХГҮЙ)',
    (toW({ status: 'ok', count: 5 }) || {}).stationCount === null);
  const C0 = runApply({ count: 900, unloadedCount: 0, stationCount: 0, date: '2026-09-17' });
  check('BE19. Бодит 0 бол мөр ГАРНА (мөр чимээгүй алга болохгүй)',
    C0.SEC.rail.kpis.length === 3 && C0.SEC.rail.kpis[1][1] === '0' && C0.SEC.rail.kpis[2][1] === '0',
    JSON.stringify(C0.SEC.rail.kpis));

  /* ── BE20. НИЙТЛЭЛИЙН ЗАМ — content.json/overlay ирэхэд амьд мөр ДАХИН барина ──
     Регресс: applyRailWagonData() мөрийн НЭРийг stxt()-ээр тухайн агшинд
     шингээдэг тул текст нь хожуу ирвэл (нийтлэл нь ҮРГЭЛЖ хамгийн сүүлд
     ирдэг) админаас засварласан шошго сайтад ХЭЗЭЭ Ч гарахгүй байв. */
  const dc20 = dcScript().split(CR_LF).join(NLc);
  check('BE20. applyContentLayers: applySiteContent → reapplyLiveText → setState',
    dc20.includes(['    applySiteContent();', '    this.reapplyLiveText();', '    this.setState({content:json});'].join(NLc)));
  check('BE20. loadContent ба loadPublished ХОЁУЛАА applyContentLayers-аар (нийтэлсэн шошго амьд мөрөнд хүрнэ)',
    dc20.includes('this._fileContent=json;' + NLc + '      this.applyContentLayers();') &&
    dc20.includes('this._pubContent=pub.content;' + NLc + '      this.applyContentLayers();'));
  check('BE20. reapplyLiveText нь rail ба air ХОЁУЛАНГ нь дахин барина',
    /reapplyLiveText\(\)\{[\s\S]*?this\.applyRailWagonData\(\);[\s\S]*?this\.recomputeAirData\(\);[\s\S]*?\}/.test(dcScript()));
  /* Дарааллыг УРВУУЛЖ давтана: backend түрүүлж ирээд ДАРАА нь content.json */
  const RAILTXT2 = Object.assign({}, RAILTXT, { 'sector_kpi_rail_live.0': 'АЧСАН ВАГОН',
    'status.rail_wagon_stale': 'хоног шинэ мэдээ ирээгүй' });
  const lateApply = (ageNow = 1) => {
    const SEC = { rail: { label: 'Төмөр зам', kpis: [['НИЙТ ЗАМ', '1,815', 'км', '+0.4%', 'up']] } };
    const DSS = { rail_wagon: { head: [], types: [], notes: [], rows: [] } };
    const ctx = { _railWagonLoading: { count: 1182, unloadedCount: 1027, stationCount: 35, date: '2026-09-17' },
      _meta: null, _st: null, setSourceMeta() {}, setState() {} };
    const fmt = (n) => Number(n).toLocaleString('en-US');
    mkApply(SEC, DSS, (p, f) => (RAILTXT[p] !== undefined ? RAILTXT[p] : f), fmt, () => ageNow, 2).call(ctx);
    mkApply(SEC, DSS, (p, f) => (RAILTXT2[p] !== undefined ? RAILTXT2[p] : f), fmt, () => ageNow, 2).call(ctx);
    return SEC;
  };
  check('BE20. Backend ТҮРҮҮЛЖ ирсэн ч шинэ шошго мөрөнд ТУСНА',
    lateApply().rail.kpis[0][0] === 'АЧСАН ВАГОН', JSON.stringify(lateApply().rail.kpis[0]));
  /* Хоцролтын тайлбар ч ижил гэрээнд орно — админаас засаад нийтэлсэн
     status.rail_wagon_stale хожуу ирсэн ч сайтын мөрөнд ТУСАХ ёстой. */
  check('BE20. Хожуу ирсэн хоцролтын текст ч мөрөнд ТУСНА',
    lateApply(4).rail.kpis[0][5] === '2026-09-17 · 4 хоног шинэ мэдээ ирээгүй',
    JSON.stringify(lateApply(4).rail.kpis[0][5]));

  /* ── BE21. Нийтлэгдсэн registry нь файлынхыг ДАВХАРЛАНА (бүтнээр солихгүй) ──
     Регресс: overlay үргэлж сүүлд ирдэг тул бүтнээр дарвал нийтэлсний
     дараах git засвар (quality: verified) амьд сайтад хүрэхгүй болно. */
  check('BE21. loadPublished registry-г СОЛИХГҮЙ, давхарлана (EHPublish.layer, дарааллаас үл хамаарна)',
    !dcScript().includes('this.setState({metricRegistry:pub.registry})') &&
    !dcScript().includes('this.setState({metricRegistry:json})') &&
    dcScript().includes('this._pubRegistry=pub.registry;') &&
    dcScript().includes('this._fileRegistry=json;') &&
    dcScript().includes('const reg=this.layerOf(this._fileRegistry,this._pubRegistry);'));

  /* ── BE22. Схем нь ДАТАСЭТЭЭР сонгогдоно (салбараар БИШ) ── */
  check('BE22. buildPreview схемийг dsel.schema-аар сонгоно',
    /const schemaKey=dsel\.schema\|\|dsel\.sector;/.test(dcScript()) &&
    /const sc=DS_SCHEMA\[schemaKey\];/.test(dcScript()) &&
    !/const sc=DS_SCHEMA\[dsel\.sector\];/.test(dcScript()));
  check('BE22. Багана өргөн/эрэмбийн кэш ч ижил түлхүүрээр (датасэт хооронд холилдохгүй)',
    /const cacheKey=schemaKey\+/.test(dcScript()) &&
    /this\.state\.pvColWidths\[schemaKey\]/.test(dcScript()));
  check('BE22. Вагон ачилтын датасэт rail_wagon схем зарлана',
    /schema:'rail_wagon',source:'railWagon'/.test(dcScript()));
  check('BE22. DS_SCHEMA.rail_wagon анхнаасаа ХООСОН мөртэй (зохиомол дата алга)',
    /rail_wagon:\{head:\[[\s\S]*?rows:\[\]\}/.test(dcScript()));
  check('BE22. Салбарын схем ХЭВЭЭР (schema зарлаагүй датасэт эвдрэхгүй)',
    /rail:\{head:\['Огноо','Галт тэрэг'/.test(dcScript()));
  check('BE22. Каталогийн давтамж "Тодорхойгүй" биш бодит хуваарь',
    !/freq:'Тодорхойгүй',use:'Нийтийн API нээлттэй'/.test(dcScript()));

  /* ── BE23. Шинэ харагдах текст content.json-д бүртгэгдсэн ── */
  const cw = con14.site.ds_schema_rail_wagon || {};
  check('BE23. ds_schema_rail_wagon.head 5 баганатай', (cw.head || []).length === 5, JSON.stringify(cw.head));
  check('BE23. ds_schema_rail_wagon.notes 5 тайлбартай', (cw.notes || []).length === 5);
  check('BE23. Төлөвийн 2 шошго бүртгэлтэй', !!cw.st_loaded && !!cw.st_none);
  check('BE23. Салбарын бүтэц/баганын амьд гарчиг бүртгэлтэй',
    !!con14.site.sector_rank_rail_live && !!con14.site.sector_rank_rail_other && !!con14.site.sector_chart2_rail_live);

  /* ══ BE24–BE29. Төмөр замын ЗОРЧИГЧИЙН сарын цуваа (2026-09-22) ══
     Эх сурвалж: etransport-backend /api/sectors/rail/summary ← gold ←
     silver.rail_operations ← Veritech rail.veritech.passengers (TOTAL).
     Фикстур нь сервер дээрх БОДИТ хариу (2026-09-22) — 1–9-р сар, нийлбэр
     1,161,261. Хүлээгдэж буй бүх утгыг ГАРААР бодож бичсэн. */
  const PAX = { sector: 'rail', status: 'ok', unit: 'зорчигч', measure: 'Зорчигчийн тоо', data: [
    ['2026-09', 71261], ['2026-08', 148470], ['2026-07', 158701], ['2026-06', 160319], ['2026-05', 134068],
    ['2026-04', 134414], ['2026-03', 115010], ['2026-02', 95798], ['2026-01', 143220],
  ].map(([m, v]) => ({ sector: 'rail', month: m + '-01T00:00:00.000Z', total_volume: String(v) })) };
  const JAN_AUG = [143220, 95798, 115010, 134414, 134068, 160319, 158701, 148470];
  const NOW_0922 = Date.UTC(2026, 8, 22, 4, 0, 0);            // УБ 12:00, 9-р сар явагдаж байна
  const NOW_1005 = Date.UTC(2026, 9, 5, 4, 0, 0);             // 10-р сар — 9-р сар БҮТЭН
  const NOW_0930_UB_OCT = Date.UTC(2026, 8, 30, 20, 0, 0);    // UTC 09-30 20:00 = УБ 10-01 04:00

  /* ── BE24. sectorSummaryToSeries() — цэвэр задлагч ── */
  const s24 = dcScript().match(/function sectorSummaryToSeries\(json,now\)\{([\s\S]*?)\n\}/);
  if (!s24) { bad('BE24. sectorSummaryToSeries() олдсонгүй'); return; }
  const toSeries = new Function('json', 'now', s24[1]);
  const a24 = toSeries(PAX, NOW_0922);
  check('BE24. Явагдаж буй 9-р сар ХАСАГДАЖ 1–8-р сар үлдэнэ',
    !!a24 && a24.lastMonth === 8 && JSON.stringify(a24.counts) === JSON.stringify(JAN_AUG), JSON.stringify(a24));
  check('BE24. Он ба нэгж дамжина (2026, "зорчигч")', !!a24 && a24.year === 2026 && a24.unit === 'зорчигч');
  check('BE24. 1–8-р сарын нийлбэр = 1,161,261 − 71,261 = 1,090,000 (гараар)',
    !!a24 && a24.counts.reduce((x, y) => x + y, 0) === 1161261 - 71261, String(a24 && a24.counts.reduce((x, y) => x + y, 0)));
  const b24 = toSeries(PAX, NOW_1005);
  check('BE24. 10-р сард 9-р сар БҮТЭН болж цуваанд орно (9 цэг)',
    !!b24 && b24.lastMonth === 9 && b24.counts[8] === 71261);
  const c24 = toSeries(PAX, NOW_0930_UB_OCT);
  check('BE24. УБ цагаар (UTC+8) сар солигдоно — UTC 09-30 20:00 нь УБ-д аль хэдийн 10-р сар',
    !!c24 && c24.lastMonth === 9);
  check('BE24. unit ирээгүй бол null — нэгжгүй тоо ХАРУУЛАХГҮЙ (PO шийдвэр)',
    toSeries({ ...PAX, unit: undefined }, NOW_0922) === null && toSeries({ ...PAX, unit: '  ' }, NOW_0922) === null);
  check('BE24. status:"no_data" → null', toSeries({ ...PAX, status: 'no_data' }, NOW_0922) === null);
  check('BE24. Хариугүй → null', toSeries(null, NOW_0922) === null && toSeries(undefined, NOW_0922) === null);
  const gap = { ...PAX, data: PAX.data.filter((r) => !r.month.startsWith('2026-03')) };
  check('BE24. Дунд нь завсар (3-р сар алга) → null — 0-ээр нөхөж хуурамч уналт ЗУРАХГҮЙ',
    toSeries(gap, NOW_0922) === null);
  const noJan = { ...PAX, data: PAX.data.filter((r) => !r.month.startsWith('2026-01')) };
  check('BE24. 1-р сар алга → null (c1d-ийн индекс 0 нь 1-р сар байх ёстой)', toSeries(noJan, NOW_0922) === null);
  const badVal = { ...PAX, data: PAX.data.map((r) => r.month.startsWith('2026-05') ? { ...r, total_volume: 'N/A' } : r) };
  check('BE24. Тоон бус сар → завсар гэж үзэж null', toSeries(badVal, NOW_0922) === null);
  const neg = { ...PAX, data: PAX.data.map((r) => r.month.startsWith('2026-05') ? { ...r, total_volume: '-5' } : r) };
  check('BE24. Сөрөг сар → завсар гэж үзэж null', toSeries(neg, NOW_0922) === null);
  const one = { ...PAX, data: PAX.data.filter((r) => r.month.startsWith('2026-01')) };
  check('BE24. Ганц сар (1-р сар) → 1 цэгтэй цуваа (apply нь 2-оос цөөн бол зурахгүй)',
    (toSeries(one, NOW_0922) || {}).lastMonth === 1);

  /* ── BE25. Админы задлагч сайтынхтай ИЖИЛ тоо өгнө (preview = сайт) ── */
  const adm25 = adminScript();
  const p25 = adm25.match(/function paxSeriesFromSummary\(json,now\)\{([\s\S]*?)\n\}/);
  if (!p25) { bad('BE25. admin paxSeriesFromSummary() олдсонгүй'); return; }
  const MONTHS25 = readJson('content.json').site.months;
  const admSeries = new Function('MONTHS', 'json', 'now', p25[1]).bind(null, MONTHS25);
  const ad = admSeries(PAX, NOW_0922);
  check('BE25. Админ: 1–8-р сар, ижил тоо', !!ad && JSON.stringify(ad.series.map((x) => x.v)) === JSON.stringify(JAN_AUG),
    JSON.stringify(ad && ad.series));
  check('BE25. Админ: шошго нь сарын нэр ("1-р сар" … "8-р сар")',
    !!ad && ad.series[0].label === MONTHS25[0] && ad.series[7].label === MONTHS25[7]);
  check('BE25. Админ ба сайт — ижил завсар/нэгжийн дүрэм',
    admSeries(gap, NOW_0922) === null && admSeries({ ...PAX, unit: '' }, NOW_0922) === null &&
    (admSeries(PAX, NOW_1005) || { series: [] }).series.length === 9);
  check('BE25. Админ metricSeries rail-ийг RAILPAX-аас (flights FEED-ээс ХАМААРАХГҮЙ)',
    /if\(mk==='rail\.monthly_passenger_series'\) return RAILPAX\.state==='ready'\?RAILPAX\.series:null;\s*\n\s*if\(FEED\.state!=='ready'\) return null;/.test(adm25));
  check('BE25. Админ гурван эх сурвалжийг зэрэг ачаална',
    /Promise\.all\(\[loadFeed\(\),loadRailWagon\(\),loadRailPax\(\)\]\)/.test(adm25));
  check('BE25. Line preview бусад verified слотын цувааг ч харуулна (rail холбоос тусна)',
    /data-pvextra="1"/.test(adm25) && /sv\.metric===mk\) return null;/.test(adm25));

  /* ── BE26. applyRailPassengerData() ба зорчигчийн KPI мөр ── */
  const ap26 = dcScript().match(/\n  applyRailPassengerData\(\)\{([\s\S]*?)\n  \}\n/);
  const kr26 = dcScript().match(/\n  railPaxKpiRow\(\)\{([\s\S]*?)\n  \}\n/);
  if (!ap26 || !kr26) { bad('BE26. applyRailPassengerData()/railPaxKpiRow() олдсонгүй'); return; }
  const PAXTXT = { 'sector_chart_rail_live': 'Сарын зорчигч', 'sector_kpi_rail_live.3': 'ЗОРЧИГЧ / САР',
    'unit.passenger': 'зорчигч', 'chart.compare_mom_mid': '· өмнөх сартай (', 'chart.compare_mom_end': ') харьцуулбал',
    'status.no_compare': 'харьцуулах өгөгдөл алга' };
  const st26 = (p, f) => (PAXTXT[p] !== undefined ? PAXTXT[p] : f);
  const fmt26 = (n) => Number(n).toLocaleString('en-US');
  const mkPax = new Function('SECTORS', 'stxt', 'return function(){' + ap26[1] + '}');
  const mkRow = new Function('stxt', 'fmtNum', 'MONTHS', 'return function(){' + kr26[1] + '}');
  const runPax = (series) => {
    const SEC = { rail: { c1: 'Сарын зорчигч (мянга)', c1d: [290, 270, 310], _liveKpis: true } };
    const ctx = { _railPaxSeries: series, _st: null, setState(s) { this._st = s; } };
    mkPax(SEC, st26).call(ctx);
    return { SEC, ctx };
  };
  const P26 = runPax({ unit: 'зорчигч', year: 2026, counts: JAN_AUG.slice(), lastMonth: 8 });
  check('BE26. c1d = бодит 1–8-р сар (демо [290,270,310] бүрэн солигдоно)',
    JSON.stringify(P26.SEC.rail.c1d) === JSON.stringify(JAN_AUG));
  check('BE26. Шошго "Сарын зорчигч" — "(мянга)" БИШ (бодит тоо мянгачлагдаагүй)',
    P26.SEC.rail.c1 === 'Сарын зорчигч' && !/мянга/.test(P26.SEC.rail.c1));
  check('BE26. _liveSeries үнэн, он тэмдэглэгдэнэ', P26.SEC.rail._liveSeries === true && P26.SEC.rail.c1dYear === 2026);
  check('BE26. Цуваа ЗӨВХӨН зорчигчийн датасэтийнх (вагоны хуудсан дээр гарахгүй)',
    P26.SEC.rail._liveSeriesDs === 'Зорчигчийн галт тэрэгний мэдээ');
  const N26 = runPax(null);
  check('BE26. Дата ирээгүй → c1d/шошго ОГТ хөндөгдөхгүй, _liveSeries үгүй',
    JSON.stringify(N26.SEC.rail.c1d) === '[290,270,310]' && N26.SEC.rail.c1 === 'Сарын зорчигч (мянга)' && !N26.SEC.rail._liveSeries);
  check('BE26. 1 цэгтэй цуваа → зурахгүй (шугам биш)',
    !runPax({ unit: 'зорчигч', year: 2026, counts: [143220], lastMonth: 1 }).SEC.rail._liveSeries);
  const paxRow = mkRow(st26, fmt26, MONTHS25).call({ _railPaxSeries: { counts: JAN_AUG.slice() } });
  check('BE26. KPI: ЗОРЧИГЧ / САР · 148,470 · зорчигч', !!paxRow && paxRow[0] === 'ЗОРЧИГЧ / САР' && paxRow[1] === '148,470' && paxRow[2] === 'зорчигч',
    JSON.stringify(paxRow));
  /* (148,470 − 158,701) / 158,701 × 100 = −6.4467% */
  check('BE26. KPI: 8-р сар vs 7-р сар = -6.4% (down) — гараар бодсон', !!paxRow && paxRow[3] === '-6.4%' && paxRow[4] === 'down', JSON.stringify(paxRow));
  check('BE26. KPI: харьцуулалтын шошго сар хоёуланг нэрлэнэ (MoM гэдгийг ил)',
    !!paxRow && paxRow[5].includes(MONTHS25[7]) && paxRow[5].includes(MONTHS25[6]) && /өмнөх сартай/.test(paxRow[5]), paxRow && paxRow[5]);
  check('BE26. KPI: k[6] = бодит цуваа (spark зохиомол биш)', !!paxRow && JSON.stringify(paxRow[6]) === JSON.stringify(JAN_AUG));
  const paxRow1 = mkRow(st26, fmt26, MONTHS25).call({ _railPaxSeries: { counts: [143220] } });
  check('BE26. Ганц сар → өөрчлөлт "—" + "харьцуулах өгөгдөл алга" (0% гэж ЗОХИОХГҮЙ)',
    !!paxRow1 && paxRow1[3] === '—' && paxRow1[4] === 'flat' && paxRow1[5] === 'харьцуулах өгөгдөл алга');
  check('BE26. Дата алга → мөр үүсэхгүй', mkRow(st26, fmt26, MONTHS25).call({ _railPaxSeries: null }) === null);

  /* Вагоны мөрүүдийн АРД залгагдана — BE12-ын ижил фикстурт railPaxKpiRow нэмнэ */
  const withPax = (paxRow) => {
    const SEC = { rail: { label: 'Төмөр зам', kpis: [['НИЙТ ЗАМ', '1,815', 'км', '+0.4%', 'up']] } };
    const DSS = { rail_wagon: { head: [], types: [], notes: [], rows: [] } };
    const ctx = { _railWagonLoading: { count: 1182, unloadedCount: 1027, stationCount: 35, date: '2026-09-17' },
      setSourceMeta() {}, setState() {}, railPaxKpiRow: () => paxRow };
    /* dataAgeDays/WAGON_STALE_DAYS — вагоны хоцролтын тайлбар (PR #3). 1 хоног = хоцроогүй. */
    mkApply(SEC, DSS, (p, f) => (RAILTXT[p] !== undefined ? RAILTXT[p] : f), fmt26, () => 1, 2).call(ctx);
    return SEC.rail.kpis;
  };
  const k4 = withPax(paxRow);
  check('BE26. k04.rail = 4 мөр: вагон 3 + зорчигч 1 (kpis[3])', k4.length === 4 && k4[3][0] === 'ЗОРЧИГЧ / САР', JSON.stringify(k4.map((r) => r[0])));
  check('BE26. kpis[0] ХЭВЭЭР хоногийн ачилт (ls.rail = вагон, зорчигч БИШ)', k4[0][0] === 'ХОНОГИЙН АЧИЛТ' && k4[0][2] === 'вагон');
  check('BE26. Зорчигчийн дата алга → 3 мөр хэвээр', withPax(null).length === 3);

  /* ── BE27. Дараалал ба давхар баталгаа ── */
  check('BE27. reapplyLiveText: зорчигч ЭХЛЭЭД, дараа нь вагон (мөр дахин баригдахад зорчигч алдагдахгүй)',
    /reapplyLiveText\(\)\{[\s\S]*?this\.applyRailPassengerData\(\);[\s\S]*?this\.applyRailWagonData\(\);[\s\S]*?this\.recomputeAirData\(\);/.test(dcScript()));
  check('BE27. loadEtransportBackend хоёр endpoint-ийг ЗЭРЭГ, зорчигчийг вагоноос ӨМНӨ барина',
    /Promise\.all\(\[EHBackend\.fetchRailWagonLoading\(\),[\s\S]*?fetchSectorSummary\('rail'\)/.test(dcScript()) &&
    /this\._railPaxSeries=sectorSummaryToSeries\(sum\);\s*this\.applyRailPassengerData\(\);[\s\S]*?this\.applyRailWagonData\(\);/.test(dcScript()));
  const sv27 = dcScript().match(/\n  seriesVerified\(widgetId,sectorKey\)\{([\s\S]*?)\n  \}\n/);
  if (!sv27) { bad('BE27. seriesVerified() олдсонгүй'); return; }
  const svFn = new Function('SECTORS', 'widgetId', 'sectorKey', sv27[1]);
  const svCall = (reg, live) => svFn.call({ sectorVerified: () => reg }, { rail: { _liveSeries: live } }, 't05', 'rail');
  check('BE27. registry verified + цуваа ирсэн → true', svCall(true, true) === true);
  check('BE27. registry verified ч цуваа ИРЭЭГҮЙ → false (демо муруйг амьд гэж зурахгүй)', svCall(true, undefined) === false);
  check('BE27. цуваа байгаа ч registry verified биш → false', svCall(false, true) === false);
  check('BE27. t05 seriesVerified ашиглана (зөвхөн registry БИШ)',
    /const t05Verified=this\.seriesVerified\('t05',key\);/.test(dcScript()) && !/const t05Verified=this\.sectorVerified\('t05',key\);/.test(dcScript()));
  check('BE27. Датасэтийн хуудас цувааг ЗӨВХӨН өөрийн датасэт дээр зурна',
    /dsSec\._liveSeriesDs===dsel\.name/.test(dcScript()));

  /* ── BE28. i06/r06 — verified салбарт СТАТИК TREND зурахгүй ── */
  check('BE28. trendFor статик TREND[k]-ыг ХЭЗЭЭ Ч буцаахгүй', !/return TREND\[k\]\.slice\(0,months\);/.test(dcScript()));
  check('BE28. Rail шугам бодит c1d-ээс, compareWindow-ын ИЖИЛ онтой үед л',
    /if\(cw\.year&&ss\.c1dYear!==cw\.year\) return null;/.test(dcScript()) &&
    /return ss\.c1d\.length>=months\?ss\.c1d:null;/.test(dcScript()));
  check('BE28. "мэдээлэл алга" шошго цуваа ирсэн эсэхээр (registry-ээр л БИШ)',
    /mockTag:liveI06\(r\.key\)\?'':/.test(dcScript()));
  /* Регресс (2026-09-22, browser-оор илэрсэн): rail-ийг i06/r06-д бүртгэмэгц
     backend хариу ирэхээс ӨМНӨХ агшинд rail-ийн шугам 0, ch=null болж
     хоцрогдогч (cLag) болон сонгогдоод null.toFixed() БҮХ хуудсыг унагав. */
  check('BE28. Тэргүүлэгч/хоцрогдогч — дата ИРСЭН, ch тодорхой салбараас л',
    /const verifiedRank=cRank\.filter\(r=>liveI06\(r\.key\)&&r\.ch!=null\);/.test(dcScript()) &&
    !/const verifiedRank=cRank\.filter\(r=>verifiedSet\.has\(r\.key\)\);/.test(dcScript()));
  check('BE28. ch.toFixed бүр null-аас хамгаалагдсан (хуудас унахгүй)',
    (dcScript().match(/\.ch\.toFixed\(1\)/g) || []).length ===
    (dcScript().match(/\.ch==null\?'—':\(\([a-zA-Z]+\.ch>0\?'\+':''\)\+[a-zA-Z]+\.ch\.toFixed\(1\)/g) || []).length);
  /* Индексийг гараар: 8-р сар / 1-р сар × 100 = 148,470 / 143,220 × 100 = 103.67 */
  check('BE28. Rail индекс 8-р сард 103.7 (гараар бодсон)', Math.abs(JAN_AUG[7] / JAN_AUG[0] * 100 - 103.6657) < 0.001);

  /* ── BE29. Registry / админ / content — ГЭРЭЭ ── */
  const reg29 = readJson('metric_registry.json');
  const m29 = reg29.metrics['rail.monthly_passenger_series'] || {};
  check('BE29. rail.monthly_passenger_series verified, unit "зорчигч/сар"', m29.quality === 'verified' && m29.unit === 'зорчигч/сар');
  check('BE29. Баталгаажуулалтын нотолгоо ба хязгаарлалт registry-д ил',
    /100%/.test(m29.period_note || '') && /1,161,261/.test(m29.period_note || '') && /ХАРААХАН тулгаагүй/.test(m29.period_note || ''));
  const t29 = reg29.widgets.t05 || {};
  check('BE29. t05 салбарын слоттой: air ба rail verified',
    !!t29.sectors && !Array.isArray(t29.sectors) &&
    t29.sectors.air.metric === 'air.monthly_flight_series' && t29.sectors.rail.metric === 'rail.monthly_passenger_series' &&
    t29.sectors.rail.quality === 'verified');
  check('BE29. t05-ийн холбогдоогүй 3 слот шалтгаантай', ['road', 'water', 'public'].every((k) =>
    t29.sectors[k] && t29.sectors[k].metric === null && t29.sectors[k].would_need));
  check('BE29. i06/r06 МАССИВ хэвээр (сайт new Set(sectors) хийдэг) ба rail орсон',
    ['i06', 'r06'].every((id) => Array.isArray(reg29.widgets[id].sectors) && reg29.widgets[id].sectors.includes('rail')));
  const fu29 = (adm25.match(/var FIXED_UNIT=\{([\s\S]*?)\n\};/) || [])[1] || '';
  const fx29 = {}; for (const fm of fu29.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) fx29[fm[1]] = fm[2];
  check('BE29. FIXED_UNIT t05.rail = метрикийн нэгж (why() блоклохгүй)', fx29['t05.rail'] === m29.unit, fx29['t05.rail']);
  check('BE29. FIXED_UNIT t05.air = агаарын цувааны нэгж', fx29['t05.air'] === reg29.metrics['air.monthly_flight_series'].unit);
  check('BE29. Админ каталогт silver.rail_operations нэртэй (түүхий код гарахгүй)',
    /'silver\.rail_operations':\{n:/.test(adm25) && !!(readJson('content.json').ui.dataset.silver_rail_operations || {}).name);
  const c29 = readJson('content.json').site;
  check('BE29. Шинэ харагдах текст content.json-д',
    c29.sector_chart_rail_live === 'Сарын зорчигч' && (c29.sector_kpi_rail_live || [])[3] === 'ЗОРЧИГЧ / САР' &&
    c29.unit.passenger === 'зорчигч' && !!c29.chart.compare_mom_mid && !!c29.chart.compare_mom_end && !!c29.status.no_compare);
  check('BE29. Админы required_unit-д шинэ нэгжүүд', ['зорчигч/сар', 'тээврийн хэрэгсэл/сар', 'хөлөг онгоц/сар']
    .every((u) => readJson('content.json').ui.required_unit[u] === u));
}

/* ══════════════════════════════════════════════════════════════════
   AI. 08 — AI ТУСЛАХЫН БЭЛЭН ХАРИУЛТ АМЬД ДАТААС

   Регресс: content.json → site.ai.qa-д "Энэ онд нийт 11,979 нислэг
   бүртгэгдсэн — өмнөх оноос +8.4%" гэж ХАТУУ бичигдсэн байв. Ижил нүүр
   хуудсан дээр hero/k04 нь flights feed-ийн АМЬД тоог (2026-09 байдлаар
   2,450) харуулж, нэг хуудас хоёр өөр нийт дүн хэлж байв. Бусад 3
   хариулт ч зохиомол (авто зам 214.3K, Солонгос 457,815, нийтийн
   тээвэр 139/959) — эх сурвалж нь холбогдоогүй салбарууд.
     AI1. aiResolve — гараар бодох фикстур (тоо/сар/хувь/нэгж ХАМТ)
     AI2. Регресс — AI ба hero_fl ЯГ ИЖИЛ тоо хэлнэ
     AI3. YoY хувь — k04-тэй ижил цонх (сүүлийн бүтэн сар ↔ өмнөх оны мөн сар)
     AI4. Кодын холбоос (askAi / анхны бөмбөлөг / fallback)
     AI5. content.json — хатуу тоо үлдээгүй, шинэ текст бүртгэгдсэн
     AI6. Админ — AI асуулт-хариулт ойлгомжтой шошготой бүлэгт
     AI7. Сайтын DOM — амьд тоо hero-тэй таарна, эх сурвалжгүй хариулт тоогүй
   ══════════════════════════════════════════════════════════════════ */
function aiKit() {
  const src = dcScript();
  const cut = (sig) => {
    const m = src.match(new RegExp('\\n  ' + sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([\\s\\S]*?)\\n  \\}\\n'));
    return m ? m[1] : null;
  };
  return { resolve: cut('aiResolve(i)'), values: cut('aiLiveValues(kind)'),
    hero: cut('computeHeroFlightsLastMonth()'), win: cut('lastFullMonthWindow(year)'),
    val: cut('val(widgetId,fallback)') };
}
/* Фикстурын ТЕКСТ — content.json-оос (сайт ч эндээс уншдаг). Ингэснээр
   тест нь бүртгэсэн темплейтийг ЯГ шалгана. */
function aiEnv(ctxPatch) {
  const k = aiKit();
  const con = readJson('content.json');
  const S = con.site;
  const stxt = (p, f) => { let c = S; for (const x of p.split('.')) { if (c == null) return f; c = c[x]; } return (c == null || c === '') ? f : c; };
  const AI_QA = S.ai.qa.map((x, i) => Object.assign({ ans: ['flights_last_month', null, 'top_countries_pax', null][i] }, x));
  const SECTORS = { road: { label: 'Авто зам' }, rail: { label: 'Төмөр зам' }, air: { label: 'Агаарын тээвэр' },
    water: { label: 'Ус, далайн тээвэр' }, public: { label: 'Нийтийн тээвэр' } };
  const values = new Function('kind', 'stxt', 'SECTORS', k.values);
  const resolve = new Function('i', 'AI_QA', 'AI_SOURCES', 'SECTORS', 'stxt', k.resolve);
  const ctx = Object.assign({ kpiVerified: () => false }, ctxPatch);
  ctx.aiLiveValues = function (kind) { return values.call(this, kind, stxt, SECTORS); };
  return { k, con, ask: (i) => resolve.call(ctx, i, AI_QA, S.ai.sources, SECTORS, stxt), ctx, stxt };
}
async function groupAI() {
  group('AI. 08 — AI туслахын хариулт амьд датаас');
  const k = aiKit();
  if (!k.resolve || !k.values) { bad('AI1. aiResolve()/aiLiveValues() олдсонгүй'); }
  else {
    /* ── AI1. Нислэг — 2,450 / өмнөх оны мөн сар 2,000 → +22.5% ── */
    const a1 = aiEnv({ _heroFlLastMonth: { count: 2450, year: 2026, month: 8, monthLabel: '8-р сар', prevCount: 2000 } }).ask(0);
    check('AI1. Амьд тоо (2,450) хариултад орно', a1 && a1.live === true && a1.text.includes('2,450'), JSON.stringify(a1));
    check('AI1. Хугацаа ИЛ — "2026 оны 8-р сар"', a1 && a1.text.includes('2026 оны 8-р сар'), a1 && a1.text);
    check('AI1. Нэгж "нислэг" тоотой хамт', a1 && /2,450 нислэг/.test(a1.text), a1 && a1.text);
    check('AI1. YoY хувь (2450-2000)/2000 = +22.5%', a1 && a1.text.includes('+22.5%'), a1 && a1.text);
    check('AI1. Зохиомол хуучин тоо (11,979 / +8.4%) АЛГА', a1 && !/11,979|8\.4%/.test(a1.text));
    check('AI1. Темплейтийн {…} нүд ил гарахгүй', a1 && !/[{}]/.test(a1.text), a1 && a1.text);
    const aDown = aiEnv({ _heroFlLastMonth: { count: 1800, year: 2026, month: 8, monthLabel: '8-р сар', prevCount: 2000 } }).ask(0);
    check('AI1. Бууралт: 1800 vs 2000 → -10.0%', aDown && aDown.text.includes('-10.0%'), aDown && aDown.text);
    const aNoPrev = aiEnv({ _heroFlLastMonth: { count: 2450, year: 2026, month: 8, monthLabel: '8-р сар', prevCount: null } }).ask(0);
    check('AI1. Өмнөх оны дата алга → хувь ЗОХИОХГҮЙ (% тэмдэг ч алга)',
      aNoPrev && aNoPrev.live && aNoPrev.text.includes('2,450') && !/%/.test(aNoPrev.text), aNoPrev && aNoPrev.text);
    const aNone = aiEnv({ _heroFlLastMonth: null }).ask(0);
    check('AI1. Дата ирээгүй → a_nodata, тоо огт алга',
      aNone && aNone.live === false && !/\d/.test(aNone.text) && /мэдээлэл алга/.test(aNone.text), JSON.stringify(aNone));
    check('AI1. Дата алга үед эх сурвалжийн шошго "мэдээлэл алга" гэж ил хэлнэ',
      aNone && /мэдээлэл алга$/.test(aNone.source), aNone && aNone.source);

    /* ── Улсаар: Хятад 100+70=170, Солонгос 150, Япон 20, Монгол ХАСАГДАНА ── */
    const T = (y, m, d) => Date.UTC(y, m - 1, d) / 1000;
    const fl = [
      { cntry: 'Хятад', pax: 100, year: 2026, month: 3, day: 1, unixtimestamp: T(2026, 3, 1) },
      { cntry: 'Өмнөд Солонгос', pax: 150, year: 2026, month: 5, day: 2, unixtimestamp: T(2026, 5, 2) },
      { cntry: 'Хятад', pax: 70, year: 2026, month: 9, day: 14, unixtimestamp: T(2026, 9, 14) },
      { cntry: 'Монгол', pax: 999, year: 2026, month: 9, day: 1, unixtimestamp: T(2026, 9, 1) },
      { cntry: 'Япон', pax: 20, year: 2026, month: 4, day: 9, unixtimestamp: T(2026, 4, 9) }
    ];
    const a3 = aiEnv({ _flightsYears: [2025, 2026], _flightsCache: { 2026: fl, 2025: [] } }).ask(2);
    check('AI1. Эхний чиглэл Хятад (170 хүн) — Монгол (999) дотоод тул ХАСАГДСАН',
      a3 && a3.live && /Хятад[^0-9]*170/.test(a3.text) && !/999/.test(a3.text), a3 && a3.text);
    check('AI1. Хоёрдугаарт Өмнөд Солонгос (150 хүн)', a3 && /Өмнөд Солонгос[^0-9]*150/.test(a3.text), a3 && a3.text);
    check('AI1. Хугацаа ИЛ — 2026 он, сүүлийн бичлэг 2026-09-14',
      a3 && a3.text.includes('2026') && a3.text.includes('2026-09-14'), a3 && a3.text);
    check('AI1. Зохиомол 457,815 / 357,372 АЛГА', a3 && !/457,815|357,372/.test(a3.text));
    const a3one = aiEnv({ _flightsYears: [2026], _flightsCache: { 2026: [fl[0]] } }).ask(2);
    check('AI1. Ганц улстай бол "дараа нь …" ЗОХИОХГҮЙ → a_nodata', a3one && a3one.live === false, JSON.stringify(a3one));

    /* ── Эх сурвалжгүй салбар — холбогдсон салбарыг registry-ээс нэрлэнэ ── */
    const aRoad = aiEnv({ kpiVerified: (w, s) => s === 'air' || s === 'rail' }).ask(1);
    check('AI1. Авто зам: эх сурвалжгүй → тоо огт алга', aRoad && aRoad.live === false && !/\d/.test(aRoad.text), aRoad && aRoad.text);
    /* Дараалал = SECTORS-ийн дараалал (road, rail, air, …) — сайтын бусад
       салбарын жагсаалттай ижил. */
    check('AI1. Холбогдсон салбарыг registry-ээс нэрлэнэ (Төмөр зам, Агаарын тээвэр)',
      aRoad && aRoad.text.includes('салбар: Төмөр зам, Агаарын тээвэр.'), aRoad && aRoad.text);
    const aPub = aiEnv({}).ask(3);
    check('AI1. Нийтийн тээвэр: зохиомол 139/959/312 АЛГА; холбогдсон салбаргүй бол "мэдээлэл алга"',
      aPub && !/\d/.test(aPub.text) && /мэдээлэл алга/.test(aPub.text), aPub && aPub.text);

    /* Дүүрээгүй нүд: админ "{bogus}" бичвэл түүхий хаалт ХАРАГДАХГҮЙ */
    const eB = aiEnv({ _heroFlLastMonth: { count: 5, year: 2026, month: 8, monthLabel: '8-р сар', prevCount: 4 } });
    const qa0 = Object.assign({ ans: 'flights_last_month' }, eB.con.site.ai.qa[0]);
    qa0.a_live = qa0.a_live + ' {bogus}';
    const resolveB = new Function('i', 'AI_QA', 'AI_SOURCES', 'SECTORS', 'stxt', k.resolve);
    const aB = resolveB.call(eB.ctx, 0, [qa0], eB.con.site.ai.sources, { air: { label: 'Агаарын тээвэр' } }, eB.stxt);
    check('AI1. Дүүрээгүй {…} нүдтэй темплейт → a_nodata (түүхий хаалт ХЭЗЭЭ Ч харагдахгүй)',
      aB && aB.live === false && !/[{}]/.test(aB.text), aB && aB.text);
  }

  /* ── AI1b. Чөлөөт асуулт — хуучин чипийн текстийг ГАРААР бичсэн ч
     нислэгийн (амьд) хариулт руу очно, хамааралгүй асуулт → -1 ── */
  const mm = dcScript().match(/\n  aiMatch\(q\)\{([\s\S]*?)\n  \}\n/);
  if (!mm) bad('AI1b. aiMatch() олдсонгүй');
  else {
    const qa = readJson('content.json').site.ai.qa;
    const match = (q) => new Function('q', 'AI_QA', mm[1])(q, qa);
    check('AI1b. "Өнөөдөр хэдэн нислэг бүртгэгдсэн бэ?" → нислэгийн асуулт (0)',
      match('Өнөөдөр хэдэн нислэг бүртгэгдсэн бэ?') === 0, String(match('Өнөөдөр хэдэн нислэг бүртгэгдсэн бэ?')));
    check('AI1b. "Хамгийн их зорчигч аль чиглэлд?" → улсын асуулт (2)',
      match('Хамгийн их зорчигч аль чиглэлд?') === 2, String(match('Хамгийн их зорчигч аль чиглэлд?')));
    check('AI1b. Хамааралгүй асуулт → -1 (зохиомол хариулт СОНГОХГҮЙ)', match('Цаг агаар ямар байна?') === -1);
  }

  /* ── AI2. РЕГРЕСС — ижил хуудас, ИЖИЛ нийт дүн ── */
  if (k.val && k.resolve) {
    const hero = { count: 2450, year: 2026, month: 8, monthLabel: '8-р сар', prevCount: 2300 };
    const valFn = new Function('widgetId', 'fallback', k.val);
    const hv = valFn.call({ state: { metricRegistry: { widgets: { hero_fl: { metric: 'air.flight_count_last_month' } } } },
      _heroFlLastMonth: hero }, 'hero_fl', '11,979');
    const a = aiEnv({ _heroFlLastMonth: hero }).ask(0);
    check('AI2. hero_fl ба AI хариулт ЯГ ИЖИЛ тоо (2,450)',
      hv.value === '2,450' && a && a.text.includes(hv.value), JSON.stringify({ hero: hv.value, ai: a && a.text }));
    check('AI2. hero_fl ба AI ИЖИЛ сар (8-р сар)', a && a.text.includes(hv.monthLabel), a && a.text);
  } else bad('AI2. val() эсвэл aiResolve() олдсонгүй');

  /* ── AI3. YoY цонх — prevCount нь ӨМНӨХ ОНЫ МӨН САРААС ──
     2026: 8-р сард 3 нислэг, 9-р сард 1 (хамгийн сүүлийнх → сүүлийн БҮТЭН сар = 8)
     2025: 8-р сард 2 нислэг, 7-р сард 5 (7-р сар ТООЦОГДОХГҮЙ) → prevCount 2 */
  if (k.hero && k.win) {
    const F = (y, m, d) => ({ year: y, month: m, day: d, unixtimestamp: Date.UTC(y, m - 1, d) / 1000 });
    const MONTHS = ['1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар',
      '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'];
    const run = (cache, years) => {
      const ctx = { _flightsYears: years, _flightsCache: cache };
      const win = new Function('MONTHS', 'year', k.win);
      ctx.lastFullMonthWindow = (y) => win.call(ctx, MONTHS, y);
      new Function('MONTHS', k.hero).call(ctx, MONTHS);
      return ctx._heroFlLastMonth;
    };
    const c26 = [F(2026, 8, 1), F(2026, 8, 2), F(2026, 8, 30), F(2026, 9, 3)];
    const c25 = [F(2025, 8, 5), F(2025, 8, 6), F(2025, 7, 1), F(2025, 7, 2), F(2025, 7, 3), F(2025, 7, 4), F(2025, 7, 5)];
    const h = run({ 2026: c26, 2025: c25 }, [2025, 2026]) || {};
    check('AI3. Сүүлийн бүтэн сар = 8-р сар, 3 нислэг', h.month === 8 && h.count === 3, JSON.stringify(h));
    check('AI3. prevCount = 2025 оны 8-р сар (2) — 7-р сар орохгүй', h.prevCount === 2, JSON.stringify(h));
    const h2 = run({ 2026: c26 }, [2026]);
    check('AI3. Өмнөх оны cache алга → prevCount null (0 гэж ЗОХИОХГҮЙ)',
      !!h2 && h2.prevCount === null, JSON.stringify(h2));
    const e3 = aiEnv({ _heroFlLastMonth: h }).ask(0);
    check('AI3. Бүтэн гинж: 3 vs 2 → +50.0%', e3 && e3.text.includes('+50.0%'), e3 && e3.text);
  } else bad('AI3. computeHeroFlightsLastMonth()/lastFullMonthWindow() олдсонгүй');

  /* ── AI4. Кодын холбоос ── */
  const s = dcScript();
  const qaBlock = (s.match(/const AI_QA=\[([\s\S]*?)\n\];/) || [])[1] || '';
  const digitAt = qaBlock.replace(/\{\w+\}/g, '').match(/.{0,30}\d.{0,30}/);
  check('AI4. AI_QA кодын fallback-д тоо үлдээгүй (зөвхөн {…} нүд)',
    qaBlock.length > 0 && !digitAt, digitAt ? digitAt[0] : '');
  check('AI4. AI_QA мөр бүр ans түлхүүртэй (4 мөр)', (qaBlock.match(/\{ans:/g) || []).length === 4);
  check('AI4. Хуучин AI_QA[..].a шууд уншилт үлдээгүй',
    !/AI_QA\[\w+\]\.a\b/.test(s) && !/hit\?hit\.a:/.test(s));
  check('AI4. Анхны бөмбөлөг aiResolve(0)-аар (render бүрд амьд)',
    (s.match(/this\.aiResolve\(0\)/g) || []).length >= 2);
  check('AI4. askAi хариултыг aiResolve-оор бүрдүүлнэ', /const r=hit\?this\.aiResolve\(AI_QA\.indexOf\(hit\)\):null;/.test(s));
  check('AI4. Олдоогүй үеийн текст ба эх сурвалж content.json-оос',
    /stxt\('ai\.no_match'/.test(s) && /stxt\('ai\.fallback_source'/.test(s) &&
    !/:'Салбарын нэгдсэн үзүүлэлт';/.test(s));
  check('AI4. Үнэлгээ a_live/a_nodata-г хамт хайна (хуучин x.a биш)',
    /al=\(\(x\.a_live\|\|''\)\+' '\+\(x\.a_nodata\|\|''\)\)\.toLowerCase\(\)/.test(s));
  check('AI4. applySiteContent a_live/a_nodata-г давхарлана',
    /\['q','a_live','a_nodata'\]\.forEach/.test(s) && !/if\(x\.a\) AI_QA\[i\]\.a=x\.a;/.test(s));
  check('AI4. computeHeroFlightsLastMonth prevCount тооцно (hero/k04/AI нэг объект)',
    /this\._heroFlLastMonth=\{count,year:win\.lmYear,month:win\.lmMonth,monthLabel:win\.monthLabel,prevCount\};/.test(s));

  /* ── AI5. content.json ── */
  const con = readJson('content.json');
  const ai = con.site.ai;
  const noSlot = (t) => String(t || '').replace(/\{\w+\}/g, '');
  /* Мөрийн БҮХ текст талбарыг шална — зөвхөн нэрлэсэн талбарыг шалгавал
     хуучин "a" талбарын 11,979 ХУДАЛ ногоон болж өнгөрдөг (сөрөг
     шалгуурын хавх — анхны улаан ажиллуулалтад яг ингэж өнгөрсөн). */
  const hasDigit = (x) => Object.keys(x).some((kk) => typeof x[kk] === 'string' && /\d/.test(noSlot(x[kk])));
  check('AI5. Шалгуур ЭЕРЭГ хостой: хуучин "11,979" мөрийг ЗААВАЛ илрүүлнэ',
    hasDigit({ q: 'Өнөөдөр?', a: 'нийт 11,979 нислэг' }) && !hasDigit({ q: 'x', a_live: '{value} нислэг' }));
  const qaDigits = ai.qa.filter(hasDigit);
  check('AI5. site.ai.qa-д хатуу тоо үлдээгүй ("Тоо ЗОХИОХГҮЙ")', qaDigits.length === 0, JSON.stringify(qaDigits));
  check('AI5. Хуучин "a" талбар устсан (ганц эх сурвалж)', ai.qa.every((x) => !('a' in x)));
  check('AI5. Мөр бүр q + a_nodata-тай', ai.qa.length === 4 && ai.qa.every((x) => x.q && x.a_nodata));
  check('AI5. Амьд эх сурвалжтай 2 асуулт a_live-тай (нислэг, улс)',
    !!ai.qa[0].a_live && !!ai.qa[2].a_live && !ai.qa[1].a_live && !ai.qa[3].a_live);
  check('AI5. Нислэгийн темплейт тоо/сар/жил/хувийн нүдтэй',
    ['{value}', '{month}', '{year}', '{delta}'].every((t) => (ai.qa[0].a_live || '').includes(t)), ai.qa[0].a_live);
  check('AI5. 1-р асуулт "өнөөдөр" гэж ХУДАЛ хэлэхгүй (хариулт нь сүүлийн бүтэн сар)',
    !/өнөөдөр/i.test(ai.qa[0].q) && /бүтэн сар/.test(ai.qa[0].q), ai.qa[0].q);
  check('AI5. delta_yoy / no_match бүртгэлтэй', /\{pct\}/.test(ai.delta_yoy || '') && /\{n\}/.test(ai.no_match || ''));
  check('AI5. Эх сурвалжийн шошгонд хатуу он алга', ai.sources.every((x) => !/\d{4}/.test(x)), JSON.stringify(ai.sources));
  check('AI5. no_match "тодорхой тоо гаргаж чадна" гэж ХЭТ амлахгүй', !!ai.no_match && !/тодорхой тоо/.test(ai.no_match));

  /* ── AI6. Админ ── */
  const adm = adminScript();
  check('AI6. Админ AI асуулт-хариултыг тусдаа бүлэгт харуулна',
    /siteGet\(\['ai','qa'\]\)/.test(adm) && /add\('site','q:ai'/.test(adm));
  check('AI6. Талбар бүр ойлгомжтой шошготой (асуулт / амьд / дата алга)',
    /utxt\('site_tab\.ai_q'/.test(adm) && /utxt\('site_tab\.ai_live'/.test(adm) && /utxt\('site_tab\.ai_nodata'/.test(adm));
  const st = (con.ui && con.ui.site_tab) || {};
  check('AI6. Шошгууд content.json ui.site_tab-д бүртгэлтэй',
    ['ai_group', 'ai_where', 'ai_word', 'ai_q', 'ai_live', 'ai_nodata', 'ai_delta', 'ai_no_match'].every((x) => !!st[x]));
  check('AI6. delta_yoy / no_match ч AI бүлэгт (түүхий нэртэй "автомат" бүлэгт УНАХГҮЙ)',
    /p:\['ai','delta_yoy'\],l:utxt\('site_tab\.ai_delta'/.test(adm) && /p:\['ai','no_match'\],l:utxt\('site_tab\.ai_no_match'/.test(adm) &&
    /m\['ai\.delta_yoy'\]=1; m\['ai\.no_match'\]=1;/.test(adm));
  check('AI6. Бүлгийн тайлбар {…} нүдийг код дүүргэдэг гэж ил хэлнэ',
    /\{/.test(st.ai_where || '') && /тоо/.test(st.ai_where || ''), st.ai_where);

  /* ── AI7. Сайтын DOM (ХОЁР ДАХЬ тал — админ дээр зөв байх нь сайт зөв гэсэн үг БИШ) ── */
  if (!CHROME) { skipped('AI7. Сайтын DOM', 'Chrome олдсонгүй'); return; }
  const PROBE_AI = `async function(d,w){
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const heroEl=()=>d.querySelector('[data-eh-fallback="false"]');
    for(let t=0;t<60&&!heroEl();t++) await sleep(500);
    await sleep(600);
    const h=heroEl();
    /* firstChild нь dc-runtime-ийн ХООСОН текст зангилаа — тоог
       textContent-ийн эхнээс авна ("2,450 НИСЛЭГ / САР (8-р сар)"). */
    const hm=h?h.textContent.trim().match(/^[\\d,]+/):null;
    const heroVal=hm?hm[0]:null;
    const bots=()=>[...d.querySelectorAll('[data-ai-text="bot"]')].map(x=>x.textContent.trim());
    const srcs=()=>[...d.querySelectorAll('[data-ai-src]')].map(x=>x.textContent.trim());
    const chipsNow=()=>[...d.querySelectorAll('button')].filter(b=>/\\?$/.test(b.textContent.trim()));
    const out={heroVal,first:bots()[0]||null,firstSrc:srcs()[0]||null,
      chips:chipsNow().map(c=>c.textContent.trim()),ans:[],srcAns:[]};
    for(let i=0;i<out.chips.length;i++){
      const n=bots().length;
      chipsNow()[i].click();
      for(let t=0;t<30&&bots().length===n;t++) await sleep(250);
      const b=bots(), s=srcs();
      out.ans.push(b[b.length-1]); out.srcAns.push(s[s.length-1]);
    }
    out.anyBrace=/[{}]/.test(bots().join(' '));
    return out;
  }`;
  const srv = serve();
  try {
    PROBE_SRC = '/index.html';
    SERVE_OVERRIDE = null;
    const r = await runProbe(PROBE_AI, 150000);
    if (r.__err) { bad('AI7. Сайтын DOM шалгалт', r.__err); return; }
    if (!r.heroVal) { skipped('AI7. Сайтын DOM', 'flights feed ирсэнгүй (сүлжээ)'); return; }
    check('AI7. Анхны бөмбөлөг hero-тэй ИЖИЛ тоо хэлнэ (' + r.heroVal + ')',
      !!r.first && r.first.includes(r.heroVal + ' '), JSON.stringify({ hero: r.heroVal, ai: r.first }));
    check('AI7. Сайт дээр 11,979 / +8.4% ГАРАХГҮЙ', !!r.first && !/11,979|\+8\.4%/.test(r.first));
    check('AI7. 4 бэлэн асуулт харагдана', r.chips.length === 4, JSON.stringify(r.chips));
    check('AI7. Чип бүр хариулт авна', r.ans.length === 4 && r.ans.every(Boolean), JSON.stringify(r.ans));
    check('AI7. Нислэгийн чип — hero-тэй ИЖИЛ тоо', (r.ans[0] || '').includes(r.heroVal + ' '), r.ans[0]);
    check('AI7. Улсын чип — зохиомол 457,815 АЛГА, бодит тоотой',
      !/457,815/.test(r.ans[2] || '') && /\d/.test(r.ans[2] || ''), r.ans[2]);
    check('AI7. Авто зам / нийтийн тээвэр — тоо огт алга, "мэдээлэл алга"',
      [r.ans[1], r.ans[3]].every((t) => t && !/\d/.test(t) && /мэдээлэл алга/.test(t)), JSON.stringify([r.ans[1], r.ans[3]]));
    check('AI7. Эх сурвалжгүй хариултын шошго "мэдээлэл алга"',
      /мэдээлэл алга$/.test(r.srcAns[1] || '') && /мэдээлэл алга$/.test(r.srcAns[3] || ''), JSON.stringify(r.srcAns));
    check('AI7. Сайт дээр түүхий {…} нүд ХЭЗЭЭ Ч гарахгүй', r.anyBrace === false);
  } finally {
    SERVE_OVERRIDE = null;
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* ──────────────────────────────── АЖИЛЛУУЛАХ ──────────────────────────────── */
console.log('ErtHub — систем тест');
(async () => {
  /* --only=Z — нэг бүлгийг хурдан давтах (хөгжүүлэлтийн үед). Commit-ийн
     өмнө ЗААВАЛ бүтнээр нь ажиллуулна. */
  if (process.argv.includes('--only=BE')) { await groupBE(); }
  else if (process.argv.includes('--only=G')) { await groupG(); await groupG3(); await groupG4(); }
  else if (process.argv.includes('--only=G4')) { await groupG4(); }
  else if (process.argv.includes('--only=AI')) { await groupAI(); }
  else if (process.argv.includes('--only=N')) { await groupN(); }
  else if (process.argv.includes('--only=Z')) { await groupZ(); await groupZ2(); await groupZ3(); await groupZ4(); await groupZ5(); }
  else {
  groupA(); groupB(); await groupC(); groupD(); groupE(); await groupF(); await groupG(); await groupG3(); await groupG4(); await groupH();
  groupI(); await groupI2(); await groupI3(); await groupI4(); await groupJ(); await groupK(); await groupL(); await groupM(); await groupN(); await groupO(); groupP(); groupQ(); groupR(); await groupS(); await groupU(); await groupW(); await groupX(); await groupY(); await groupZ(); await groupZ2(); await groupZ3(); await groupZ4(); await groupZ5(); await groupBE(); await groupAI();
  }

  console.log('\n' + '═'.repeat(62));
  console.log('НИЙТ:  PASS ' + pass + '  ·  FAIL ' + fail + '  ·  SKIP ' + skip);
  if (failures.length) {
    console.log('\nУНАСАН ТЕСТ:');
    failures.forEach(f => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
})();

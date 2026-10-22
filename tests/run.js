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
const os = require('os');
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
    /* DG-P: агаарын хугацааны мөр chartPeriodText()-ээр stxt('chart.'+k) гэж ДИНАМИК уншина */
    if (/^chart\.(period_|scope_months$)/.test(p)) return !/stxt\('chart\.'\+k/.test(src);
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
      /* `ds_schema_road_inspect` — үзлэгийн датасэтийн баганын нэр/тайлбар.
         applyRoadInspectionData() дотор ИНДЕКСЭЭР уншдаг (вагонтой ижил). */
      'ds_schema_road_inspect',
      /* `ds_schema_rail_freight` — ачаа тээврийн нэгтгэлийн хүснэгт; syncFreightTable()
         ИНДЕКСЭЭР уншина (вагонтой ижил). */
      'ds_schema_rail_freight',
      /* Авто тээврийн зорчигч — хүснэгтийн fallback схем ба анализын самбар (T('kpi_pax') туслахаар,
         stxt('road_pax_an.'+k)); түлхүүр бүрийг RPX26 баталгаажуулна. */
      'ds_schema_road_pax', 'road_pax_an',
      /* `sector_kpi_road_live` ба `road_fail_cats` — техникийн хяналтын
         үзлэгийн KPI мөрийн нэр ба тэнцээгүй хэсгийн шошго.
         applyRoadInspectionData() дотор ИНДЕКСЭЭР уншдаг
         (sector_kpi_*_live-тэй ижил зарчим). */
      'sector_kpi_road_live', 'road_fail_cats',
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
      /* `vehreg` — тээврийн хэрэгслийн бүртгэлийн самбар. Зам нь
         слотын id-гаас нийлүүлэгддэг (L('share.'+s.id)) тул ШУУД
         бичлэг хайх аргаар олдохгүй. Зам бүр үнэхээр уншигддагийг
         V13-ын round-trip (content.json → самбарын гаралт) баталдаг. */
      'vehreg',
      /* `wagon_an` — вагоны анализын самбар. Зам нь T('kpi_loaded') гэх мэт
         жижиг туслахаар дамждаг (stxt('wagon_an.'+k)) тул шууд бичлэг хайх
         аргаар олдохгүй. Түлхүүр бүр WA7-д баталгаажна. */
      'wagon_an', 'pax_an', 'freight_an',
      /* `sector_total` — салбарын нэгтгэлийн самбар, T('kpi_pax') туслахаар
         (stxt('sector_total.'+k)); түлхүүр бүрийг ST21 баталгаажуулна. */
      'sector_total',
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
  /* ?fx=1 — feed-ийн фикстурыг (tests/lib/feed-fixtures.js) хуудасны бүх
     скриптээс ӨМНӨ тарина (scripts/serve.js, layout-audit-тай ижил). */
  const withFx = (req, p, body) => {
    if (!/[?&]fx=1/.test(req.url) || !/(^\/|index\.html)$/.test(p)) return body;
    const h = String(body), i = h.indexOf('<head>');
    return i < 0 ? body : h.slice(0, i + 6) + '<script src="/tests/lib/feed-fixtures.js"></script>' + h.slice(i + 6);
  };
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (SERVE_OVERRIDE && SERVE_OVERRIDE[p] != null) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'text/plain',
        'Cache-Control': 'no-store' });
      res.end(withFx(req, p, SERVE_OVERRIDE[p]));
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
      res.end(withFx(req, p, data));
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
  /* Тусдаа профайл — өөрийн хэрэглэгчийн Chrome эсвэл зэрэгцээ проб руу
     хуудас дамжуулж (process handoff), хугацаа хэтэрдэг байсныг зайлсхийнэ */
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'erthub-probe-'));
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--mute-audio',
    '--disable-features=Translate,OptimizationHints',
    '--user-data-dir=' + profile,
    'http://localhost:' + PORT + '/__probe__'], { stdio: 'ignore' });
  const deadline = Date.now() + (waitMs || 90000);
  while (PROBE_RESULT === null && Date.now() < deadline) await sleep(250);
  try { ch.kill(); } catch (e) {}
  /* Профайлыг цэвэрлэнэ; Windows дээр Chrome түгжсэн байвал алгасна */
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 1000);
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

const PROBE_F = "async function(d,w){\n  const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n  await sleep(3500);\n  for(let i=0;i<120&&d.querySelector('.pvfeed');i++) await sleep(500);\n  const SEC={hero_fl:'hero',hero_px:'hero',uk:'portal-kpi',ls:'sec-01',\n    w2p:'sec-02',w2pb:'sec-02',w2px:'sec-02',w2c:'sec-02',w2cb:'sec-02',\n    w2cx:'sec-02',k04:'sec-04',t05:'sec-05',d05:'sec-05',i06:'sec-06',\n    r06:'sec-06',u07:'sec-07'};\n  const norm=t=>t.replace(/[\\s\\u00a0]+/g,' ').trim();\n  const pvT=()=>norm(d.getElementById('pvhost').innerText);\n  const edT=()=>norm(d.querySelector('.edit2').innerText);\n  const geo=()=>[].slice.call(d.querySelectorAll('#pvhost rect,#pvhost circle,#pvhost path,'+\n      '#pvhost .pvsc .v,#pvhost .pvgc .v,#pvhost .pvrow b,#pvhost .pvrk i,'+\n      '#pvhost .pvcd .d,#pvhost .sp-val'))\n    .map(e=>e.tagName+':'+(e.getAttribute('height')||e.getAttribute('d')||\n      e.getAttribute('stroke-dasharray')||e.getAttribute('style')||e.textContent)).join('|');\n  const snap=()=>({t:pvT(),g:geo()});\n  const go=id=>{ let b,n=0; while((b=d.querySelector('[data-back]'))&&n++<6) b.click();\n    const s=d.querySelector('[data-section=\"'+SEC[id]+'\"]'); if(!s) return false;\n    s.click(); const c=d.querySelector('[data-widget=\"'+id+'\"]'); if(!c) return false;\n    c.click(); return true; };\n  const probeAll=(q,attr,mk,scope)=>{ const out={};\n    [].slice.call(d.querySelectorAll(q)).map(x=>x.getAttribute(attr)).forEach(k=>{\n      const e=d.querySelector('['+attr+'=\"'+k+'\"]'); if(!e) return;\n      const ov=e.value, pr=mk(k);\n      e.value=pr; e.dispatchEvent(new w.Event('input',{bubbles:true}));\n      out[k]=scope().indexOf(pr)>=0?'PASS':'FAIL';\n      e.value=ov; e.dispatchEvent(new w.Event('input',{bubbles:true}));\n    }); return out; };\n  const R={rows:[]};\n  for(const id of Object.keys(SEC)){\n    const row={id:id};\n    if(!go(id)){ row.nav=false; R.rows.push(row); continue }\n    row.nav=true;\n    const pw=()=>!!d.querySelector('[data-periodwarn]');\n    row.pw0=pw();\n    const s0=snap();\n    const sels=[].slice.call(d.querySelectorAll('[data-slot]'));\n    if(!sels.length){ row.swap='N/A'; row.back='N/A' }\n    else{\n      const sel=sels[0], cur=sel.value;\n      const en=[].slice.call(sel.options).filter(o=>!o.disabled&&o.value!==cur).map(o=>o.value);\n      const all=[].slice.call(sel.options).map(o=>o.value).filter(v=>v!==cur);\n      const pref=en.filter(v=>v);\n      const tgt=pref.length?pref[0]:(en.length?en[0]:all[0]);\n      sel.value=tgt; sel.dispatchEvent(new w.Event('change',{bubbles:true}));\n      const s1=snap();\n      row.pwSwap=pw();\n      row.swap=(s1.t!==s0.t||s1.g!==s0.g);\n      row.swapInfo=(cur||'—')+' → '+(tgt||'—');\n      const s2=d.querySelector('[data-slot]');\n      s2.value=cur; s2.dispatchEvent(new w.Event('change',{bubbles:true}));\n      const s3=snap();\n      row.pwBack=pw();\n      row.back=(s3.t===s0.t&&s3.g===s0.g);\n    }\n    const tf=probeAll('[data-tf]','data-tf',k=>'ZZ'+k.toUpperCase()+'ZZ',pvT);\n    const sf=probeAll('.e-fm [data-sf]','data-sf',()=>'ZZSFZZ',pvT);\n    const rf=probeAll('[data-rf]','data-rf',()=>'ZZRFZZ',edT);\n    row.tfN=Object.keys(tf).length; row.sfN=Object.keys(sf).length; row.rfN=Object.keys(rf).length;\n    row.dead=[].concat(Object.entries(tf),Object.entries(sf),Object.entries(rf))\n      .filter(x=>x[1]!=='PASS').map(x=>x[0]);\n    row.text=Object.values(tf).every(v=>v==='PASS');\n    R.rows.push(row);\n  }\n  if(go('hero_px')){\n    const sx=d.querySelector('[data-slot]');\n    sx.value='air.weekly_pax'; sx.dispatchEvent(new w.Event('change',{bubbles:true}));\n    const vis=()=>{const b=d.querySelector('[data-periodwarn]');\n      return !!b&&b.style.display!=='none'};\n    R.px={warn:vis()};\n    const fb=d.querySelector('[data-periodwarn] [data-autoname]');\n    R.px.fix=fb?fb.getAttribute('data-autoname'):null;\n    if(fb) fb.click();\n    R.px.title=(d.querySelector('[data-tf=\"title\"]')||{}).value;\n    R.px.warnAfterFix=vis();\n    const sy=d.querySelector('[data-slot]');\n    sy.value=''; sy.dispatchEvent(new w.Event('change',{bubbles:true}));\n    const cc=d.querySelector('[data-tcancel]'); if(cc&&!cc.disabled) cc.click();\n  }\n  if(go('ls')){\n    const pv=()=>{const x=d.getElementById('pendRow');return !!x&&x.style.display!=='none'};\n    const t1=d.querySelector('[data-tf=\"title\"]');\n    const orig=t1.value;\n    t1.value='ZZDRAFTZZ'; t1.dispatchEvent(new w.Event('input',{bubbles:true}));\n    R.dr={bar:pv()};\n    let q,qn=0; while((q=d.querySelector('[data-back]'))&&qn++<6) q.click();\n    R.dr.barAway=pv();\n    go('ls');\n    R.dr.kept=(d.querySelector('[data-tf=\"title\"]')||{}).value==='ZZDRAFTZZ';\n    d.querySelector('[data-penddrop]').click();\n    R.dr.dropped=(d.querySelector('[data-tf=\"title\"]')||{}).value===orig&&!pv();\n    const t2=d.querySelector('[data-tf=\"title\"]');\n    t2.value='ZZAPPLYZZ'; t2.dispatchEvent(new w.Event('input',{bubbles:true}));\n    let q2,qm=0; while((q2=d.querySelector('[data-back]'))&&qm++<6) q2.click();\n    d.querySelector('[data-pendsave]').click();\n    go('ls');\n    R.dr.applied=(d.querySelector('[data-tf=\"title\"]')||{}).value==='ZZAPPLYZZ'&&!pv();\n    const t3=d.querySelector('[data-tf=\"title\"]');\n    t3.value=orig; t3.dispatchEvent(new w.Event('input',{bubbles:true}));\n    const sv=d.querySelector('[data-tsave]'); if(sv&&!sv.disabled) sv.click();\n  }\n  if(go('hero_fl')){\n    const a1=d.querySelector('[data-slot]'), c1=a1.value;\n    const fo=[].slice.call(a1.options).filter(function(o){\n      return !o.disabled&&o.value.indexOf('field:')===0&&o.value.indexOf('field:|')!==0})[0];\n    if(fo){\n      a1.value=fo.value; a1.dispatchEvent(new w.Event('change',{bubbles:true}));\n      R.rt={pick:fo.value,mid:d.getElementById('dirtyMsg').textContent};\n      /* render() дараа select нь ШИНЭ зангилаа — ДАХИН асууж авна */\n      const a2=d.querySelector('[data-slot]');\n      R.rt.fresh=(a1!==a2);\n      a2.value=c1; a2.dispatchEvent(new w.Event('change',{bubbles:true}));\n      R.rt.back=d.getElementById('dirtyMsg').textContent;\n      R.rt.card=(d.querySelector('#pvhost')||{}).innerText;\n    }\n  }\n  R.dirty=d.getElementById('dirtyMsg').textContent;\n  return R;\n}";

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
    REG_B.widgets.hero_px.sectors.road.metric = 'air.weekly_pax';
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
  for(let i=0;i<120&&d.querySelector('.pvfeed');i++) await sleep(500);
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
  for(let i=0;i<120&&d.querySelector('.pvfeed');i++) await sleep(500);
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
  for(let i=0;i<120&&d.querySelector('.pvfeed');i++) await sleep(500);
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

/* ── AX. Агаарын датасэтийн хуудасны график — статистикийн үндсэн шаардлага ──
   Эх veritech dashboard-тай харьцуулахад илэрсэн алдаанууд:
   (1) тэнхлэг "82,500 · 165,000 · 247,500" / "1,525" гэх мэт дугуй бус тоо,
   (2) өмнөх оны багана, legend алга, өсөлтийн тэнхлэгт "%" ба 0 шугам алга,
   (3) өмнөх оны дата алга үед өсөлтийг 0% гэж ЗОХИОДОГ байв,
   (4) "ОУ/Дотоодын харьцаа" (зорчигч) донут НИСЛЭГИЙН хувиар (75/25) зурагдаж,
       өгөгдөлгүй үед '75%' зохиомол утга руу унадаг байв,
   (5) treemap дээр "Зүүн Ази"/"Зүүн Өмнөд Ази" ижил өнгөтэй байв.
   Доорх тоонууд ГАРААР бодогдсон. */
function groupAX() {
  group('AX. Агаарын графикийн тэнхлэг/legend/донут');
  const src = dcScript();
  const fn = (name) => {
    const m = src.match(new RegExp('function ' + name + '\\(([^)]*)\\)\\{([\\s\\S]*?)\\n\\}'));
    return m ? 'function ' + name + '(' + m[1] + '){' + m[2] + '\n}' : null;
  };
  const parts = ['niceStep', 'niceAxis', 'fmtAxisNum', 'buildDualAxisChart'].map(fn);
  if (parts.some((x) => !x)) { bad('AX. график функц олдсонгүй'); return; }
  const lib = new Function('MONTHS',
    parts.join('\n') + '\nreturn {niceStep,niceAxis,fmtAxisNum,buildDualAxisChart};')(
    ['1-р сар', '2-р сар', '3-р сар']);

  /* niceStep: 82,500 → 10^4·8.25 → 10 → 100,000; 75 → 100; 2.5 → 2.5; 30 → 50 */
  check('AX1. niceStep — 1/2/2.5/5×10^k',
    lib.niceStep(82500) === 100000 && lib.niceStep(75) === 100 &&
    lib.niceStep(2.5) === 2.5 && lib.niceStep(30) === 50,
    [lib.niceStep(82500), lib.niceStep(75), lib.niceStep(2.5), lib.niceStep(30)].join(','));
  /* 0…320,000: алхам niceStep(80,000)=100,000 → 0,100k,200k,300k,400k */
  const a1 = lib.niceAxis(0, 320000);
  check('AX2. Зорчигчийн тэнхлэг дугуй тоо (82,500 биш)',
    JSON.stringify(a1.ticks) === JSON.stringify([0, 100000, 200000, 300000, 400000]),
    JSON.stringify(a1.ticks));
  /* 1,300…2,500 (нислэг): 1200/4=300 → 500; 1000…2500 */
  const a2 = lib.niceAxis(1300, 2500);
  check('AX3. Нислэгийн тэнхлэг 1,000/1,500/2,000/2,500 (1,525 биш)',
    JSON.stringify(a2.ticks) === JSON.stringify([1000, 1500, 2000, 2500]), JSON.stringify(a2.ticks));
  /* Өсөлт −20…30: 50/4=12.5 → 20; −20,0,20,40 — 0 тэнхлэгт заавал */
  const a3 = lib.niceAxis(-20, 30);
  check('AX4. Өсөлтийн % тэнхлэгт 0 багтана',
    JSON.stringify(a3.ticks) === JSON.stringify([-20, 0, 20, 40]), JSON.stringify(a3.ticks));

  /* Хос багана: [100,200] + өмнөх он [50,300]; max 300 → алхам 100 → 0…300.
     Шугам (%) [10,null]: 0…10, алхам 2.5 → "0%,+2.5%,+5%,+7.5%,+10%". */
  const c1 = lib.buildDualAxisChart([100, 200], [10, null], ['1-р сар', '2-р сар'],
    { prevBars: [50, 300], linePct: true });
  check('AX5. Багана 0-ээс, өмнөх оны баганыг ч багтаасан тэнхлэг',
    c1.yTicksLeft.map((t) => t.label).join(',') === '0,100,200,300',
    c1.yTicksLeft.map((t) => t.label).join(','));
  check('AX6. Өмнөх оны багана зурагдана (2 ш)', c1.hasPrev === true && c1.prevRects.length === 2,
    String(c1.prevRects.length));
  check('AX7. Өсөлтийн баруун тэнхлэг "%" тэмдэгтэй',
    c1.yTicksRight.map((t) => t.label).join(',') === '0%,+2.5%,+5%,+7.5%,+10%',
    c1.yTicksRight.map((t) => t.label).join(','));
  check('AX8. Суурьгүй (null) сар цэг/шугамгүй — 0% зохиохгүй',
    c1.dotPts.length === 1 && !/L/.test(c1.line) && c1.dotPts[0].color === '#2FA37B',
    c1.dotPts.length + ' · ' + c1.line);
  const c2 = lib.buildDualAxisChart([5, 5], [-10, 20], ['1-р сар', '2-р сар'], { linePct: true });
  check('AX9. Сөрөг/эерэг өсөлт — 0 лавлах шугам + улаан/ногоон цэг',
    c2.hasZeroLine === true && c2.dotPts[0].color === '#D2564A' && c2.dotPts[1].color === '#2FA37B',
    c2.hasZeroLine + ' ' + c2.dotPts.map((d) => d.color).join(','));
  const c3 = lib.buildDualAxisChart([100, 200], [1, 2], ['1-р сар', '2-р сар']);
  check('AX10. opts-гүй дуудлага (чарт бүтээгч) хуучнаараа — өмнөх оны багана алга',
    c3.hasPrev === false && c3.prevRects.length === 0 && c3.barRects.length === 2);

  /* Донут — зорчигчоор, зохиомол fallback-гүй */
  /* HV (зорчигчийн графикийн стандарт): нэр+дүн, дутуу сар шугамд холбогдохгүй,
     шугамын тэнхлэг 0-ээс, сүүлийн (дутуу) сар x тэнхлэгт шошготой. */
  const hv = lib.buildDualAxisChart([100, 200, 50], [10, 20, 5], ['25-01', '25-02', '25-03*'],
    { hv: true, lineZero: true, barLabel: 'Зорчигч', lineLabel: 'Аялал' });
  check('HV-PAX1. Багана tip "сар — Зорчигч: тоо", шугам "сар — Аялал: тоо"',
    hv.barRects[1].tip === '25-02 — Зорчигч: 200' && hv.dotPts[1].tip === '25-02 — Аялал: 20',
    hv.barRects[1].tip + ' | ' + hv.dotPts[1].tip);
  check('HV-PAX2. Дутуу сарын цэг шугамд холбогдохгүй, tip-д "(дутуу сар)"',
    (hv.line.match(/L/g) || []).length === 1 && /дутуу сар/.test(hv.dotPts[2].tip) && /дутуу сар/.test(hv.barRects[2].tip),
    hv.line + ' | ' + hv.dotPts[2].tip);
  const hz = lib.buildDualAxisChart([100, 200], [100, 400], ['a', 'b'], { hv: true, lineZero: true });
  check('HV-PAX3. Шугамын тэнхлэг 0-ээс эхэлнэ (lineZero)', hz.yTicksRight[0].label === '0', hz.yTicksRight.map((t) => t.label).join(','));
  const lab14 = Array.from({ length: 14 }, (_, i) => 'm' + i + (i === 13 ? '*' : ''));
  const h14 = lib.buildDualAxisChart(new Array(14).fill(5), new Array(14).fill(1), lab14, { hv: true });
  check('HV-PAX4. Сүүлийн (дутуу) сар x тэнхлэгт шошготой, давхцаж өмнөхийг орлоно',
    h14.xTicks[h14.xTicks.length - 1].label === 'm13*' && h14.xTicks.every((t) => t.label !== 'm12'),
    h14.xTicks.map((t) => t.label).join(','));
  const hd = lib.buildDualAxisChart([100, 200], [1, 2], ['1-р сар', '2-р сар']);
  check('HV-PAX5. hv-гүй дуудлага (бусад график) хуучин "сар: тоо" хэлбэртэй',
    hd.barRects[0].tip === '1-р сар: 100', hd.barRects[0].tip);
  check('HV-PAX6. Донутын зүсэм бүрт <title>, дэлгэрэнгүйн зорчигчийн трендэд прогноз зурахгүй',
    /<title>\{\{ wd\.tip \}\}<\/title><\/circle>/.test(read('index.html').split('detail.paxDonut')[1] || '') &&
    /buildTrendChart\(dsSec\.c1d,0,dsSec\._partialValue,dsel\.source==='railPax'\)/.test(src));
  check('AX11. ОУ/Дотоодын донут НИСЛЭГИЙН хувиар (kpis[2]) БИШ, \'75%\' fallback-гүй',
    !/sAir\.kpis\[2\]\[2\]\|\|'75%'/.test(src) && /sAir\.paxSplit/.test(src) &&
    /SECTORS\.air\.paxSplit=\{\.\.\.split,typeFiltered/.test(src));
  check('AX12. Өмнөх оны дата алга үед ачааны өсөлт null (0% биш)',
    src.includes('monthCargoYoyArr.push(hasPrev&&pKg>0?pctNum(cur.monthCargoKg[m]||0,pKg):null)'));
  /* Treemap — бүс нутгийн палитр давхардалгүй */
  const pal = (src.match(/const REGION_PAL=\[([\s\S]*?)\];/) || [])[1] || '';
  const cols = pal.match(/#[0-9A-Fa-f]{6}/g) || [];
  check('AX13. Treemap бүс нутгийн өнгө давхцахгүй (' + cols.length + ')',
    cols.length >= 12 && new Set(cols.map((c) => c.toUpperCase())).size === cols.length);
  /* Legend текст content.json-оос */
  const cj = JSON.parse(read('content.json'));
  check('AX14. Legend/донутын шошго content.json → site.chart-д бүртгэлтэй',
    ['year_word', 'legend_pax', 'legend_flights_axis', 'legend_cargo', 'legend_growth_axis', 'intl', 'domestic']
      .every((k) => typeof (cj.site.chart || {})[k] === 'string'));
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
    /chartFromSpec\('ds_air_monthly'\);\s*const airMonthly=paint\(specM\|\|\s*buildDualAxisChart\(mo\.pax/.test(idx.replace(/\n\s*/g, ' ')),
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

  /* ── I8. ИНДЕКСИЙН ШАЛГУУР — ДУГУЙРУУЛСАН ШОШГО НАЙДВАРГҮЙ ──────────
     2026-10-05-нд `main` дээр W5-ийн "i06 — агаарын шугамын индекс
     өөрчлөгдөнө" тест улаан байв: {"before":"114","after":"114"}.
     Шалтгаан нь БҮТЭЭГДЭХҮҮН БИШ — i06-ийн индексийг нислэгийн ТОО-гоос
     зорчигчийн НИЙЛБЭР рүү сольход цуваа ҮНЭХЭЭР өөрчлөгддөг, зүгээр л
     төгсгөлийн шошго нь Math.round-тай учраас 114.37 ба 114.00 хоёулаа
     "114" болж, өөрчлөлтийг НУУЖ байв.

     Бодит feed-ийн тоо өдөр бүр хөдөлдөг тул тэр давхцал нь СААЛЬ —
     өнөөдөр унагаана, маргааш санамсаргүй өнгөрнө. Иймд шалгуурын
     эрүүл эсэхийг ГАРААР БОДОХ БОЛОМЖТОЙ фикстур дээр, сүлжээнээс
     ХАМААРАЛГҮЙГЭЭР барина (CLAUDE.md "Unit тест ЭХЛЭЭД").

     Фикстур (3 сар, нислэг тус бүр нэг мөр):
       1 сар — 50 нислэг · зорчигч нийт 50×20   = 1000
       2 сар — 25 нислэг · зорчигч нийт 25×16   =  400
       3 сар — 57 нислэг · зорчигч нийт 56×20+19 = 1139 */
  const ix = [];
  const addM = (m, n, pax) => { for (let i = 0; i < n; i++) ix.push({ carr: 'A', pax, year: 2026, month: m, day: 1 }); };
  addM(1, 50, 20);
  addM(2, 25, 16);
  addM(3, 56, 20); ix.push({ carr: 'A', pax: 19, year: 2026, month: 3, day: 1 });

  const monthSeries = (spec) => {
    const r = E.agg(ix, Object.assign({ dataset: 'air_flights', dim: 'Сар', topN: 0 }, spec));
    return r && r.n ? r.values : null;
  };
  const cnt3 = monthSeries({ agg: 'COUNT' });
  const pax3 = monthSeries({ measure: 'Зорчигч', agg: 'SUM' });
  check('I8. Фикстурын нислэгийн ТОО гараар бодсонтой таарна (50·25·57)',
    cnt3 && cnt3.join(',') === '50,25,57', JSON.stringify(cnt3));
  check('I8. Фикстурын зорчигчийн НИЙЛБЭР гараар бодсонтой таарна (1000·400·1139)',
    pax3 && pax3.join(',') === '1000,400,1139', JSON.stringify(pax3));

  /* Сайтын агаарын индекс (index.html → trendFor): 1-р сар = 100 */
  const indexOf100 = (s) => { const b = s[0] || 1; return s.map((v) => v / b * 100); };
  const tCnt = indexOf100(cnt3), tPax = indexOf100(pax3);
  check('I8. Индекс нь сонгосон хэмжигдэхүүнээ ДАГАНА (100·50·114 ↔ 100·40·113.9)',
    tCnt.map((v) => v.toFixed(1)).join(',') === '100.0,50.0,114.0' &&
    tPax.map((v) => v.toFixed(1)).join(',') === '100.0,40.0,113.9',
    JSON.stringify({ cnt: tCnt, pax: tPax }));

  /* ЭНЭ бол саалийн цөм: төгсгөлийн ХОЁР шошго давхцана. */
  const last = (t) => Math.round(t[t.length - 1]);
  check('I8. Дугуйруулсан ТӨГСГӨЛИЙН шошго давхцаж, өөрчлөлтийг НУУНА (114 = 114)',
    last(tCnt) === 114 && last(tPax) === 114,
    JSON.stringify({ cnt: last(tCnt), pax: last(tPax) }));
  check('I8. Харин ЦУВАА (шугамын зам) нь ялгаатай — найдвартай шалгуур',
    tCnt.map((v) => v.toFixed(1)).join(',') !== tPax.map((v) => v.toFixed(1)).join(','),
    'цуваа давхцав');

  /* (3)-ын үндэслэл БОДИТ кодод хүчинтэй эсэх — хоёулаа index.html-д
     байхаа болиод ирвэл дээрх фикстур юу ч барихаа болино. */
  check('I8. Сайт агаарын индексийг 1-р сараар хэвийшүүлдэг (src[0] суурь)',
    /const b=src\[0\]\|\|1; return src\.slice\(0,months\)\.map\(v=>v\/b\*100\)/.test(idx),
    'хэвийшүүлэх мөр олдсонгүй');
  check('I8. Төгсгөлийн шошго Math.round-той (иймд шошгоор харьцуулж БОЛОХГҮЙ)',
    idx.includes('endLabel:Math.round(t[li])'), 'endLabel мөр олдсонгүй');

  /* Регресс: W5 шалгуур дугуйруулсан шошго руу БУЦАЖ болохгүй. */
  const selfSrc = read('tests/run.js');
  check('I8. W5-ийн i06 шалгуур ЗАМААР харьцуулна (шошгоор БИШ)',
    /i06Path && r1\.i06Path !== r0\.i06Path/.test(selfSrc) &&
    !/r1\.i06End !== r0\.i06End/.test(selfSrc),
    'W5 шалгуур шошго руу буцсан байна');
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
  /* Тохиргоог СЕРВЕРИЙН санах ойд өгнө — репогийн файл руу бичихгүй.
     2026-10-16: өмнө нь файл руу бичээд finally-д сэргээдэг байв; процесс
     дундаа зогсоход (сешн зогссон) ls.value файлд үлдэж, O6 "2 виджетэд",
     I5/I6 хуурамчаар унав (+ commit-д орох эрсдэл). J4b үүнийг барина. */
  const regPath = path.join(ROOT, 'metric_registry.json');
  const orig = fs.readFileSync(regPath, 'utf8');
  try {
    const reg = JSON.parse(orig);
    reg.widgets.ls = reg.widgets.ls || {};
    reg.widgets.ls.value = { dataset: 'air_flights', measure: 'Зорчигч', agg: 'SUM' };
    SERVE_OVERRIDE = { '/metric_registry.json': JSON.stringify(reg, null, 2) + '\n' };

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
    SERVE_OVERRIDE = null;
  }
  check('J4b. J4 репогийн metric_registry.json-ийг өөрчлөхгүй (тохиргоо санах ойд)',
    fs.readFileSync(regPath, 'utf8') === orig);
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
  for(let i=0;i<120&&d.querySelector('.pvfeed');i++) await sleep(500);
      d.querySelector('[data-section="sec-05"]').click(); await sleep(600);
      d.querySelector('[data-widget="d05"]').click(); await sleep(1100);
      const rows=()=>[].slice.call(d.querySelectorAll('#pvhost .pvrow'))
        .map(function(r){return r.textContent.trim()});
      const R={};
      R.btnCount=d.querySelectorAll('[data-hide]').length;
      R.before=rows();
      const b=d.querySelector('[data-hide="d05|sectors,water"]');
      R.hasPublicBtn=!!b;
      if(b){ b.click(); await sleep(1000); }
      R.after=rows();
      const b2=d.querySelector('[data-hide="d05|sectors,water"]');
      R.label=b2?b2.textContent.trim():null;
      R.dirty=(d.getElementById('dirtyMsg')||{}).textContent||'';
      return R;
    }`, 90000);
    if (R.__err) { bad('K3. Нуух шалгалт ажиллав', R.__err); return; }
    check('K2. Салбар бүрд нуух товч байна', R.btnCount === 4 && R.hasPublicBtn === true,
      'товч: ' + R.btnCount);
    check('K3. Нуухад preview-ээс ШУУД алга болно',
      R.before.some((x) => /Ус, далай/.test(x)) && !R.after.some((x) => /Ус, далай/.test(x)),
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
  /* Каталогт ЗӨВХӨН сервисээр ирдэг датасэт үлдсэн (2026-09-28: 12→4).
     Босго нь "хоосон биш" — шинэ эх сурвалж холбогдох бүрд өснө. */
  check('L1. Каталог content.json-д бүртгэгдсэн', Array.isArray(ds) && ds.length >= 4,
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
      /* Нөхцөл биелэхийг хүлээнэ (тогтмол хугацаа биш) — ачаалалтай үед тогтворгүй байдлаас сэргийлнэ */
      const waitFor=async(fn,ms)=>{const t=Date.now()+ms;while(Date.now()<t){try{if(fn())return true}catch(e){}await sleep(100)}return false};
      await waitFor(()=>d.querySelector('#dsList .st'),15000);
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
      d.querySelector('[data-tab="metrics"]').click();
      await waitFor(()=>d.getElementById('mNewKey'),5000);
      const k=d.getElementById('mNewKey'), nm=d.getElementById('mNewName');
      const add=d.querySelector('[data-madd]');
      if(!k||!add) return {__err:'метрик нэмэх маягт алга'};
      k.value='qa.test_planned'; if(nm) nm.value='';
      add.click();
      await waitFor(()=>(d.getElementById('toast')||{}).textContent,3000);
      R.toastNoName=(d.getElementById('toast')||{}).textContent||'';
      R.addedNoName=d.querySelectorAll('[data-metric="qa.test_planned"]').length;
      const k2=d.getElementById('mNewKey'), nm2=d.getElementById('mNewName');
      k2.value='qa.test_planned'; nm2.value='QA туршилтын метрик';
      d.querySelector('[data-madd]').click();
      await waitFor(()=>(d.getElementById('toast')||{}).textContent!==R.toastNoName,3000);
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
      /* Тоог кодод хатуу бичихгүй — каталогийн БОДИТ уртаас (шинэ датасэт
         нэмэхэд тест утгаа алдахгүй, "бодит тоо" гэдэг шалгуур хүчинтэй). */
      !/тооцоологдоно\s*датасет/i.test(R.ukText) &&
      new RegExp('\\b' + readJson('content.json').site.datasets.length + '\\b\\s*датасет').test(R.ukText),
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
  /* Төгсгөлийн шошго нь Math.round-той тул МЕТРИК солигдсоныг найдвартай
     илрүүлэхгүй (114.4 ба 114.0 хоёулаа "114"). Шугамын ЗАМ нь индексийн
     12 цэг бүрийг агуулна — метрик солигдмогц өөрчлөгдөнө. */
  const airLine=i6?[...i6.querySelectorAll('svg path')].find(x=>x.getAttribute('stroke')==='#2FE0C4'):null;
  R.i06Path=airLine?airLine.getAttribute('d'):null;
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
    idx.includes('const t=trendI06(k,airR06),a=t[0],b=t[lastOf(t)];'));
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
      !!r0.k04Value && !!r0.i06End && !!r0.i06Path && !!r0.r06Ch, JSON.stringify(r0));
    check('W5. k04 — тоо өөрчлөгдөж, нэгж "хүн", шошго ЗОРЧИГЧ',
      r1.k04Value !== r0.k04Value && r1.k04Unit === 'хүн' && /ЗОРЧИГЧ/i.test(r1.k04Label || ''),
      JSON.stringify({ before: [r0.k04Value, r0.k04Unit, r0.k04Label], after: [r1.k04Value, r1.k04Unit, r1.k04Label] }));
    /* ЗАМААР шалгана, төгсгөлийн ШОШГООР биш. Шошго нь Math.round-той тул
       хоёр хэмжигдэхүүний өсөлтийн харьцаа ойролцоо гарвал (бодит feed дээр
       нислэгийн тоо +14.4%, зорчигчийн нийлбэр +14.0% — хоёулаа "114")
       өөрчлөлтийг нуудаг. 2026-10-05-нд яг энэ шалтгаанаар main дээр улаан
       байсан: шугам өөрчлөгдсөн атал тест "өөрчлөгдөөгүй" гэж уншиж байв. */
    check('W5. i06 — агаарын шугам сонгосон хэмжигдэхүүнээ дагана',
      !!r1.i06Path && r1.i06Path !== r0.i06Path,
      JSON.stringify({ before: (r0.i06Path || '').slice(0, 60), after: (r1.i06Path || '').slice(0, 60),
        endLabel: [r0.i06End, r1.i06End] }));
    check('W5. r06 — агаарын өсөлтийн хувь өөрчлөгдөнө',
      r1.r06Ch !== r0.r06Ch, JSON.stringify({ before: [r0.r06Ch, r0.r06SE], after: [r1.r06Ch, r1.r06SE] }));
    check('W5. Зөвхөн i06-г солиход r06 ХӨНДӨГДӨХГҮЙ (тусдаа тохиргоо)',
      r2.i06Path === r1.i06Path && r2.r06Ch === r0.r06Ch && r2.k04Value === r0.k04Value,
      JSON.stringify({ i06same: r2.i06Path === r1.i06Path, r06: r2.r06Ch, k04: r2.k04Value }));
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
    /* Тоо нь каталогийн БОДИТ уртаас тооцоологддог тул тестэд ч хатуу
       бичихгүй — шинэ датасэт нэмэхэд шалгуур утгаа алдахгүй. */
    const cat4 = readJson('content.json').site;
    check('X4. Бодит тоо хэвээр (' + cat4.datasets.length + ' датасет, ' + cat4.services.length + ' үйлчилгээ)',
      (byLb['НЭЭЛТТЭЙ ӨГӨГДӨЛ'] || {}).value === String(cat4.datasets.length) &&
      (byLb['ЦАХИМ ҮЙЛЧИЛГЭЭ'] || {}).value === String(cat4.services.length),
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
  /* Хуудас зурагдахыг хүлээнэ; гүйлгэлт тогтох жижиг хугацааг л үлдээнэ
     (scrollY-г нөхцөлөөр хүлээвэл шалгалт өөрөө хуурамч болно) */
  for(let i=0;i<150&&!(d.getElementById('sec-06')&&d.getElementById('hero'));i++) await sleep(100);
  await sleep(600);
  const ids=['hero','portal-kpi','sec-01','sec-02','sec-04','sec-05','sec-06','sec-07','sec-08'];
  const e=d.getElementById('sec-06');
  return { exists:ids.filter(i=>!!d.getElementById(i)),
    hash:w.location.hash, scrollY:Math.round(w.scrollY),
    top:e?Math.round(e.getBoundingClientRect().top):null };
}`;

/* Y7/Y8 — хуудас бүр хаягтай, Back сайт дотор, "буцах" өөр рүүгээ заахгүй */
const PROBE_Y_ROUTE = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const waitFor=async(fn,ms)=>{const t=Date.now()+ms;while(Date.now()<t){try{if(fn())return true}catch(e){}await sleep(100)}return false};
  await waitFor(()=>[...d.querySelectorAll('button,a')].some(x=>x.textContent.trim()==='Коммунити'),15000);
  const go=async(n)=>{const b=[...d.querySelectorAll('button,a')].filter(x=>x.textContent.trim()===n)[0];
    if(b){const h=w.location.hash; b.click(); await waitFor(()=>w.location.hash!==h,3000)} return !!b};
  const back=()=>{const b=[...d.querySelectorAll('button,a')].filter(x=>/руу буцах/.test(x.textContent))[0];
    return b?b.textContent.trim():null};
  const R={start:w.location.hash};
  await go('Коммунити');
  R.c1={hash:w.location.hash, back:back()};
  await go('Коммунити');
  R.c2={hash:w.location.hash, back:back()};
  await go('Салбарын түүх');
  R.h={hash:w.location.hash, back:back()};
  const hBeforeBack=w.location.hash;
  w.history.back(); await waitFor(()=>w.location.hash!==hBeforeBack,5000);
  R.afterBack={hash:w.location.hash,
    onCommunity:d.body.innerText.indexOf('Төр, иргэнийг холбосон')>=0};
  /* Hero-гийн хайлт ч хаягаа шинэчилнэ */
  await go('Нүүр');
  const inp=[...d.querySelectorAll('input[type=\\"text\\"]')][0];
  if(inp){ inp.value='нислэг'; inp.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(300);
    const sb=[...d.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Хайх')[0];
    if(sb){ const h=w.location.hash; sb.click(); await waitFor(()=>w.location.hash!==h,3000) } }
  R.search={hash:w.location.hash};
  return R;
}`;


/* Y9 — датасэтийн дэлгэрэнгүй: жагсаалтаас нээхэд хаяг, Back */
const PROBE_Y_DS_OPEN = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  /* Нөхцөл биелэхийг хүлээнэ (тогтмол хугацаа биш) — ачаалалтай үед тогтворгүй байдлаас сэргийлнэ */
  const waitFor=async(fn,ms)=>{const t=Date.now()+ms;while(Date.now()<t){try{if(fn())return true}catch(e){}await sleep(100)}return false};
  const cardList=()=>[...d.querySelectorAll('button')].filter(b=>b.innerText.length>60&&/Дэлгэрэнгүй|Үзэх/.test(b.innerText));
  await waitFor(()=>[...d.querySelectorAll('button,a')].some(x=>x.textContent.trim()==='Нээлттэй өгөгдөл'),15000);
  const go=async(n)=>{const b=[...d.querySelectorAll('button,a')].filter(x=>x.textContent.trim()===n)[0];
    if(b){b.click()} return !!b};
  await go('Нээлттэй өгөгдөл');
  /* ХОЁР дахь картыг нээнэ — эхнийх нь анхдагч dsIndex:0-тэй санамсаргүй
     таарч, тест хуурамчаар давах эрсдэлтэй. Карт бүрэн зурагдахыг хүлээнэ. */
  await waitFor(()=>cardList().length>=2,15000);
  const cards=cardList();
  const card=cards[1];
  if(!card) return {__err:'датасэтийн карт олдсонгүй ('+cards.length+')'};
  const name=(card.innerText.split('\\n').filter(x=>x.trim().length>6)[0]||'').trim();
  const hash0=w.location.hash;
  card.click();
  await waitFor(()=>w.location.hash!==hash0,10000);
  await waitFor(()=>((d.querySelector('h1,h2')||{}).innerText||'').trim().length>0,10000);
  const R={name:name, hash:decodeURIComponent(w.location.hash),
    head:((d.querySelector('h1,h2')||{}).innerText||'').trim()};
  const hashOpen=w.location.hash;
  w.history.back();
  await waitFor(()=>w.location.hash!==hashOpen,10000);
  R.back={hash:w.location.hash};
  const hashBack=w.location.hash;
  w.history.forward();
  await waitFor(()=>w.location.hash!==hashBack,10000);
  await waitFor(()=>((d.querySelector('h1,h2')||{}).innerText||'').trim().length>0,10000);
  R.fwd={hash:decodeURIComponent(w.location.hash),
    head:((d.querySelector('h1,h2')||{}).innerText||'').trim()};
  return R;
}`;

/* Y9 — хаягаар ШУУД орох (хуваалцсан холбоос / F5) */
const PROBE_Y_DS_DIRECT = `async function(d,w){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  /* Дэлгэрэнгүйн толгой гарч ирэхийг хүлээнэ (тогтмол хугацаа биш) */
  for(let i=0;i<150&&!((d.querySelector('h1,h2')||{}).innerText||'').trim();i++) await sleep(100);
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
  /* Toast харагдсаны дараа каталог руу шилжиж, каталог зурагдахыг хүлээнэ
     (тогтмол 800 мс биш — ачаалалтай үед redirect-ээс түрүүлж уншигддаг байв).
     Хугацаа дуусвал одоогийн төлөвийг буцаана → шалгалт ҮНЭНЭЭР унана. */
  for(let i=0;i<100;i++){
    if(w.location.hash==='#/browse'&&d.querySelector('input[placeholder=\\"Датасэт хайх…\\"]')) break;
    await sleep(100);
  }
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
      check('Y7. Hero-гийн хайлт ч хаягаа шинэчилнэ (#/browse эсвэл #/browse/<датасэт>)',
        N.search && /^#\/browse(\/|$)/.test(N.search.hash), JSON.stringify(N.search));
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
      /* UI стандарт: эх сурвалжгүй үед 4 том "—" нүд ЗУРАХГҮЙ (хэрэглэгч "аймшигтай
         муухай" гэж тэмдэглэсэн) — утгын нүд огт байхгүй, нэг мөр тайлбар үлдэнэ.
         Утга гарвал заавал "—" (зохиомол тоо хориотой) хэвээр. */
      check('Z9. Эх сурвалжгүй → утгын нүд зурагдахгүй (зохиомол тоо алга)',
        D.vals.length === 0 || D.vals.every((v) => v === '—'), JSON.stringify(D.vals));
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
  /* 2026-09-23: road нь техникийн хяналтын үзлэгээр холбогдсон тул
     эх сурвалжгүй нь 1 мөр (water) үлдэв («Нийтийн тээвэр» 2026-10-21 хасагдсан). */
  check('BE11. u07-ийн эх сурвалжгүй мөр "мэдээлэл алга" шошготой',
    ['water'].every(k => sl('u07', k).metric === null && sl('u07', k).label && sl('u07', k).would_need));
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
    ['air', 'rail', 'road', 'water'].every(k => fixed['u07.' + k] === 'огноо'));

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
    'ds_schema_rail_wagon.head.4': 'Нетто (вагон)', 'ds_schema_rail_wagon.head.5': 'Ачилтын эзлэх %',
    'ds_schema_rail_wagon.head.6': 'Төлөв',
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
    recN === con14.site.updates.length && recN === 4, recN + ' vs ' + con14.site.updates.length);
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
    /function loadRailWagon\(\)/.test(adm) && adm.includes('Promise.all([loadFeed(),loadRailWagon(),loadRoadInspections(),loadSectorSeries(),loadSectorTotalWeekly()])'));
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
  check('BE18. Мөр = [станц, код, ачсан, буулгасан, нетто, эзлэх %, төлөв]',
    JSON.stringify(bw.rows[0]) === JSON.stringify(['Ерөө', '32', 100, 10, 90, 50, 'ok:Ачилттай']), JSON.stringify(bw.rows[0]));
  check('BE18. Ачилтгүй станц warn: шошготой (0-г ЗОХИОЖ ok болгохгүй)',
    bw.rows[3][6] === 'warn:Зөвхөн буулгалт' && bw.rows[3][2] === 0 && bw.rows[3][4] === -25, JSON.stringify(bw.rows[3]));
  check('BE18. Эзлэх % нийлбэр = 100 (нийт ачилт 200: 50+30+20+0)',
    bw.rows.reduce((t, r) => t + r[5], 0) === 100 && bw.rows[1][5] === 30, JSON.stringify(bw.rows.map(r => r[5])));
  check('BE18. Баганын нэр content.json-оос (stxt) — 7 багана',
    bw.head.length === 7 && bw.head[0] === 'Станц' && bw.head[2] === 'Ачсан (вагон)' && bw.head[4] === 'Нетто (вагон)',
    JSON.stringify(bw.head));
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

  /* ── CH. Графикийн тэнхлэг — бүхэл алхам, шошгын нягтрал, дутуу сар ──
     46 сар, хамгийн их багана 37,000 → алхам 10,000 (9,250 биш). */
  const CH = dcScript().match(/function buildDualAxisChart\(barSeries,lineSeries,labels,opts\)\{([\s\S]*?)\n\}/);
  if (!CH) { bad('CH0. buildDualAxisChart() олдсонгүй'); }
  else {
    /* opts (заавал биш) — өмнөх оны багана / өсөлтийн % (агаарын график).
       Энд огт өгөхгүй: CH1–CH3 нь дутуу сарын дүрмийг л шалгана. */
    /* Тэнхлэгийн туслах функцүүд (niceStep/niceAxis/fmtAxisNum) нь гадна
       байдаг тул хамт бүтээнэ. */
    const helpers = ['niceStep', 'niceAxis', 'fmtAxisNum'].map((nm) => {
      const h = dcScript().match(new RegExp('function ' + nm + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'));
      return h ? h[0] : '';
    }).join('\n');
    const bdc = new Function('barSeries', 'lineSeries', 'labels', 'opts',
      helpers + '\nreturn (function(barSeries,lineSeries,labels,opts){' + CH[1] + '\n})(barSeries,lineSeries,labels,opts);');
    const labs = Array.from({ length: 46 }, (_, i) => 'L' + i); labs[45] = 'L45*';
    const bars = Array.from({ length: 46 }, (_, i) => (i === 45 ? 37000 : i * 800));
    const c = bdc(bars, bars.map(v => v / 2), labs, {});
    check('CH1. Зүүн тэнхлэг бүхэл алхам: 0…40,000 (9,250-ийн алхам БИШ)',
      c.yTicksLeft.map(t => t.label).join('|') === '0|10,000|20,000|30,000|40,000', c.yTicksLeft.map(t => t.label).join('|'));
    check('CH2. 46 сарын шошго 3 сар тутам (16), давхцахгүй', c.xTicks.length === 16, String(c.xTicks.length));
    check('CH3. Дутуу сар ("*") бүдэг (op .14), бүтэн сар .35',
      c.barRects[45].op === '.14' && c.barRects[0].op === '.35', JSON.stringify([c.barRects[45].op, c.barRects[0].op]));
  }

  /* ── WA. Вагоны анализын загвар — ГАРААР бодогдох фикстур ──
     2025-08 100/80 (дотоод 40) · 2025-09 200/150 (100) · 2026-08 150/90 (60)
     · 2026-09 50/40 (20, ДУТУУ сар, 10 өдөр). Нийт: ачсан 500, буулгасан 360,
     дотоод 220 (44%), харьцаа 500/360, өдөр 102 (31+30+31+10). */
  const YOC = (() => { const m = dcScript().match(/\nfunction yoyCompare\(months,yr,mFrom,mTo,key\)\{([\s\S]*?)\n\}/); return m ? new Function('months', 'yr', 'mFrom', 'mTo', 'key', m[1]) : null; })();
  const wam = dcScript().match(/function wagonAnalysisModel\(all,sel,year,mr\)\{([\s\S]*?)\n\}/);
  if (!wam) { bad('WA0. wagonAnalysisModel() олдсонгүй'); }
  else {
    const WA = new Function('yoyCompare', 'all', 'sel', 'year', 'mr', wam[1]).bind(null, YOC);
    const mo = (month, loaded, unloaded, dom, days, partial) => ({ month, loaded, unloaded,
      loaded_domestic: dom, loaded_foreign: loaded - dom, days, complete_days: days, partial });
    const ALL = { status: 'ok', months: [
      mo('2025-08', 100, 80, 40, 31, false), mo('2025-09', 200, 150, 100, 30, false),
      mo('2026-08', 150, 90, 60, 31, false), mo('2026-09', 50, 40, 20, 10, true)],
      by_station: [{ station: 'B', code: '2', loaded: 200, unloaded: 160 }, { station: 'A', code: '1', loaded: 300, unloaded: 200 }],
      by_wagon_type: [{ type: 'covered', loaded: 300, unloaded: 200 }, { type: 'tank', loaded: 200, unloaded: 160 },
        { type: 'reefer', loaded: 0, unloaded: 0 }] };
    const a = WA(ALL, null, 'all', null);
    check('WA1. Нийт ачсан 500, буулгасан 360', a.hasData && a.loaded === 500 && a.unloaded === 360, JSON.stringify(a.loaded));
    check('WA1. Дотоод 220 → 44%, гадаад 56%', a.dom === 220 && Math.abs(a.domPct - 44) < 1e-9 && Math.abs(a.frnPct - 56) < 1e-9);
    check('WA1. Харьцаа 500/360, өдрийн дундаж 500/102',
      Math.abs(a.ratio - 500 / 360) < 1e-9 && a.days === 102 && Math.abs(a.perDay - 500 / 102) < 1e-9);
    /* Сарын хүрээ (нэгдсэн шүүлт): 1–12 биш бол задаргаа ХААГДСАН, сар л шүүгдэнэ.
       Гараар бодов: 2025-09 (200/150) + 2026-09 (50/40, дутуу) → ачсан 250, буулгасан 190. */
    const a9 = WA(ALL, null, 'all', { from: 9, to: 9 });
    check('WA-M1. Сар 9: 2 сарын мэдээ, ачсан 250 · буулгасан 190 (ГААРАР бодов)',
      a9.hasData && a9.monthCount === 2 && a9.loaded === 250 && a9.unloaded === 190, JSON.stringify([a9.monthCount, a9.loaded, a9.unloaded]));
    check('WA-M2. Сарын хүрээ 9–9 → станц/төрөл ХАРУУЛАХГҮЙ (бүтэн жил биш)',
      a9.monthFull === false && a9.hasBreakdown === false && a9.stations.length === 0 && a9.types.length === 0);
    const aFull = WA(ALL, null, 'all', { from: 1, to: 12 });
    check('WA-M3. 1–12 сар = өмнөх үр дүн (станц, төрөл хэвээр)',
      aFull.monthFull === true && aFull.hasBreakdown === true && aFull.loaded === 500 && aFull.stations.length === 2);
    const a26 = WA(ALL, { by_station: [], by_wagon_type: [] }, 2026, { from: 8, to: 8 });
    check('WA-M4. 2026 + 8-р сар → ачсан 150 · YoY +50.0% (2025-08 = 100)',
      a26.loaded === 150 && a26.yoy && Math.abs(a26.yoy.pct - 50) < 1e-9, JSON.stringify([a26.loaded, a26.yoy]));
    check('WA2. Дутуу сар 1 тоологдоно, шошго "*"-тай',
      a.partialN === 1 && a.series.labels.join(',') === '25-08,25-09,26-08,26-09*');
    /* Регресс (2026-10-18): «Бүгд» дээр «Өмнөх оноос» "—" (жил сонгож харьцуулна) гардаг байв —
       хоёр оны дата бүрэн байхад. Одоо СҮҮЛИЙН он (2026) vs 2025, хоёуланд бүтэн сар л:
       2026-08 150 vs 2025-08 100 → +50% (2026-09 дутуу тул ороогүй, 2025-09-д хос алга). */
    check('WA2. Жилүүд [2025,2026]; "Бүгд" дээр YoY = 2026 vs 2025, +50% (1 бүтэн сар)',
      a.years.join(',') === '2025,2026' && !!a.yoy && Math.abs(a.yoy.pct - 50) < 1e-9 && a.yoy.months === 1 &&
      a.yoy.year === 2026 && a.yoy.prevYear === 2025 && a.yoyReason === 'ok', JSON.stringify(a.yoy));
    check('WA3. Станц ачилтаар буурахаар эрэмбэлэгдэнэ (A, B)',
      a.stations.map(s => s.station).join(',') === 'A,B' && a.stationTotal === 500);
    check('WA3. Тэг төрөл (reefer) харагдахгүй, 2 төрөл',
      a.types.length === 2 && a.types[0].type === 'covered' && a.typeTotal === 500);
    const SEL26 = { status: 'ok', months: [], by_station: [{ station: 'A', code: '1', loaded: 150, unloaded: 90 }],
      by_wagon_type: [{ type: 'covered', loaded: 150, unloaded: 90 }] };
    const y = WA(ALL, SEL26, 2026);
    check('WA4. 2026: ачсан 200, буулгасан 130', y.loaded === 200 && y.unloaded === 130 && y.monthCount === 2);
    check('WA4. YoY: ЗӨВХӨН хоёр оны бүтэн сар (08): (150-100)/100 = +50%, 1 сар',
      !!y.yoy && Math.abs(y.yoy.pct - 50) < 1e-9 && y.yoy.months === 1, JSON.stringify(y.yoy));
    check('WA4. Станц/төрөл нь сонгосон оны хариунаас (sel)',
      y.hasBreakdown && y.stations.length === 1 && y.stations[0].loaded === 150);
    const yn = WA(ALL, null, 2026);
    check('WA5. Оны задаргаа ирээгүй бол ХУУЧИН бүтэн түүхийн станцыг харуулахгүй',
      !yn.hasBreakdown && yn.stations.length === 0 && yn.types.length === 0);
    check('WA6. null / no_data / хоосон months → hasData:false (тоо зохиохгүй)',
      WA(null, null, 'all').hasData === false && WA({ status: 'no_data', months: [] }, null, 'all').hasData === false &&
      WA({ status: 'ok', months: [] }, null, 'all').hasData === false);
    check('WA6. Түүхэд байхгүй он → hasData:false', WA(ALL, null, 2030).hasData === false);
    /* WA10. Эхний жил (2025) → өмнөх 2024 он түүхэнд алга: "no_prev_year" + түүхийн
       эхлэл 2025-08 (зорчигчийн PA5/PA15-тай ижил гэрээ). */
    const y25 = WA(ALL, null, 2025);
    check('WA10. Эхний жил → yoyReason "no_prev_year", prevYear 2024, historyFrom 2025-08',
      y25.yoy === null && y25.yoyReason === 'no_prev_year' && y25.prevYear === 2024 && y25.historyFrom === '2025-08',
      JSON.stringify([y25.yoyReason, y25.prevYear, y25.historyFrom]));
    /* WA9. Бодит өгөгдөл (2026-10): сар бүрд complete_days < days, backend
       partial:true — гэхдээ календарийн ≥90% өдөртэй сар ДУТУУ БИШ.
       Өмнө нь 46/46 сар "*"-тай, YoY үргэлж null байв. */
    const real = (month, days, complete, loaded) => ({ month, days, complete_days: complete, partial: true,
      loaded, unloaded: loaded, loaded_domestic: 0, loaded_foreign: loaded });
    const R = WA({ status: 'ok', by_station: [], by_wagon_type: [], months: [
      real('2025-08', 31, 27, 100), real('2025-02', 25, 24, 90),   // 25/28=89% → дутуу
      real('2026-08', 31, 26, 120), real('2026-02', 28, 26, 90),   // 100% → бүтэн
      real('2025-12', 13, 7, 50),                                  // 13/31 → дутуу
      real('2026-10', 10, 9, 40)] }, null, 'all');   // 10/31 → дутуу
    check('WA9. complete_days<days ч ≥90% өдөртэй сар дутуу БИШ; зөвхөн 3 сар дутуу',
      R.partialN === 3 && R.series.labels.filter(l => l.endsWith('*')).length === 3, R.series.labels.join(','));
    const R26 = WA({ status: 'ok', by_station: [], by_wagon_type: [], months: [
      real('2025-08', 31, 27, 100), real('2026-08', 31, 26, 120)] }, null, 2026);
    check('WA9. Backend partial:true боловч бүрэн хамрагдсан сар YoY-д ОРНО (+20%)',
      !!R26.yoy && Math.abs(R26.yoy.pct - 20) < 1e-9, JSON.stringify(R26.yoy));
    check('WA9. 28/31 = 90.3% → бүтэн, 27/31 = 87% → дутуу',
      WA({ status: 'ok', by_station: [], by_wagon_type: [], months: [real('2026-07', 28, 28, 1)] }, null, 'all').partialN === 0 &&
      WA({ status: 'ok', by_station: [], by_wagon_type: [], months: [real('2026-07', 27, 27, 1)] }, null, 'all').partialN === 1);
    check('WA6. Буулгасан 0 бол харьцаа null (хуваалтын алдаа/Infinity БИШ)',
      WA({ status: 'ok', months: [mo('2026-01', 10, 0, 5, 31, false)], by_station: [], by_wagon_type: [] }, null, 'all').ratio === null);

    /* Текстийн гэрээ: самбарын T('...') түлхүүр бүр content.json → site.wagon_an-д
       бүртгэлтэй (эс тэгвэл text-coverage F1 унана / админд харагдахгүй). */
    const bw = dcScript().match(/buildWagonAnalysis\(\)\{([\s\S]*?)\n  \}\n  \/\* Зорчигчийн датасэтийн анализын самбар/);
    const WAC = (readJson('content.json').site || {}).wagon_an || {};
    const keys = bw ? [...bw[1].matchAll(/T\('([a-z_.]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('.')) : [];
    const miss = keys.filter(k => k.split('.').reduce((o, p) => (o == null ? o : o[p]), WAC) == null);
    check('WA7. buildWagonAnalysis-ийн текст бүр content.json site.wagon_an-д', keys.length > 20 && miss.length === 0, miss.join(','));
    check('WA7. Вагоны 6 төрлийн шошго бүртгэлтэй',
      ['covered', 'platform', 'half', 'tank', 'reefer', 'other'].every(k => WAC.types && WAC.types[k]));
    check('WA8. Сайт түүхийг EHBackend.fetchRailWagonHistory-аар авна, endpoint замтай таарна',
      dcScript().includes('EHBackend.fetchRailWagonHistory') &&
      read('js/erthub-backend.js').includes("/api/sectors/rail/wagon-loading/history") &&
      /window\.EHBackend\s*=\s*\{[\s\S]*?fetchRailWagonHistory:\s*fetchRailWagonHistory/.test(read('js/erthub-backend.js')));
    check('WA8. Түүх ачаалахад унавал вагоны өдрийн мэдээг ХӨНДӨХГҮЙ (тусдаа try)',
      /this\.applyRailWagonData\(\);\s*this\.loadWagonHistory\(\);/.test(dcScript()) &&
      /async loadWagonHistory\(\)\{[\s\S]*?try\{[\s\S]*?catch\(e\)/.test(dcScript()));
  }

  /* ── PA. Зорчигчийн анализын загвар — ГАРААР бодогдох фикстур ──
     2025-09 30/30 өдөр: 100 зорчигч (ОН 90 / ОУ 10), 20 аялал
     2026-09 30/30 өдөр: 120 (ОН 100 / ОУ 20), 25 аялал
     2026-10 10/31 өдөр (ДУТУУ): 30 (ОН 30 / ОУ 0), 8 аялал. Нийт 250/53. */
  const pam = dcScript().match(/function paxAnalysisModel\(all,sel,year,mr\)\{([\s\S]*?)\n\}/);
  if (!pam) { bad('PA0. paxAnalysisModel() олдсонгүй'); }
  else {
    /* paxAnalysisModel нь paxSeriesWithGaps-ийг дууддаг — хамт задалж дамжуулна */
    const psg = dcScript().match(/\nfunction paxSeriesWithGaps\(ms,fullRange\)\{([\s\S]*?)\n\}/);
    const PSG = new Function('ms', 'fullRange', psg ? psg[1] : 'throw new Error("paxSeriesWithGaps алга")');
    const YOC2 = (() => { const m = dcScript().match(/\nfunction yoyCompare\(months,yr,mFrom,mTo,key\)\{([\s\S]*?)\n\}/); return m ? new Function('months', 'yr', 'mFrom', 'mTo', 'key', m[1]) : null; })();
    const PA = (all, sel, year, mr) => new Function('paxSeriesWithGaps', 'yoyCompare', 'all', 'sel', 'year', 'mr', pam[1])(PSG, YOC2, all, sel, year, mr);
    const pm = (month, days, dim, trips, passengers, domestic, international) =>
      ({ month, days, days_in_month: dim, trips, passengers, domestic, international });
    const PALL = { status: 'ok', months: [pm('2025-09', 30, 30, 20, 100, 90, 10), pm('2026-09', 30, 30, 25, 120, 100, 20),
      pm('2026-10', 10, 31, 8, 30, 30, 0)],
      by_route: [{ route: 'Б', trips: 20, passengers: 100 }, { route: 'А', trips: 33, passengers: 150 }],
      by_type: [{ type: 'ОН', trips: 40, passengers: 220 }, { type: 'ОУ', trips: 13, passengers: 30 }] };
    const p = PA(PALL, null, 'all');
    check('PA1. Нийт зорчигч 250, аялал 53, ОУ 30 → 12%', p.hasData && p.pax === 250 && p.trips === 53 &&
      Math.abs(p.intlPct - 12) < 1e-9 && Math.abs(p.domPct - 88) < 1e-9, JSON.stringify([p.pax, p.trips, p.intlPct]));
    check('PA1. Аялал бүрийн дундаж 250/53, өдрийн дундаж 250/70',
      Math.abs(p.perTrip - 250 / 53) < 1e-9 && p.days === 70 && Math.abs(p.perDay - 250 / 70) < 1e-9);
    check('PA2. 10/31 өдөр → дутуу (1), шошго "*"; бусад бүтэн',
      p.partialN === 1 && p.series.labels.filter((_, i) => !p.series.gap[i]).join(',') === '25-09,26-09,26-10*');
    /* PA16. Дунд нь өгөгдөлгүй сар → хоосон слот (2026-10-16 ковидын кэйс: 2020-12…2021-07
       8 сар алга атал тэнхлэг "20-11* → 21-08*" гэж шууд үсэрч, шугам залгагдаж байв).
       Фикстур: 2025-09 → 2026-09 хооронд 2025-10…2026-08 = 11 сар алга. */
    check('PA16. Бүтэн хүрээнд дунд нь алга 11 сар слот болно (25-10 … 26-08), утга null',
      p.series.gap.filter(Boolean).length === 11 && p.series.labels[1] === '25-10' && p.series.labels[11] === '26-08' &&
      p.series.dom[1] === null && p.series.trips[11] === null && p.series.labels.length === 14,
      JSON.stringify(p.series.labels));
    {
      const r9 = PA(PALL, null, 'all', { from: 9, to: 9 });
      check('PA16. Сарын хүрээний шүүлттэй үед (9–9) завсар ЗОРИУД — слот оруулахгүй',
        r9.series.gap.every(g => !g) && r9.series.labels.join(',') === '25-09,26-09', JSON.stringify(r9.series.labels));
      const Cg = (dcScript().match(/function buildPaxStackedChart\(domSeries,intlSeries,tripSeries,labels,gaps\)\{([\s\S]*?)\n\}/) || [, ''])[1];
      const g = Cg ? (new Function('domSeries', 'intlSeries', 'tripSeries', 'labels', 'gaps', Cg))(
        [70, null, 100], [10, null, 0], [15, null, 25], ['a', 'b', 'c'], [false, true, false]) : {};
      const gapBar = (g.barRects || []).filter(b => /мэдээлэл алга/.test(b.tip));
      check('PA16. График: слот = 1 бүдэг тууз "b — мэдээлэл алга", 0 өндрийн багана ЗУРАХГҮЙ',
        gapBar.length === 1 && gapBar[0].tip === 'b — мэдээлэл алга' &&
        !(g.barRects || []).some(b => /^b — ОН/.test(b.tip)), JSON.stringify((g.barRects || []).map(b => b.tip)));
      check('PA16. Аяллын шугам слот дээр ТАСАРНА (2 тусдаа "M"), слотод цэг алга',
        (String(g.line).match(/M/g) || []).length === 2 && !/L/.test(g.line) && (g.dotPts || []).length === 2, String(g.line));
    }
    /* Регресс (2026-10-18): «Бүгд» дээр YoY "—" байв. Одоо 2026 vs 2025, хоёуланд бүтэн сар:
       2026-09 120 vs 2025-09 100 → +20% (2026-10 дутуу) — ГАРААР бодов. */
    check('PA2. Бүгд дээр YoY = 2026 vs 2025: +20%, 1 бүтэн сар', !!p.yoy && Math.abs(p.yoy.pct - 20) < 1e-9 &&
      p.yoy.months === 1 && p.yoy.year === 2026 && p.yoyReason === 'ok', JSON.stringify(p.yoy));
    check('PA3. Чиглэл зорчигчоор буурахаар (А, Б), нийлбэр 250',
      p.routes.map(r => r.route).join(',') === 'А,Б' && p.routeTotal === 250);
    check('PA3. Сараар эрэмбэ: 2026-09 (120) тэргүүлнэ, дутуу сар тэмдэглэгдэнэ',
      p.ranked[0].month === '2026-09' && p.ranked[0].passengers === 120 && p.ranked[2].partial === true);
    const q = PA(PALL, { status: 'ok', months: [], by_route: [{ route: 'А', trips: 33, passengers: 150 }], by_type: [] }, 2026);
    check('PA4. 2026: нийт 150; YoY = (120-100)/100 = +20% (зөвхөн 09 сар)',
      q.pax === 150 && !!q.yoy && Math.abs(q.yoy.pct - 20) < 1e-9 && q.yoy.months === 1, JSON.stringify(q.yoy));
    check('PA4. Чиглэл нь сонгосон оны хариунаас (sel)', q.hasBreakdown && q.routes.length === 1 && q.routes[0].passengers === 150);
    const q0 = PA(PALL, null, 2026);
    check('PA5. Оны задаргаа ирээгүй бол бүтэн түүхийн чиглэлийг харуулахгүй', !q0.hasBreakdown && q0.routes.length === 0);
    const only = PA({ status: 'ok', months: [pm('2026-09', 30, 30, 25, 120, 100, 20)], by_route: [], by_type: [] }, null, 2026);
    /* PA5 нь өмнө нь ЭНЭ төлөвийг "none" гэж баталж, картын текст АЛЬ оныг
       хэлж буйг шалгадаггүй байв → 2025 сонгоход "өмнөх оны өгөгдөл алга" гэж
       гарч, хэрэглэгч "2025 дата байхад яагаад алга" гэж уншсан (2026-10-16). */
    check('PA5. Өмнөх он түүхэнд ОГТ алга → YoY null, шалтгаан "no_prev_year", он + түүхийн эхлэл',
      only.yoy === null && only.yoyReason === 'no_prev_year' && only.prevYear === 2025 && only.historyFrom === '2026-09',
      JSON.stringify([only.yoyReason, only.prevYear, only.historyFrom]));
    {
      /* PA15. "none" (өмнөх он БАЙГАА ч бүтэн хос сар алга) ба "no_prev_year"-ийг ялгана.
         2025-09 ДУТУУ (10/30) → 2026-09-тэй хос болохгүй. */
      const half = PA({ status: 'ok', months: [pm('2025-09', 10, 30, 5, 20, 20, 0), pm('2026-09', 30, 30, 25, 120, 100, 20)],
        by_route: [], by_type: [] }, null, 2026);
      check('PA15. Өмнөх он байгаа ч бүтэн хос сар алга → "none" (no_prev_year БИШ)',
        half.yoy === null && half.yoyReason === 'none', half.yoyReason);
      const yrt = dcScript().match(/\nfunction yoyReasonText\(m,T\)\{([\s\S]*?)\n\}/);
      if (!yrt) bad('PA15. yoyReasonText() олдсонгүй');
      else {
        const YRT = new Function('m', 'T', yrt[1]);
        const PAC15 = (readJson('content.json').site || {}).pax_an || {};
        const T15 = (k, fb) => (PAC15[k] != null ? PAC15[k] : fb);
        const txt = YRT(only, T15);
        check('PA15. Картын тайлбар АЛЬ он алгыг (2025) ба түүхийн эхлэлийг (2026-09) нэрлэнэ',
          txt.includes('2025') && txt.includes('2026-09') && !/\{(year|from)\}/.test(txt), txt);
        check('PA15. "none" үед "өмнөх оны өгөгдөл алга" гэж ХУДАЛ хэлэхгүй (бүтэн сар алга гэнэ)',
          !/өмнөх оны өгөгдөл алга/.test(YRT(half, T15)), YRT(half, T15));
        check('PA15. Вагон, зорчигч ХОЁУЛАА нэг helper-ээр (yoyReasonText) — текст хуваагдахгүй',
          /* 2026-10-19: ачаа тээвэр (УБТЗ/МТЗ) ч мөн энэ helper-ээр — 3; 2026-10-20 авто тээврийн зорчигч — 4 */
          (dcScript().match(/:yoyReasonText\(m,T\)\}/g) || []).length === 4);
        const WAC15 = (readJson('content.json').site || {}).wagon_an || {};
        check('PA15. kpi_yoy_no_prev {year}/{from}-тэй pax_an ба wagon_an-д',
          [PAC15, WAC15].every(c => /\{year\}/.test(c.kpi_yoy_no_prev || '') && /\{from\}/.test(c.kpi_yoy_no_prev || '')));
      }
    }
    check('PA6. null / no_data / хоосон / байхгүй он → hasData:false',
      PA(null, null, 'all').hasData === false && PA({ status: 'no_data', months: [] }, null, 'all').hasData === false &&
      PA(PALL, null, 2030).hasData === false);
    check('PA6. Аялал 0 бол дундаж null (хуваалтын алдаа БИШ)',
      PA({ status: 'ok', months: [pm('2026-01', 31, 31, 0, 0, 0, 0)], by_route: [], by_type: [] }, null, 'all').perTrip === null);

    /* PA14. Борлуулалтын суваг — гараар бодсон: kass 100, web 50, sms 30, phone 20,
       tapa 0, kiosk 0 → нийлбэр 200 (web 25%); covered 180 (нийт 250-ийн 72%) */
    const CH = { status: 'ok', months: PALL.months, by_route: [], by_type: [],
      by_channel: [{ channel: 'kass', passengers: 100 }, { channel: 'kiosk', passengers: 0 }, { channel: 'web', passengers: 50 },
        { channel: 'sms', passengers: 30 }, { channel: 'phone', passengers: 20 }, { channel: 'tapa', passengers: 0 }],
      channel_covered: 180 };
    const c = PA(CH, null, 'all');
    check('PA14. Суваг: нийлбэр 200, ачсанаар эрэмбэ (kass, web, sms, phone), hasChannels',
      c.hasChannels && c.channelTotal === 200 && c.channels.map(x => x.channel).slice(0, 4).join(',') === 'kass,web,sms,phone',
      JSON.stringify(c.channels));
    check('PA14. covered 180 дамжина (нийт 250-аас бага → самбар ил хэлнэ)', c.channelCovered === 180 && c.pax === 250);
    check('PA14. by_channel [] / байхгүй → hasChannels:false (тоо ЗОХИОХГҮЙ)',
      PA({ ...CH, by_channel: [] }, null, 'all').hasChannels === false &&
      PA({ status: 'ok', months: PALL.months, by_route: [], by_type: [] }, null, 'all').hasChannels === false);
    check('PA14. Он сонгоход суваг нь sel-ийн хариунаас (бүтэн түүхийнх БИШ)',
      PA(CH, null, 2026).hasChannels === false &&
      PA(CH, { status: 'ok', months: [], by_route: [], by_type: [], by_channel: [{ channel: 'web', passengers: 7 }], channel_covered: 7 }, 2026).channelTotal === 7);
    {
      const PACc = (readJson('content.json').site || {}).pax_an || {};
      check('PA14. 6 суваг бүрийн шошго content.json-д',
        ['kass', 'kiosk', 'web', 'sms', 'phone', 'tapa'].every(k => PACc.channels && PACc.channels[k]));
    }

    const bp = dcScript().match(/buildPaxAnalysis\(\)\{([\s\S]*?)\n  \}\n  (?:buildDocDetail|\/\* Ачаа тээврийн анализын самбар)/);
    const PAC = (readJson('content.json').site || {}).pax_an || {};
    const pkeys = bp ? [...bp[1].matchAll(/T\('([a-z_.]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('.')) : [];
    const pmiss = pkeys.filter(k => k.split('.').reduce((o, x) => (o == null ? o : o[x]), PAC) == null);
    check('PA7. buildPaxAnalysis-ийн текст бүр content.json site.pax_an-д', pkeys.length > 20 && pmiss.length === 0, pmiss.join(','));
    const wk = (readJson('content.json').site.wagon_an || {});
    check('PA7. "Бүгд" үед YoY тайлбар (kpi_yoy_pick) вагонд бүртгэлтэй', !!wk.kpi_yoy_pick);
    check('PA8. Сайт зорчигчийн түүхийг EHBackend-ээр авч, endpoint замтай таарна',
      dcScript().includes('EHBackend.fetchRailPassengersHistory') &&
      /window\.EHBackend\s*=\s*\{[\s\S]*?fetchRailPassengersHistory:\s*fetchRailPassengersHistory/.test(read('js/erthub-backend.js')) &&
      read('js/erthub-backend.js').includes('/api/sectors/rail/passengers/history'));
    check('PA8. Түүх унавал вагоны өдрийн мэдээг хөндөхгүй (тусдаа try, дараалал)',
      /this\.loadWagonHistory\(\);[^\n]*\n\s*this\.loadPaxHistory\(\);/.test(dcScript()) &&
      /async loadPaxHistory\(\)\{[\s\S]*?try\{[\s\S]*?catch\(e\)/.test(dcScript()));
    check('PA8. Самбар зөвхөн railPax датасэтэд, вагонтой холилдохгүй',
      /dsel\.source==='railPax'&&this\.state\.page==='detail'\)\?this\.buildPaxAnalysis/.test(dcScript()));
    /* PA9–PA13: шүүлтийн хүрээ, сар бүрийн MoM/YoY, ОУ%, график (0-ээс эхлэх, өндөр). Гараар бодсон:
       2025-08 80 (70/10, 15 аялал) · 2025-09 100 (90/10, 20) · 2026-08 110 (100/10, 22)
       2026-09 120 (100/20, 25) · 2026-10 30 (30/0, 8; 10/31 дутуу). */
    const pm2 = (month, days, dim, trips, passengers, domestic, international) =>
      ({ month, days, days_in_month: dim, trips, passengers, domestic, international });
    const PALL2 = { status: 'ok', months: [pm2('2026-09', 30, 30, 25, 120, 100, 20), pm2('2025-08', 31, 31, 15, 80, 70, 10),
      pm2('2026-10', 10, 31, 8, 30, 30, 0), pm2('2025-09', 30, 30, 20, 100, 90, 10), pm2('2026-08', 31, 31, 22, 110, 100, 10)],
      by_route: [{ route: 'А', trips: 33, passengers: 150 }, { route: 'Б', trips: 20, passengers: 100 }], by_type: [] };
    const full = PA(PALL2, null, 'all');
    const rowOf = (r, k) => r.rows.find(x => x.month === k);
    check('PA9. Мөр бүр хугацааны дарааллаар (2025-08 → 2026-10), 5 мөр',
      full.rows.length === 5 && full.rows[0].month === '2025-08' && full.rows[4].month === '2026-10');
    check('PA9. MoM: 2026-09 = (120-110)/110 = 9.09%; 2025-09 = (100-80)/80 = 25%',
      Math.abs(rowOf(full, '2026-09').mom - 100 / 11) < 1e-9 && Math.abs(rowOf(full, '2025-09').mom - 25) < 1e-9);
    check('PA9. YoY: 2026-09 = (120-100)/100 = 20%; 2026-08 = (110-80)/80 = 37.5%; өмнөх оноос байхгүй → null',
      Math.abs(rowOf(full, '2026-09').yoy - 20) < 1e-9 && Math.abs(rowOf(full, '2026-08').yoy - 37.5) < 1e-9 &&
      rowOf(full, '2025-09').yoy === null);
    check('PA9. Дутуу сар (2026-10) нь MoM/YoY-д ОРОХГҮЙ (null), шошго "*"',
      rowOf(full, '2026-10').mom === null && rowOf(full, '2026-10').yoy === null && rowOf(full, '2026-10').label === '2026-10 *');
    check('PA9. ОУ% = 20/120 = 16.67%; аяллын дундаж = 120/25 = 4.8',
      Math.abs(rowOf(full, '2026-09').intlPct - 100 / 6) < 1e-9 && Math.abs(rowOf(full, '2026-09').perTrip - 4.8) < 1e-9);
    check('PA9. Тэргүүлэгч чиглэлийн эзлэх хувь = 150/250 = 60%', Math.abs(full.topRouteShare - 60) < 1e-9);
    const mon9 = PA(PALL2, null, 'all', { from: 9, to: 9 });
    check('PA10. Сарын хүрээ 9–9: зөвхөн 9-р сар (2025-09, 2026-09) → нийт 220, fullRange=false',
      mon9.rows.length === 2 && mon9.pax === 220 && mon9.fullRange === false && mon9.rangeFrom === 9);
    const y26 = PA(PALL2, { status: 'ok', months: [], by_route: [{ route: 'А', trips: 33, passengers: 150 }], by_type: [] },
      2026, { from: 8, to: 9 });
    check('PA10. 2026 + 8–9: нийт 230; 2026-08 YoY = 37.5% (өмнөх оны 08 сар бүтэн байх ёстой)',
      y26.pax === 230 && Math.abs(rowOf(y26, '2026-08').yoy - 37.5) < 1e-9 && y26.rows.length === 2);
    check('PA10. Бүтэн хүрээ + бүх жил → чиглэл түүхээс (all); хязгаарлавал → sel (шүүлтэд таарсан татлага)',
      PA(PALL2, null, 'all').routeTotal === 250 && PA(PALL2, { status: 'ok', months: [], by_route: [{ route: 'Х', trips: 1, passengers: 9 }], by_type: [] }, 'all', { from: 9, to: 9 }).routes[0].route === 'Х');
    const W = (y, mr) => (new Function('all', 'year', 'mr', (dcScript().match(/function paxFetchWindow\(all,year,mr\)\{([\s\S]*?)\n\}/) || [, ''])[1]))(PALL2, y, mr);
    check('PA10. paxFetchWindow: бүтэн түүх → null (татах хэрэггүй)', W('all', { from: 1, to: 12 }) === null);
    check('PA10. paxFetchWindow: бүх жил + 9–10 сар → 2025-09-01 … 2026-10-31',
      JSON.stringify(W('all', { from: 9, to: 10 })) === JSON.stringify({ from: '2025-09-01', to: '2026-10-31' }));
    check('PA10. paxFetchWindow: 2026 бүтэн → 2026-01-01 … 2026-12-31; 2026 + 2 сар → 02-01 … 02-28',
      JSON.stringify(W(2026, { from: 1, to: 12 })) === JSON.stringify({ from: '2026-01-01', to: '2026-12-31' }) &&
      JSON.stringify(W(2026, { from: 2, to: 2 })) === JSON.stringify({ from: '2026-02-01', to: '2026-02-28' }));
    const C = (dcScript().match(/function buildPaxStackedChart\(domSeries,intlSeries,tripSeries,labels,gaps\)\{([\s\S]*?)\n\}/) || [, ''])[1];
    const chart = C ? (new Function('domSeries', 'intlSeries', 'tripSeries', 'labels', 'gaps', C))(
      [70, 90, 100, 100, 30], [10, 10, 10, 20, 0], [15, 20, 22, 25, 8], ['a', 'b', 'c', 'd', 'e']) : {};
    check('PA11. Багана: ОН + ОУ (ОУ>0 бүр 2 хэсэг) → 5 + 4 = 9 тэмдэг',
      (chart.barRects || []).length === 9);
    check('PA11. Зүүн тэнхлэг тэгээс эхэлнэ (шошго "0"), баруун тэнхлэг мөн тэгээс',
      chart.yTicksLeft && chart.yTicksLeft[0].label === '0' && chart.yTicksRight[0].label === '0');
    const d3 = chart.barRects ? chart.barRects.filter(b => b.tip.startsWith('d')) : [];
    const hTot = d3.reduce((t, b) => t + parseFloat(b.h), 0);
    check('PA11. Хамгийн өндөр багана (d=120) нийт өндөр = 120/200 × plotH(182) ≈ 109.2',
      Math.abs(hTot - 109.2) < 0.3, String(hTot));
    check('PA11. Тэмдэг бүрт "нэр — утга" tooltip (ОН/ОУ/нийт), шугамд аяллын тоо',
      /ОН: 100 · ОУ: 20 · нийт: 120/.test(d3[0].tip) &&
      chart.dotPts.every(p => /аялал: /.test(p.tip)));
    const tplHtml = read('index.html');
    check('PA12. Самбар: шүүлтийн самбар KPI-ийн ӨМНӨ байрлана (шүүлт → KPI → график)',
      tplHtml.indexOf('detail.paxFilterUi.yearChips') > 0 &&
      tplHtml.indexOf('detail.paxFilterUi.yearChips') < tplHtml.indexOf('detail.paxKpis'));
    const paxTpl = tplHtml.replace(/\s+/g, ' ');
    check('PA12b. Шүүлт "Шүүлт" товчоор нээгдэнэ: самбар paxFilterUi.show-д ороосон, show = pvFilterOpen',
      paxTpl.includes('<sc-if value="{{ detail.paxFilterUi.show }}"> <div data-pax-filter="1"') &&
      tplHtml.includes('show:!!st.pvFilterOpen'));
    check('PA12c. Нэгдсэн стандарт: сарын чип + "Бүгд" + интервалын оролт + setPaxMonths (вагон/үзлэгтэй адил)',
      tplHtml.includes('detail.paxFilterUi.monthChips') && tplHtml.includes('detail.paxFilterUi.monthAllPick') &&
      tplHtml.includes('detail.paxFilterUi.onMFrom') &&
      /setPaxMonths\(from,to\)\{\s*this\.setState\(\{paxMFrom:from,paxMTo:to/.test(tplHtml));
    /* UI стандарт (2026-10-15): тусдаа "Сарын дэлгэрэнгүй" гар хүснэгт (sc-raw-table)
       ба 3 баганатай жагсаалт хоёр ӨӨР стандарттай байсныг НЭГ стандарт хүснэгт
       болгосон — мөрүүд нь paxTableSchema()-аас, анализын шүүлтийг дагана. */
    check('PA12. Сарын мөрүүд стандарт хүснэгтэд: гар хүснэгт (paxRows/sc-raw-table) алга',
      !/detail\.paxRows/.test(tplHtml) && tplHtml.indexOf('<sc-raw-table') < 0);
    check('PA13. railPax хүснэгт paxTableSchema()-аас — history-ийн бүх багана (11)',
      /tableSchema\(dsel,schemaKey\)\{[\s\S]{0,120}?if\(dsel&&dsel\.source==='railPax'\)/.test(tplHtml) &&
      /types:\['month','int','int','int','int','pct','float','int','pctchg','pctchg','enum'\]/.test(tplHtml));
    check('PA9. Хүснэгт анализтай ИЖИЛ эх сурвалж/жилийн шүүлт (syncPaxTable), чип солиход дутуу сарыг оруулна',
      /syncPaxTable\(\)\{[\s\S]*?paxAnalysisModel\([^)]*this\.state\.paxYear[\s\S]*?'warn:'\+T\.stPartial/.test(dcScript()) &&
      /dsel\.source==='railPax'\) this\.syncPaxTable\(\)/.test(dcScript()));
  }

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
    /const baseKey=dsel\.schema\|\|dsel\.sector;/.test(dcScript()) &&
    /* RAW: түүхий мөрийн хүснэгт өөрийн түлхүүртэй (өргөн/шүүлт холилдохгүй) */
    /const schemaKey=sc&&sc\.raw\?baseKey\+'__raw':baseKey;/.test(dcScript()) &&
    /* UI стандарт: схемийг tableSchema()-аар (зорчигчийн галт тэрэг history-ийн бүх багана),
       бусад нь DS_SCHEMA[schemaKey] хэвээр — түлхүүр нь датасэтийнх */
    /const sc=this\.tableSchema\(dsel,baseKey\);/.test(dcScript()) &&
    /return DS_SCHEMA\[schemaKey\];/.test(dcScript()) &&
    !/const sc=DS_SCHEMA\[dsel\.sector\];/.test(dcScript()));
  check('BE22. Багана өргөн/эрэмбийн кэш ч ижил түлхүүрээр (датасэт хооронд холилдохгүй)',
    /const cacheKey=schemaKey\+/.test(dcScript()) &&
    /this\.state\.pvColWidths\[schemaKey\]/.test(dcScript()));
  check('BE22. Вагон ачилтын датасэт rail_wagon схем зарлана',
    /schema:'rail_wagon',source:'railWagon'/.test(dcScript()));
  check('BE22. DS_SCHEMA.rail_wagon анхнаасаа ХООСОН мөртэй (зохиомол дата алга)',
    /rail_wagon:\{head:\[[\s\S]*?rows:\[\]\}/.test(dcScript()));
  /* Каталогоос хасагдсан 8 датасэтийн ЗОХИОМОЛ хүснэгтийн мөрүүд
     (DS_SCHEMA.road/.rail/.water/.public) бүрмөсөн устсан эсэх. Өмнө нь
     эдгээр "Excel татах" товчоор файл болж ч гардаг байв. */
  const dsSchemaBlock = (dcScript().match(/const DS_SCHEMA=\{([\s\S]*?)\n\};/) || [])[1] || '';
  check('BE22. Устгасан датасэтийн зохиомол схем (road/rail/water/public) БАЙХГҮЙ',
    !/\n  (road|rail|water|public):\{head:/.test(dsSchemaBlock), dsSchemaBlock.slice(0, 80));
  check('BE22. Схем бүр мөргүй (rows:[]) эхэлнэ — зохиомол дата кодод байхгүй',
    (dsSchemaBlock.match(/rows:\[\]/g) || []).length === (dsSchemaBlock.match(/\n  [a-z_]+:\{head:/g) || []).length &&
    (dsSchemaBlock.match(/rows:\[\]/g) || []).length >= 4,
    String((dsSchemaBlock.match(/rows:\[/g) || []).length));
  check('BE22. Зорчигчийн датасэт ӨӨРИЙН схемтэй (rail_pax)',
    /schema:'rail_pax'/.test(dcScript()) && /rail_pax:\{head:/.test(dsSchemaBlock));
  check('BE22. Каталогийн давтамж "Тодорхойгүй" биш бодит хуваарь',
    !/freq:'Тодорхойгүй',use:'Нийтийн API нээлттэй'/.test(dcScript()));

  /* ── BE23. Шинэ харагдах текст content.json-д бүртгэгдсэн ── */
  const cw = con14.site.ds_schema_rail_wagon || {};
  check('BE23. ds_schema_rail_wagon.head 7 баганатай', (cw.head || []).length === 7, JSON.stringify(cw.head));
  check('BE23. ds_schema_rail_wagon.notes 7 тайлбартай', (cw.notes || []).length === 7);
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
  const s24 = dcScript().match(/function sectorSummaryToSeries\(json,now,cov\)\{([\s\S]*?)\n\}/);
  if (!s24) { bad('BE24. sectorSummaryToSeries() олдсонгүй'); return; }
  /* cov-г ЗОРИУД дамжуулахгүй — өгөгдмөл дүрэм (COVERAGE_DEFAULT) үед
     зан төлөв ӨМНӨХ шигээ байхыг доорх бүх тест шалгана. */
  const toSeriesRaw = new Function('COVERAGE_DEFAULT', 'json', 'now', 'cov', s24[1]);
  const toSeries = (json, now) => toSeriesRaw({ grain: 'month', excludes_current: true }, json, now);
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
  /* 2026-09-22: салбарын цуваа ЕРӨНХИЙ болов (SERIES_METRIC → SERIES[api]) */
  check('BE25. Админ metricSeries салбарын цувааг SERIES-ээс (flights FEED-ээс ХАМААРАХГҮЙ)',
    /if\(SERIES_METRIC\[mk\]\)\{ var ss=SERIES\[SERIES_METRIC\[mk\]\]; return \(ss&&ss\.state==='ready'\)\?ss\.series:null; \}\s*\n\s*if\(FEED\.state!=='ready'\) return null;/.test(adm25));
  check('BE25. Админ ДӨРВӨН эх сурвалжийг зэрэг ачаална (үзлэг нэмэгдсэн)',
    adm25.includes('Promise.all([loadFeed(),loadRailWagon(),loadRoadInspections(),loadSectorSeries(),loadSectorTotalWeekly()])'));
  check('BE25. Админ rail.monthly_passenger_series → rail',
    /var SERIES_METRIC=\{'rail\.monthly_passenger_series':'rail'/.test(adm25));
  check('BE25. Line preview бусад verified слотын цувааг ч харуулна (rail холбоос тусна)',
    /data-pvextra="1"/.test(adm25) && /sv\.metric===mk\) return null;/.test(adm25));

  /* ── BE26. applySectorSeries(k) ба seriesKpiRow(k) — ЕРӨНХИЙ (2026-09-22) ──
     rail-ийн анхны хэрэгжилтийг ерөнхийлсөн; rail дээрх зан төлөв ЯГ хэвээр
     байхыг ижил фикстураар шална. Тохиргоо нь сайтын ЖИНХЭНЭ SECTOR_SERIES. */
  const ap26 = dcScript().match(/\n  applySectorSeries\(k\)\{([\s\S]*?)\n  \}\n/);
  const kr26 = dcScript().match(/\n  seriesKpiRow\(k\)\{([\s\S]*?)\n  \}\n/);
  const ss26 = dcScript().match(/const SECTOR_SERIES=(\{[\s\S]*?\n\});/);
  if (!ap26 || !kr26 || !ss26) { bad('BE26. applySectorSeries()/seriesKpiRow()/SECTOR_SERIES олдсонгүй'); return; }
  const PAXTXT = { 'sector_chart_rail_live': 'Сарын зорчигч', 'sector_kpi_rail_live.3': 'ЗОРЧИГЧ / САР',
    'unit.passenger': 'зорчигч', 'chart.compare_mom_mid': '· өмнөх сартай (', 'chart.compare_mom_end': ') харьцуулбал',
    'status.no_compare': 'харьцуулах өгөгдөл алга' };
  const st26 = (p, f) => (PAXTXT[p] !== undefined ? PAXTXT[p] : f);
  const fmt26 = (n) => Number(n).toLocaleString('en-US');
  const SS26 = new Function('stxt', 'return ' + ss26[1])(st26);
  const mkPaxRaw = new Function('SECTORS', 'SECTOR_SERIES', 'DS_SCHEMA', 'stxt', 'k', ap26[1]);
  const mkRowRaw = new Function('SECTOR_SERIES', 'stxt', 'fmtNum', 'MONTHS', 'k', kr26[1]);
  /* Хуучин (rail-д зориулсан) дуудлагын хэлбэрийг хадгалж, доорх тестүүд ХЭВЭЭР үлдэнэ */
  const mkRow = (st, fmt, MON) => ({ call: (c) => mkRowRaw.call({ _sectorSeries: { rail: c._railPaxSeries } }, SS26, st, fmt, MON, 'rail') });
  const runPax = (series) => {
    const SEC = { rail: { c1: 'Сарын зорчигч (мянга)', c1d: [290, 270, 310], _liveKpis: true } };
    /* applySectorSeries одоо датасэтийн мета бичдэг (u07-ийн зорчигчийн
       мөр ҮҮНЭЭС уншина) тул стаб ЗААВАЛ хэрэгтэй. */
    const ctx = { _sectorSeries: { rail: series }, _st: null, _meta: null,
      setSourceMeta(id, m) { this._meta = { id, m }; }, setState(s) { this._st = s; } };
    /* rail_pax схем — цуваанаас дүүрдэг эсэхийг шалгах стаб. */
    const DSS = { rail_pax: { head: [], types: ['string','int','enum'], notes: [], rows: [] } };
    mkPaxRaw.call(ctx, SEC, SS26, DSS, st26, 'rail');
    return { SEC, ctx, DSS };
  };
  const P26 = runPax({ unit: 'зорчигч', year: 2026, counts: JAN_AUG.slice(), lastMonth: 8 });
  check('BE36. Цувааны мета railPax-д, сүүлийн БҮТЭН сараар (2026-08)',
    !!P26.ctx._meta && P26.ctx._meta.id === 'railPax' &&
    P26.ctx._meta.m.updatedAt === '2026-08' && P26.ctx._meta.m.lastRecord === '2026-08',
    JSON.stringify(P26.ctx._meta));
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
  /* ── BE40. Зорчигчийн датасэтийн ХҮСНЭГТ амьд сарын цуваанаас (2026-09-28) ──
     Өмнө нь энэ датасэт `schema` зарлаагүй тул DS_SCHEMA.rail буюу ачааны
     галт тэрэгний ЗОХИОМОЛ мөрүүдийг өөрийн дата мэт үзүүлж, Excel-ээр ч
     гаргадаг байв. Одоо rows ХООСОН эхэлж, цуваа ирэхэд Л дүүрнэ. */
  const T40 = P26.DSS.rail_pax;
  check('BE40. rail_pax мөр = бүтэн сарын тоо (8), шинэ сар эхэнд (2026-08)',
    T40.rows.length === 8 && T40.rows[0][0] === '2026-08' && T40.rows[7][0] === '2026-01',
    JSON.stringify(T40.rows.slice(0, 2)));
  check('BE40. Утга нь цувааны ЯГ ТЭР тоо (8-р сар 148,470; 1-р сар 143,220 — гараар)',
    T40.rows[0][1] === 148470 && T40.rows[7][1] === 143220);
  check('BE40. Төлөв ok: (бүтэн сар — явагдаж буй сар цуваанд ордоггүй)',
    T40.rows.every((r) => /^ok:/.test(r[2])));
  check('BE40. Утгын баганын нэр ба нэгж labels()-ээс (content.json-д давхардуулаагүй)',
    T40.head[1] === 'ЗОРЧИГЧ / САР' && /зорчигч-ийн тоо/.test(T40.notes[1]) && !/\{unit\}/.test(T40.notes[1]),
    JSON.stringify(T40.head) + ' ' + T40.notes[1]);
  check('BE40. Дата ирээгүй → хүснэгт ХООСОН хэвээр (зохиомол мөр алга)',
    N26.DSS.rail_pax.rows.length === 0);

  /* ── BE41. Каталогт ЗӨВХӨН сервисээр ирдэг датасэт (2026-09-28) ──
     12 бичлэгийн 8 нь эх сурвалжгүй, бүх тоо нь зохиомол байв. */
  const ds41 = dcScript().match(/\nconst DATASETS=\[([\s\S]*?)\n\];/);
  const src41 = dcScript().match(/\nconst SOURCES=\{([\s\S]*?)\n\};/);
  const dsNames41 = ds41 ? (ds41[1].match(/\{sector:'/g) || []).length : 0;
  const dsSrc41 = ds41 ? (ds41[1].match(/source:'(\w+)'/g) || []).map((x) => x.slice(8, -1)) : [];
  check('BE41. Каталогийн бичлэг БҮР `source`-той (эх сурвалжгүй датасэт алга)',
    dsNames41 > 0 && dsSrc41.length === dsNames41, dsSrc41.length + ' / ' + dsNames41);
  check('BE41. `source` бүр SOURCES-д бүртгэлтэй',
    !!src41 && dsSrc41.every((k) => new RegExp('\\n  ' + k + ':\\{').test(src41[1])), dsSrc41.join(','));
  check('BE41. content.json site.datasets ба DATASETS ИЖИЛ урттай (индексээр давхардана)',
    readJson('content.json').site.datasets.length === dsNames41);

  /* ── BE42. Статик демо тоо кодод ҮЛДЭЭГҮЙ — feed унавал ч зохиомол тоо гарахгүй ──
     Өмнө нь flights feed / backend амжилтгүй болоход SECTORS-ийн статик
     тоо (48,210 км, MIAT 681,711 …) бодит дата мэт харагддаг байв. */
  const sec42 = dcScript().match(/\nconst SECTORS = \{([\s\S]*?)\n\};/);
  const S42 = sec42 ? new Function('return {' + sec42[1] + '}')() : null;
  check('BE42. SECTORS олдов (4 салбар — «Нийтийн тээвэр» хасагдсан)', !!S42 && Object.keys(S42).length === 4);
  if (S42) {
    const kv = Object.values(S42).flatMap((x) => x.kpis.map((k) => k[1] + '|' + k[3]));
    check('BE42. KPI утга/өөрчлөлт бүгд "—" (статик тоо алга)',
      kv.every((v) => v === '—|—'), kv.filter((v) => v !== '—|—').join(' '));
    check('BE42. c1d / rank / bars бүгд ХООСОН',
      Object.values(S42).every((x) => !x.c1d.length && !x.rank.length && !x.bars.length));
    check('BE42. air.monthly / cargoRank ХООСОН (feed-ийн "түр орлуулга" алга)',
      !S42.air.monthly.pax.length && !S42.air.cargoRank.length && !S42.air.rankAll.length);
  }
  /* Тайлбарт (түүх болж) үлдэж болно — ДАТА болох мөр утгад ('…') үлдээгүйг шалгана */
  check('BE42. "48,210" мөр утга болж кодод ч content.json-д ч үлдээгүй',
    !/'48,210/.test(dcScript()) && !/48,210/.test(fs.readFileSync(path.join(ROOT, 'content.json'), 'utf8')));
  /* Хоосон цуваа график бүтээгчийг нураахгүй (Math.max([]) = -Infinity) */
  const btc42 = dcScript().match(/\nfunction buildTrendChart\(data,off(?:,partial(?:,noForecast)?)?\)\{([\s\S]*?)\r?\n\}\r?\n/);
  let btcOk = false, btcErr = '';
  try {
    const f = new Function('data', 'off', 'partial', 'noForecast', 'MONTHS', 'stxt', btc42[1]);
    const r = f([], 0, undefined, false, MONTHS25, (p, x) => x);
    btcOk = !!r && /^M/.test(r.line) && !/NaN|Infinity/.test(r.line + r.peak.value);
  } catch (e) { btcErr = e.message; }
  check('BE42. buildTrendChart([]) нурахгүй, хавтгай шугам зурна', btcOk, btcErr);
  /* ── BE44. ДУТУУ САР (одоогийн сар) ГАЦСАН БИШ — тусдаа цэгээр харагдана ──
     Өмнө: dropPartialMonth 10-р сарыг хасаад үлдээдэг → график 9-р сар дээр гацсан
     мэт харагддаг байв. Одоо: шугам ба прогноз бүтэн сараар хэвээр, харин дутуу
     сарын ОДООГИЙН утга тусдаа "дутуу" шошготой цэг болно. Фикстур: 2026-10-12. */
  const now44 = Date.UTC(2026, 9, 12, 4); // УБ 2026-10-12
  const cov44 = { grain: 'month', excludes_current: true };
  const v44 = [1719, 1241, 1403, 1392, 1622, 2044, 2478, 2450, 1966, 654];
  const dpm44 = dcScript().match(/\nfunction dropPartialMonth\(counts,year,cov,now\)\{([\s\S]*?)\n\}\n/);
  if (dpm44) {
    const dpmFn = new Function('return function dropPartialMonth(counts,year,cov,now){' + dpm44[1] + '\n}')();
    const dp44 = dpmFn(v44, 2026, cov44, now44);
    check('BE44. dropPartialMonth: дутуу сар цуваанаас хасагдаж, ОДООГИЙН утгыг буцаана',
      dp44.counts.length === 9 && dp44.partial === '2026-10' && dp44.value === 654,
      JSON.stringify({ n: dp44.counts.length, p: dp44.partial, v: dp44.value }));
  }
  const sss44 = dcScript().match(/\nfunction sectorSummaryToSeries\(json,now,cov\)\{([\s\S]*?)\n\}\n/);
  if (sss44) {
    const sssFn = new Function('return function sectorSummaryToSeries(json,now,cov){' + sss44[1] + '\n}')();
    const rows44 = v44.map((n, i) => ({ month: '2026-' + String(i + 1).padStart(2, '0') + '-01T00:00:00.000Z', total_volume: String(n) }));
    const s44 = sssFn({ status: 'ok', unit: 'нислэг', data: rows44 }, now44, cov44);
    check('BE44. sectorSummaryToSeries: дутуу сарын утга partialValue-д, цуваанд 9 сар',
      !!s44 && s44.counts.length === 9 && s44.partial === '2026-10' && s44.partialValue === 654,
      JSON.stringify(s44 && { n: s44.counts.length, p: s44.partial, v: s44.partialValue }));
  }
  if (btc42) {
    const mk44 = new Function('MONTHS', 'stxt',
      'return function buildTrendChart(data,off,partial,noForecast){' + btc42[1] + '}')(MONTHS25, (p, x) => x);
    const d9 = v44.slice(0, 9);
    const a44 = mk44(d9, 0), b44 = mk44(d9, 0, 654);
    check('BE44. Дутуу сарын цэг график дээр гарна ("дутуу: 654")',
      b44.hasPartial === true && /дутуу/.test(b44.partialLabel) && /654/.test(b44.partialLabel), b44.partialLabel);
    check('BE44. Дутуу сар шугам/прогнозыг ӨӨРЧИЛДӨГГҮЙ (прогноз, шугамын цэгийн тоо адил)',
      a44.fcLabel.delta === b44.fcLabel.delta && a44.fcSplitX === b44.fcSplitX &&
      a44.line.split('L').length === b44.line.split('L').length, '');
    check('BE44. Дутуу сарын цэг хүрээндээ багтана (Y тэнхлэгээс гарахгүй)',
      Number(b44.partialCy) <= b44.h - b44.padB && Number(b44.partialCy) >= b44.padT, b44.partialCy);
    check('BE44. Дутуу сар байхгүй үед цэг ГАРАХГҮЙ', a44.hasPartial === false, '');
  }

  /* ── BE43. Датасэтийн "Салбарын бүтэц" — ЗӨВХӨН тухайн датасэтийн задаргаа ──
     SECTORS[k].rank нь салбарын түвшнийх; төмөр замд үүнийг вагоны датасэт
     дүүргэдэг тул зорчигчийн датасэтийн хуудас вагоны буудлын задаргааг
     (Багануур 16.9% …) ӨӨРИЙНХ мэт харуулж байв (2026-09-29 илэрсэн). */
  const dr43 = dcScript().match(/\nfunction datasetRank\(sec,ds\)\{([\s\S]*?)\n\}\n/);
  check('BE43. datasetRank() олдов', !!dr43);
  if (dr43) {
    const dr = new Function('sec', 'ds', dr43[1]);
    const RAIL = { rank: [['Багануур', '193', '16.9%']], _rankSource: 'railWagon' };
    check('BE43. Вагоны задаргаа ВАГОНЫ датасэт дээр харагдана',
      dr(RAIL, { source: 'railWagon' }).length === 1);
    check('BE43. Вагоны задаргаа ЗОРЧИГЧИЙН датасэт дээр ХАРАГДАХГҮЙ',
      dr(RAIL, { source: 'railPax' }).length === 0);
    check('BE43. Задаргааг хэн бичсэн нь тодорхойгүй бол харуулахгүй (зохиомол байж болзошгүй)',
      dr({ rank: [['X', '1', '100%']] }, { source: 'railWagon' }).length === 0);
    check('BE43. Хоосон/эвдэрсэн оролт → хоосон массив (нурахгүй)',
      dr(null, null).length === 0 && dr({ _rankSource: 'a' }, { source: 'a' }).length === 0);
  }
  check('BE43. Задаргаа бичдэг 3 газар бүгд _rankSource тэмдэглэнэ',
    /SECTORS\.road\._rankSource='roadInspect'/.test(dcScript()) &&
    /SECTORS\.rail\._rankSource='railWagon'/.test(dcScript()) &&
    /SECTORS\.air\._rankSource='flights'/.test(dcScript()));
  check('BE43. Датасэтийн хуудас datasetRank()-аар уншина (SECTORS[..].rank ШУУД биш)',
    /datasetRank\(SECTORS\[dsel\.sector\],dsel\)/.test(dcScript()) &&
    !/:SECTORS\[dsel\.sector\]\.rank\)/.test(dcScript()));
  check('BE43. Хоосон үед "мэдээлэл алга" гэж ил хэлнэ',
    /detail\.rankEmpty/.test(read('index.html')));
  /* ── BE44. "Өөрчлөлтийн түүх" — ЗОХИОМОЛ 3 мөр датасэт бүр дээр гардаг байв ── */
  check('BE44. Зохиомол өөрчлөлтийн түүх ("хоцролт 20 сек" г.м.) кодод үлдээгүй',
    !/Бодит цагийн урсгалын хоцролт 20 сек/.test(dcScript()) && !/Түүхэн өгөгдөл 2021 он хүртэл/.test(dcScript()));
  check('BE44. Өөрчлөлтийн түүх хоосон бол "мэдээлэл алга"',
    /detail\.changelogEmpty/.test(read('index.html')));

  /* ── BE45. Коммунитийн төсөл каталогт БАЙХГҮЙ датасэт нэрлэвэл ИЛ хэлнэ ──
     Регресс (browser, 2026-10-01): каталог 12 → 4 болоход (эх сурвалжгүй 8
     датасэт хасагдсан) коммунитийн 6 картын "эх өгөгдөл" мөр бүгд хоосон
     лавлагаа болов — жишээ нь "CityBus Live … Автобусны GPS байршил" гэж
     бичигдсэн атал тэр нэртэй датасэт порталд БАЙХГҮЙ, иргэн каталогаас
     хайвал олдохгүй. Нэрийг НУУХГҮЙ, харин нийтлэгдээгүйг ил хэлнэ. */
  const cmSrc = dcScript().match(/const inCatalog=\(nm\)=>([\s\S]*?);\r?\n\s*const dsLabel=\(nm\)=>([\s\S]*?);\r?\n/);
  if (!cmSrc) { bad('BE45. dsLabel() олдсонгүй'); return; }
  const mkLabel = new Function('DATASETS', 'stxt',
    'const inCatalog=(nm)=>' + cmSrc[1] + ';' +
    'const dsLabel=(nm)=>' + cmSrc[2] + ';' +
    'return dsLabel;');
  const CAT = [{ name: 'Агаарын тээврийн статистик' }, { name: 'Техникийн хяналтын үзлэгийн мэдээ' }];
  const lab = mkLabel(CAT, (p, f) => f);
  check('BE45. Каталогт БАЙГАА датасэтийг хэвээр нэрлэнэ (нэмэлт тэмдэглэгээгүй)',
    lab('Агаарын тээврийн статистик') === 'Агаарын тээврийн статистик',
    lab('Агаарын тээврийн статистик'));
  check('BE45. Каталогт БАЙХГҮЙ датасэтийг ил хэлнэ (нэр нь ХЭВЭЭР үлдэнэ)',
    lab('Автобусны GPS байршил') === 'Автобусны GPS байршил · каталогт алга',
    lab('Автобусны GPS байршил'));
  check('BE45. Датасэт зарлаагүй төсөл хоосон мөр үзүүлнэ (тэмдэглэгээ ЗОХИОХГҮЙ)',
    lab('') === '' && lab(undefined) === '' && lab(null) === '');
  /* Хэсэгчилсэн таарал нь ТААРАЛ БИШ — "Агаарын тээвэр" гэсэн нэр
     "Агаарын тээврийн статистик"-тай андуурагдах ёсгүй. */
  check('BE45. Таарал нь ЯГ нэрээр (хэсэгчилсэн таарлыг хүлээж авахгүй)',
    lab('Агаарын тээвэр') === 'Агаарын тээвэр · каталогт алга');
  check('BE45. Тэмдэглэгээний текст content.json-д бүртгэлтэй',
    readJson('content.json').site.community_data.dataset_unlisted === 'каталогт алга');
  /* Өмнө нь dataset ЗӨВХӨН кодод байсан тул админаас засагдахгүй, каталог
     өөрчлөгдөхөд хоцрох цорын ганц харагдах текст байв. */
  check('BE45. dataset нь content.json-оос давхарлагдана (админаас засагдана)',
    /\['name','by','kind','desc','dataset'\]\.forEach/.test(dcScript()));
  const cdp = readJson('content.json').site.community_data.projects;
  check('BE45. Төсөл бүрийн dataset content.json-д бүртгэгдсэн (6/6)',
    Array.isArray(cdp) && cdp.length === 6 && cdp.every((p) => typeof p.dataset === 'string' && p.dataset),
    JSON.stringify((cdp || []).map((p) => p.dataset)));

  /* ── BE46. Бодлогын саналын "үндэслэл" (basis) — ИЖИЛ шалгуур ──
     Регресс (2026-10-05): basis нь датасэтийн нэрийн ард ЗОХИОМОЛ хэмжүүр
     залгадаг байв — "Автобусны GPS сан · 620,000 дуудлага/сар",
     "Замын ослын бүртгэл · 12,400 мөр", "Агаарын тээврийн статистик ·
     14,200 дуудлага/сар". Эдгээр тоо ЭХ СУРВАЛЖГҮЙ бөгөөд порталын өөрийн
     "ДУУДЛАГА/САР" KPI нь "—" гэж хэлдэг — өөрөөр хэлбэл хуудас өөртэйгөө
     зөрчилдөж байв. Одоо basis нь ЦЭВЭР датасэтийн нэр, төслийн "эх
     өгөгдөл"-тэй ижил dsLabel()-ээр каталогтой тулгагдана. */
  const polBlock = (dcScript().match(/\nconst POLICIES=\[([\s\S]*?)\n\];/) || [])[1] || '';
  const basisVals = (polBlock.match(/basis:'([^']*)'/g) || []).map((m) => m.slice(7, -1));
  check('BE46. 4 бодлого бүгд basis-тай', basisVals.length === 4, JSON.stringify(basisVals));
  check('BE46. basis-д ЗОХИОМОЛ хэмжүүр үлдээгүй (тоо, "мөр", "дуудлага", "SLA")',
    basisVals.every((b) => !/\d/.test(b) && !/мөр|дуудлага|SLA/i.test(b)), JSON.stringify(basisVals));
  check('BE46. basis нь · тэмдэгтээр залгаагүй ЦЭВЭР нэр',
    basisVals.every((b) => b.indexOf('·') < 0), JSON.stringify(basisVals));
  check('BE46. Бодлогын үндэслэл ч dsLabel()-ээр каталогтой тулгагдана',
    /* support: (зохиомол дэмжлэгийн тоо) 2026-10-05-нд устсан — BE50 */
    /body:p\.body,meta:dsLabel\(p\.basis\),goal:/.test(dcScript()));
  check('BE46. basis content.json-оос давхарлагдана (админаас засагдана)',
    /\['title','by','stage','basis'\]\.forEach/.test(dcScript()));
  const cdl = readJson('content.json').site.community_data.policies;
  check('BE46. Бодлого бүрийн basis content.json-д бүртгэгдсэн (4/4)',
    Array.isArray(cdl) && cdl.length === 4 && cdl.every((p) => typeof p.basis === 'string' && p.basis),
    JSON.stringify((cdl || []).map((p) => p.basis)));
  /* Каталогт БАЙГАА анхны бодит тохиолдол — өмнө нь зөвхөн "байхгүй"
     салаа л амьдаар ажиллаж байсан тул энэ нь эерэг замыг барина. */
  const dsNames = (dcScript().match(/\nconst DATASETS=\[([\s\S]*?)\n\];/) || [])[1] || '';
  check('BE46. Агаарын бодлогын үндэслэл каталогт БАЙНА → тэмдэглэгээгүй гарна',
    basisVals.indexOf('Агаарын тээврийн статистик') >= 0 &&
    dsNames.includes("name:'Агаарын тээврийн статистик'"),
    JSON.stringify(basisVals));

  /* ── BE47. 7 хоногийн баганын Y тэнхлэг УТГЫН МАСШТАБААС ──────────────
     Регресс (browser, 02-р хэсэг): ачааны график (13–44 тонн) дээр
     тэнхлэг "-50 / 0 / 50" болж, хөл бичигт "тэнхлэг -50-с эхэлнэ" гэж
     СӨРӨГ тонн зарлаж, бүх багана дээд гуравны нэгд шахагдаж байв.
     Шалтгаан нь алхам `/50` гэж ХАТУУ бичигдсэн — зорчигчийн мянгад
     тохирно ч тоннд хэтэрхий бүдүүн. Доорх тоонууд ГАРААР бодогдсон. */
  const waSrc = dcScript().match(/function weekAxis\(vals\)\{([\s\S]*?)\n\}/);
  if (!waSrc) { bad('BE47. weekAxis() олдсонгүй'); return; }
  const weekAxis = new Function('return function weekAxis(vals){' + waSrc[1] + '}')();
  /* Ачаа (тонн): mx 44.212, mn 13.253 → span 30.959, span/2 = 15.48 →
     алхам 10^floor(log10 15.48) = 10. Шал floor((13.253−18.575)/10)×10
     = −10 ч бүх утга ≥ 0 тул 0 болно. Тааз ceil((44.212+4.644)/10)×10 = 50. */
  const cargo = [44.212, 34.683, 35.118, 18.824, 13.253, 27.532, 28.873];
  const wcargo = weekAxis(cargo);
  check('BE47. Ачааны тонн — тэнхлэг 0…50, алхам 10 (СӨРӨГ тонн БАЙХГҮЙ)',
    wcargo.base === 0 && wcargo.top === 50 && wcargo.step === 10, JSON.stringify(wcargo));
  /* Зорчигч: mx 8239, mn 6242 → span 1997, span/2 = 998.5 → алхам 100.
     Шал floor((6242−1198.2)/100)×100 = 5000, тааз ceil(8538.55/100)×100 = 8600.
     ХУУЧИН кодтой (алхам 50) шал ИЖИЛ 5000 — энэ график эвдрээгүй. */
  const wpax = weekAxis([6931, 7663, 8239, 7752, 6242, 7224, 8166]);
  check('BE47. Зорчигчийн график эвдрээгүй — шал 5,000 хэвээр',
    wpax.base === 5000 && wpax.top === 8600 && wpax.step === 100, JSON.stringify(wpax));
  /* Сөрөг утгатай цуваа бол шалыг 0-д БАРИХГҮЙ — тэр нь жинхэнэ утга. */
  const wneg = weekAxis([-20, -5, 10]);
  check('BE47. Үнэхээр сөрөг утгатай бол шал 0-д баригдахгүй',
    wneg.base < 0, JSON.stringify(wneg));
  /* Бүх утга 0: ХУУЧИН код top===base өгч багануудыг 50% өндөрт зурдаг
     байсан (дата байгаа мэт). Одоо тааз > шал тул багана 0% дээр суух
     ба "дата алга" гэдэг нь харагдацаараа ҮНЭН болно. */
  const wzero = weekAxis([0, 0, 0]);
  check('BE47. Бүх утга 0 — тааз > шал (багана 50% биш, 0% дээр)',
    wzero.base === 0 && wzero.top > 0, JSON.stringify(wzero));
  check('BE47. Хоосон цуваа → 0/0 (өмнөх хамгаалалт хэвээр)',
    JSON.stringify(weekAxis([])) === JSON.stringify({ base: 0, top: 0, step: 1 }) &&
    JSON.stringify(weekAxis(null)) === JSON.stringify({ base: 0, top: 0, step: 1 }));
  check('BE47. Тэнхлэгийг /50 гэж ХАТУУ бичсэн хуучин мөр үлдээгүй',
    !/\(bmax-bmin\)\*0\.6\)\/50\)\*50/.test(dcScript()) &&
    /const wax=weekAxis\(okVals\);/.test(dcScript()));

  /* ── BE50. Коммунитийн НИЙТ тоо зохиомол байсан (2026-10-05) ──
     Санал/лайк нь зөвхөн тухайн хэрэглэгчийн session-д (this.state.cVotes)
     хадгалагддаг — нийт тоо хаана ч ТООЛОГДДОГГҮЙ. Иймд "👁 88.4K ♥ 2,610",
     "962 / 1,000 дэмжигч", "142 санал" бүгд зохиомол байв. */
  const blk45 = (name, open, close) => (dcScript().match(new RegExp('\\nconst ' + name + '=\\' + open + '([\\s\\S]*?)\\n\\' + close + ';')) || [])[1] || '';
  const pol45 = blk45('POLICIES', '[', ']'), prj45 = blk45('PROJECTS', '[', ']'), req45 = blk45('REQUESTS', '[', ']');
  check('BE50. POLICIES/PROJECTS/REQUESTS олдов', !!pol45 && !!prj45 && !!req45);
  check('BE50. Төсөлд views/likes/forks тоо АЛГА', !/\b(views|likes|forks):/.test(prj45), (prj45.match(/(views|likes|forks):[^,]+/g) || []).join(' '));
  check('BE50. Бодлогын саналд support тоо АЛГА (зорилт goal нь босго тул үлдэнэ)',
    !/\bsupport:\d/.test(pol45) && /\bgoal:\d/.test(pol45));
  check('BE50. Дата хүсэлтэд votes тоо АЛГА', !/\bvotes:\d/.test(req45));
  /* Регресс: support-ийг хассаны дараа buildPageVals() дахь ҮХМЭЛ
     `policies` жагсаалт p.support.toLocaleString()-ийг дуудсаар үлдэж,
     НҮҮР ХУУДАС бүхэлдээ нурсан (Root.renderVals). Устсан талбарыг
     кодын аль ч газар унших ёсгүй. */
  check('BE50. Устсан support/likes/views/votes-ийг код ХААНА Ч уншихгүй',
    !/\b(p|q|it|sel|r)\.(support|views|forks|votes)\b/.test(dcScript()) && !/\bp\.likes\b/.test(dcScript()),
    (dcScript().match(/\b(p|q|it|sel|r)\.(support|views|forks|votes|likes)\b/g) || []).join(' '));
  check('BE50. Саналын тайлбарт зохиомол статистик (41%, 18–24%, 34%, 2.4 сая тонн) АЛГА',
    !/41%|18–24%|34%-ийг|40% хүртэл|2\.4 сая тонн/.test(pol45));
  check('BE50. "Дэмжлэгээр" эрэмбэ хасагдсан (тоолоогүй тоогоор эрэмбэлэхгүй)',
    !/\['top','Дэмжлэгээр'\]/.test(dcScript()) && !/cSort:'top'/.test(dcScript()));
  check('BE50. Нүүрний онцлох карт зохиомол үзэлт/дэмжлэгээр СОНГОГДОХГҮЙ',
    !/parseFloat\(b\.views\)/.test(dcScript()) && !/b\.support\/b\.goal/.test(dcScript()));
  check('BE50. Онцлох карт дарахад дэлгэрэнгүй НЭЭГДЭНЭ (cKey-тэй ижил түлхүүр)',
    /projOpen:'dash:'\+p\.name/.test(dcScript()) && /projOpen:'policy:'\+q\.title/.test(dcScript()));
  const ct45 = readJson('content.json').site.community;
  check('BE50. "ХАМГИЙН ИХ ХАРАГДСАН" / "ХАМГИЙН ХУРДАН ӨСӨЖ БУЙ" шошго АЛГА',
    !/ХАМГИЙН ИХ ХАРАГДСАН|ХАМГИЙН ХУРДАН/.test(JSON.stringify(ct45) + dcScript()));
  /* buildCommunity — нийт тоо "—", хэрэглэгчийн өөрийн санал л харагдана */
  const bc45 = dcScript().match(/\n  buildCommunity\(\)\{([\s\S]*?)\n  \}\n/);
  check('BE50. buildCommunity: нийт дэмжлэг "—", хувь тооцохгүй',
    !!bc45 && /supportLabel:'—'/.test(bc45[1]) && !/sup\.toLocaleString\(\)/.test(bc45[1]));
  check('BE50. Дэмжих товч тоогүй ("✓ Дэмжсэн" / "Дэмжих")',
    /it\.voteBtnLabel/.test(read('index.html')) && !/\{\{ it\.supportLabel \}\} Дэмжих/.test(read('index.html')));

  /* ── BE51. Хөгжүүлэгчийн таб "Удахгүй" ──
     API түлхүүр, багц (10 дуудлага/сек, SLA 99.9%) БАЙХГҮЙ хөтөлбөр байв. */
  const br46 = readJson('content.json').site.browse;
  check('BE51. content.json-д "удахгүй" бичиг бүртгэлтэй',
    !!br46.dev_soon_badge && !!br46.dev_soon_note && !!br46.dev_soon_cta && !!br46.dev_code_live);
  check('BE51. Табын тайлбарт "Удахгүй"', /Удахгүй/.test(br46.tabs[2].sub));
  check('BE51. Темплейтэд мэдэгдэл + тэмдэг харагдана',
    /browseHero\.t\.devSoonNote/.test(read('index.html')) && /browseHero\.t\.devSoonBadge/.test(read('index.html')));
  check('BE51. Багцын CTA ажиллахгүй (бүртгэл/холбоо барих руу ХӨТЛӨХГҮЙ)',
    !/authRole:'dev'/.test(dcScript()) && !/setState\(\{devContactOpen:true\}\)/.test(dcScript()));

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
  /* BE26y. Өмнөх оны МӨН сар байвал YoY (агаарын KPI-тай ижил). Нүүрний KPI нь
     summary 2025-ыг өгч байхад "өмнөх оны дата алга" гэсэн хуучирсан таамгаар
     MoM (−29.9%, улирлын нөлөө) харуулж байв (2026-10-16).
     Гараар: 2026-08 148,470 vs 2025-08 170,988 → −13.17% → "-13.2%". */
  {
    const prev25 = [149648, 97172, 129955, 137119, 131502, 166437, 154979, 170988, 111276, 132381, 133147, 128625];
    const rowY = mkRow(st26, fmt26, MONTHS25).call({ _railPaxSeries: { year: 2026, counts: JAN_AUG.slice(), prev: { year: 2025, counts: prev25 } } });
    check('BE26y. Өмнөх оны мөн сар байвал YoY: 8-р сар 2026 vs 2025 = -13.2% (down)',
      !!rowY && rowY[3] === '-13.2%' && rowY[4] === 'down', JSON.stringify(rowY && rowY.slice(0, 6)));
    check('BE26y. Шошго YoY гэдгийг ил (өмнөх оны мөн сар + 2025 он)',
      !!rowY && /өмнөх оны мөн сартай/.test(rowY[5]) && rowY[5].includes('2025'), rowY && rowY[5]);
    const rowN = mkRow(st26, fmt26, MONTHS25).call({ _railPaxSeries: { year: 2026, counts: JAN_AUG.slice(),
      prev: { year: 2025, counts: [1, 2, 3, null, null, null, null, null, null, null, null, null] } } });
    check('BE26y. Өмнөх оны МӨН сар (8) алга → MoM-оор (−6.4%) буцна', !!rowN && rowN[3] === '-6.4%' && /өмнөх сартай/.test(rowN[5]));
    const sss = dcScript().match(/\nfunction sectorSummaryToSeries\(json,now,cov\)\{([\s\S]*?)\n\}\n/);
    const SSF = sss && new Function('COVERAGE_DEFAULT', 'json', 'now', 'cov', sss[1]);
    if (!SSF) bad('BE26y. sectorSummaryToSeries олдсонгүй');
    else {
      const rows = [['2025-08', 170988], ['2025-09', 111276], ['2026-01', 10], ['2026-02', 20]]
        .map(([m, v]) => ({ month: m + '-01T00:00:00.000Z', total_volume: String(v) }));
      const s = SSF({ excludes_current: true }, { status: 'ok', unit: 'зорчигч', data: rows }, Date.UTC(2026, 9, 16), null);
      check('BE26y. sectorSummaryToSeries өмнөх оныг ХАЯХГҮЙ: prev.year 2025, 8-р сар 170,988, 1-р сар null',
        !!s && !!s.prev && s.prev.year === 2025 && s.prev.counts[7] === 170988 && s.prev.counts[0] === null && s.counts.join(',') === '10,20',
        JSON.stringify(s && s.prev));
    }
  }

  /* Вагоны мөрүүдийн АРД залгагдана — BE12-ын ижил фикстурт railPaxKpiRow нэмнэ */
  const withPax = (paxRow) => {
    const SEC = { rail: { label: 'Төмөр зам', kpis: [['НИЙТ ЗАМ', '1,815', 'км', '+0.4%', 'up']] } };
    const DSS = { rail_wagon: { head: [], types: [], notes: [], rows: [] } };
    const ctx = { _railWagonLoading: { count: 1182, unloadedCount: 1027, stationCount: 35, date: '2026-09-17' },
      setSourceMeta() {}, setState() {}, seriesKpiRow: (k) => (k === 'rail' ? paxRow : null) };
    /* dataAgeDays/WAGON_STALE_DAYS — вагоны хоцролтын тайлбар (PR #3). 1 хоног = хоцроогүй. */
    mkApply(SEC, DSS, (p, f) => (RAILTXT[p] !== undefined ? RAILTXT[p] : f), fmt26, () => 1, 2).call(ctx);
    return SEC.rail.kpis;
  };
  const k4 = withPax(paxRow);
  check('BE26. k04.rail = 4 мөр: вагон 3 + зорчигч 1 (kpis[3])', k4.length === 4 && k4[3][0] === 'ЗОРЧИГЧ / САР', JSON.stringify(k4.map((r) => r[0])));
  check('BE26. kpis[0] ХЭВЭЭР хоногийн ачилт (ls.rail = вагон, зорчигч БИШ)', k4[0][0] === 'ХОНОГИЙН АЧИЛТ' && k4[0][2] === 'вагон');
  check('BE26. Зорчигчийн дата алга → 3 мөр хэвээр', withPax(null).length === 3);

  /* ── BE27. Дараалал ба давхар баталгаа ── */
  check('BE27. reapplyLiveText: салбарын цуваа ЭХЛЭЭД, дараа нь вагон (мөр дахин баригдахад алдагдахгүй)',
    /reapplyLiveText\(\)\{[\s\S]*?Object\.keys\(SECTOR_SERIES\)\.forEach\(k=>this\.applySectorSeries\(k\)\);[\s\S]*?this\.applyRailWagonData\(\);[\s\S]*?this\.recomputeAirData\(\);/.test(dcScript()));
  check('BE27. loadEtransportBackend: вагон + тохиргооны БҮХ салбарыг ЗЭРЭГ, цувааг вагоноос ӨМНӨ',
    /Promise\.all\(\[EHBackend\.fetchRailWagonLoading\(\),\s*\.\.\.seriesKeys\.map\(k=>EHBackend\.fetchSectorSummary\?EHBackend\.fetchSectorSummary\(SECTOR_SERIES\[k\]\.api\):null\)\]\)/.test(dcScript()) &&
    /seriesKeys\.forEach\(\(k,i\)=>\{[\s\S]*?sectorSummaryToSeries\(sums\[i\],null,this\.coverageOf\([\s\S]*?this\.applyRailWagonData\(\);/.test(dcScript()));

  /* ── BE27b. ЕРӨНХИЙ ГЭРЭЭ — шинэ салбар нэмэхэд код өөрчлөхгүй ── */
  check('BE27b. SECTOR_SERIES бичлэг бүр api/dataset/kpi/labels-тэй, kpi ∈ {append, replace}',
    Object.values(SS26).every((c) => c.api && c.dataset && ['append', 'replace'].includes(c.kpi) && typeof c.labels === 'function'));
  check('BE27b. Сайтын салбар бүр админд ч цуваатай (preview = сайт)',
    Object.values(SS26).every((c) => new RegExp("'[a-z_.]+':'" + c.api + "'").test(adm25)));
  /* 'replace' горим — амьд KPI мөргүй салбарт цуваа мөр нь ЦОРЫН ГАНЦ мөр болно
     (road vehicle_registry-д зориулсан зам — синтетик тохиргоо, гараар бодсон) */
  const SSR = { road: { api: 'road', dataset: 'Тест датасэт', kpi: 'replace',
    labels: () => ({ chart: 'Сарын Х', kpi: 'Х / САР', unit: 'нэгж' }) } };
  const SECR = { road: { c1: 'демо', c1d: [1, 2, 3], kpis: [['НИЙТ ЗАМ', '48,210', 'км', '+2.1%', 'up']] } };
  const ctxR = { _sectorSeries: { road: { unit: 'нэгж', year: 2026, counts: [100, 110, 99], lastMonth: 3 } },
    setState() {}, setSourceMeta() {},
    seriesKpiRow(k) { return mkRowRaw.call(this, SSR, st26, fmt26, MONTHS25, k); } };
  mkPaxRaw.call(ctxR, SECR, SSR, {}, st26, 'road');
  check('BE27b. replace: статик демо мөрүүд (48,210 км) бүрэн солигдож 1 амьд мөр',
    SECR.road.kpis.length === 1 && SECR.road.kpis[0][0] === 'Х / САР' && SECR.road.kpis[0][1] === '99' &&
    SECR.road._liveKpis === true, JSON.stringify(SECR.road.kpis));
  /* (99 − 110) / 110 × 100 = −10.0% */
  check('BE27b. replace: MoM гараар бодсон -10.0% (down), цуваа k[6]',
    SECR.road.kpis[0][3] === '-10.0%' && SECR.road.kpis[0][4] === 'down' && JSON.stringify(SECR.road.kpis[0][6]) === '[100,110,99]');
  check('BE27b. replace: c1d/шошго/датасэт тэмдэглэгдэнэ',
    JSON.stringify(SECR.road.c1d) === '[100,110,99]' && SECR.road.c1 === 'Сарын Х' &&
    SECR.road._liveSeries === true && SECR.road._liveSeriesDs === 'Тест датасэт' && SECR.road.c1dYear === 2026);
  const SECA = { rail: { c1: 'x', c1d: [1], kpis: [['A', '1', 'вагон', '—', 'flat']], _liveKpis: true } };
  mkPaxRaw.call({ _sectorSeries: { rail: { year: 2026, counts: JAN_AUG.slice(), lastMonth: 8 } },
    setState() {}, setSourceMeta() {} }, SECA, SS26, { rail_pax: { head: [], notes: [], rows: [] } }, st26, 'rail');
  check('BE27b. append (rail): KPI мөрийг ЭНД хөндөхгүй — вагоны apply залгана',
    SECA.rail.kpis.length === 1 && SECA.rail.kpis[0][0] === 'A');
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
  check('BE29. t05-ийн холбогдоогүй 2 слот шалтгаантай', ['road', 'water'].every((k) =>
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

  /* ══ BE30–BE32. Авто замын ТЕХНИКИЙН ХЯНАЛТЫН ҮЗЛЭГ (2026-09-23) ══
     Эх сурвалж: etransport-backend /api/sectors/road/inspections ←
     silver.road_inspections ← Veritech road.veritech.inspections.
     Фикстур нь хэрэглэгчийн ирүүлсэн ЭХ СИСТЕМИЙН ЭКСПОРТЫН (2026-09-21,
     2,790 мөр) бодит дүн — backend-ийн probe-inspections-export.js-ээр
     бүх мөрөөр тооцсон: тэнцээгүй 202, тэнцсэн 2,417 + БЗЗ 171, ТХ 2,692,
     хэсгээр: ерөнхий 107 · тоормос 68 · жол.мех 52 · гэрэл 69 · утаа 51 ·
     дуу чимээ 8 (нийт 355 — үзлэгийн тооноос ИХ, учир нь нэг үзлэг хэд
     хэдэн хэсгээр тэнцэхгүй байж болно). Хүлээгдэх утга бүр ГАРААР бодсон. */
  const INSP_LIVE = { sector: 'road', metric: 'inspections', status: 'ok', date: '2026-09-21',
    unit: 'үзлэг', measure: 'Техникийн хяналтын үзлэгийн тоо',
    count: 2790, passed: 2588, passed_strict: 2417, passed_minor: 171, failed: 202,
    unknown_result: 0, vehicle_count: 2692,
    failed_by_category: { general: 107, brake: 68, steering: 52, light: 69, emission: 51, noise: 8 },
    unchecked_emission: 128,
    by_day: [{ date: '2026-09-20', count: 2600, failed: 180 }, { date: '2026-09-21', count: 2790, failed: 202 }],
    by_aimag: [{ aimag: 'Улаанбаатар', count: 1621, failed: 120 }, { aimag: 'Орхон', count: 131, failed: 9 },
      { aimag: 'Өмнөговь', count: 124, failed: 7 }] };

  /* ── BE30. roadInspectionsToValue() — цэвэр хөрвүүлэлт ── */
  const is30 = dcScript().match(/function roadInspectionsToValue\(json\)\{([\s\S]*?)\n\}/);
  if (!is30) { bad('BE30. roadInspectionsToValue() олдсонгүй'); return; }
  const toI = new Function('json', is30[1]);
  const i1 = toI(INSP_LIVE);
  check('BE30. count 2,790 · огноо 2026-09-21 · нэгж "үзлэг"',
    !!i1 && i1.count === 2790 && i1.date === '2026-09-21' && i1.unit === 'үзлэг', JSON.stringify(i1 && i1.count));
  check('BE30. Шошго нь ОГНОО (сарын нэр БИШ — хоногийн датаг сар мэт харуулахгүй)',
    !!i1 && i1.monthLabel === '2026-09-21' && !/сар/.test(String(i1.monthLabel)));
  check('BE30. Тэнцсэн (2,588 = 2,417 + БЗЗ 171) ба тэнцээгүй (202) дамжина',
    !!i1 && i1.passed === 2588 && i1.passedMinor === 171 && i1.failed === 202);
  check('BE30. ТХ-ийн тоо ТУСАД нь (2,692 ≠ 2,790 үзлэг — 98 ТХ хоёр удаа)',
    !!i1 && i1.vehicleCount === 2692 && i1.vehicleCount !== i1.count);
  check('BE30. Хэсгийн задаргаа бүтнээр (нийлбэр 355)',
    !!i1 && Object.values(i1.failedBy).reduce((a, v) => a + v, 0) === 355, JSON.stringify(i1 && i1.failedBy));
  check('BE30. "Шалгаагүй" утаа (128) хадгалагдана — тэнцсэн гэж ЗОХИОХГҮЙ',
    !!i1 && i1.uncheckedEmission === 128);
  check('BE30. by_day / by_aimag хадгалагдана (spark ба багана эднээс)',
    !!i1 && i1.byDay.length === 2 && i1.byAimag.length === 3);
  check('BE30. status:"no_data" → null', toI({ status: 'no_data', message: 'Мэдээлэл алга', count: null }) === null);
  check('BE30. Хариугүй → null', toI(null) === null && toI(undefined) === null);
  check('BE30. count дутуу/хоосон/тоон бус/сөрөг → null (тоо ЗОХИОХГҮЙ)',
    toI({ status: 'ok', date: '2026-09-21' }) === null && toI({ status: 'ok', count: '' }) === null &&
    toI({ status: 'ok', count: 'тодорхойгүй' }) === null && toI({ status: 'ok', count: -3 }) === null);
  check('BE30. count 0 бол 0 (бодит тэг ≠ дата алга)', (toI({ status: 'ok', count: 0 }) || {}).count === 0);
  check('BE30. Дутуу задаргаа → null (0 гэж ХУДАЛ харуулахгүй)',
    (toI({ status: 'ok', count: 5 }) || {}).failed === null &&
    (toI({ status: 'ok', count: 5 }) || {}).failedBy.brake === null &&
    JSON.stringify((toI({ status: 'ok', count: 5 }) || {}).byAimag) === '[]');
  check('BE30. Сайт үзлэгийг roadInspectionsToValue-ээр хөрвүүлнэ',
    dcScript().includes('this._roadInspections=roadInspectionsToValue(d)') &&
    dcScript().includes("if(!EHBackend.fetchRoadInspections) return;"));
  /* ══ BE33. Техникийн хяналтын үзлэгийн ДҮГНЭЛТ (roadInspectAnalysis) ══
     Гараар бодсон фикстур: 2026-09-23 (Лхагва) 100/10 · 2026-09-26 (Бямба)
     50/5 · 2026-09-28 (Даваа) 200/30 → нийт 350, тэнцээгүй 45 (12.857%).
     Гариг: Даваа 200, Лхагва 100 → ажлын дундаж 150; Бямба 50 → амралт 50.
     Аймаг: Улаанбаатар 270 + Дорнод 30 = 300 → 90.0%. Хэсэг: тоормос 6 (нийлбэр 13). */
  const fm33src = dcScript().match(/function fillTpl\(s,v\)\{([\s\S]*?)\n\}/);
  const ra33src = dcScript().match(/function roadInspectAnalysis\(w,T,fmt,age,staleAfter\)\{([\s\S]*?)\n\}/);
  if (!fm33src || !ra33src) { bad('BE33. fillTpl()/roadInspectAnalysis() олдсонгүй'); }
  else {
    const fillTpl33 = new Function('s', 'v', fm33src[1]);
    const RA = new Function('fillTpl', 'return function roadInspectAnalysis(w,T,fmt,age,staleAfter){' + ra33src[1] + '\n};')(fillTpl33);
    const T33 = { wd: ['Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя', 'Ня'],
      cats: ['Ерөнхий', 'Тоормос', 'Жолооны механизм', 'Гэрэл', 'Утаа', 'Дуу чимээ'],
      s_total: '{days}|{total}|{failed}|{rate}', s_peak: '{peakDate}|{peak}|{lowDate}|{low}',
      s_week_lower: 'L|{we}|{wk}|{pct}', s_week_higher: 'H|{we}|{wk}|{pct}',
      s_top: '{top}|{share}|{count}|{n}', s_cat: '{cat}|{pct}', s_stale: '{date}|{age}' };
    const fx33 = { status: 'ok', count: 350, date: '2026-09-28', vehicleCount: 300,
      byDay: [{ date: '2026-09-23', count: 100, failed: 10 }, { date: '2026-09-26', count: 50, failed: 5 },
        { date: '2026-09-28', count: 200, failed: 30 }],
      byAimag: [{ aimag: 'Улаанбаатар', count: 270, failed: 20 }, { aimag: 'Дорнод', count: 30, failed: 5 }],
      failedBy: { general: 4, brake: 6, steering: 0, light: 3, emission: 0, noise: 0 } };
    const same33 = (x) => String(x);
    const a33 = RA(fx33, T33, same33, 17, 8);
    check('BE33. Нийт 350 · тэнцээгүй 45 · 12.9% (тэнцээгүйн хоногоор бодно)',
      !!a33 && a33.total === 350 && a33.failedSum === 45 && a33.lines[0] === '3|350|45|12.9', a33 && a33.lines[0]);
    check('BE33. Хамгийн их 09-28 (200) · хамгийн бага 09-26 (50)',
      !!a33 && a33.lines[1] === '2026-09-28|200|2026-09-26|50', a33 && a33.lines[1]);
    check('BE33. Амралт (50) < ажлын өдөр (150) → "бага" өгүүлбэр, 67%',
      !!a33 && a33.lines[2] === 'L|50|150|67', a33 && a33.lines[2]);
    check('BE33. Аймаг: Улаанбаатар 90.0% (270 / 300), 2 аймагт бүртгэл',
      !!a33 && a33.lines[3] === 'Улаанбаатар|90.0|270|2', a33 && a33.lines[3]);
    check('BE33. Гол шалтгаан = тоормос, 46.2% (6 / 13)',
      !!a33 && a33.lines[4] === 'Тоормос|46.2', a33 && a33.lines[4]);
    check('BE33. Шинэчлэгдээгүй (17 > 8 хоног) → сэрэмжлүүлгийн өгүүлбэр',
      !!a33 && a33.stale === true && a33.lines[5] === '2026-09-28|17' && a33.lines.length === 6);
    check('BE33. Гаригийн дундаж: Даваа 200, Лхагва 100, Бямба 50 (Даваа=0 ... Ням=6)',
      !!a33 && a33.weekday[0].avg === 200 && a33.weekday[2].avg === 100 && a33.weekday[5].avg === 50 &&
      a33.weekday[1].avg === 0 && a33.weekday[6].avg === 0, a33 && JSON.stringify(a33.weekday));
    const b33 = RA(fx33, T33, same33, 3, 8);
    check('BE33. Шинэ өгөгдөл (3 ≤ 8 хоног) → сэрэмжлүүлэг ГАРАХГҮЙ',
      !!b33 && b33.stale === false && b33.lines.length === 5 && !b33.lines.some((l) => /\|17$/.test(l)));
    const eqDays = { status: 'ok', count: 100, date: '2026-09-28',
      byDay: [{ date: '2026-09-23', count: 100, failed: 0 }, { date: '2026-09-26', count: 100, failed: 0 }] };
    const c33 = RA(eqDays, T33, same33, null, 8);
    check('BE33. Ажлын/амралтын дундаж тэнцүү → харьцуулах өгүүлбэр ГАРАХГҮЙ',
      !!c33 && !c33.lines.some((l) => /^[LH]\|/.test(l)), c33 && JSON.stringify(c33.lines));
    const d33 = RA({ status: 'ok', count: 100, date: '2026-09-28', byDay: [{ date: '2026-09-23', count: 100 }] },
      T33, same33, null, 8);
    check('BE33. Тэнцээгүй тоо байхгүй хоног → хувь ТООЦООЛОХГҮЙ (NaN / 0% гэж ЗОХИОХГҮЙ)',
      !!d33 && d33.rate === null && d33.total === 0 && !d33.lines.some((l) => /NaN|%/.test(l)), d33 && JSON.stringify(d33.lines));
    check('BE33. Өгөгдөл алга / count null → null (хуудас "мэдээлэл алга" харуулна)',
      RA(null, T33, same33, null, 8) === null && RA({ status: 'no_data', count: null }, T33, same33, null, 8) === null);
    check('BE33. Хэсгийн задаргаа алга → шалтгааны өгүүлбэр ГАРАХГҮЙ (0 гэж зохиохгүй)',
      (RA({ status: 'ok', count: 5, date: '2026-09-28', byDay: [] }, T33, same33, null, 8) || {}).catSum === 0);
    /* MA7 ба хоорондын харьцуулалт — гараар бодсон: 09-01…09-07 = 100/хоног,
       09-08…09-14 = 200/хоног. MA7[5] null (бүтэн 7 хоног биш), MA7[6] = 100,
       MA7[13] = 200. Сүүлийн 7 хоног 200 vs өмнөх 100 → +100.0% (өсөх). */
    const TT33 = { ...T33, s_trend_up: "UP|{cur}|{prev}|{pct}", s_trend_down: "DN|{cur}|{prev}|{pct}" };
    const mkDays = (lo, hi) => Array.from({ length: 14 }, (_, i) => ({
      date: "2026-09-" + String(i + 1).padStart(2, "0"), count: i < 7 ? lo : hi, failed: 0 }));
    const up33 = RA({ status: "ok", count: 200, date: "2026-09-14", byDay: mkDays(100, 200) }, TT33, same33, null, 8);
    check("BE33. MA7: эхний 6 өдөр null, 7 дэх = 100, сүүлийн = 200 (ГАРААР бодов)",
      !!up33 && up33.ma7[5] === null && up33.ma7[6] === 100 && up33.ma7[13] === 200, up33 && JSON.stringify(up33.ma7));
    check("BE33. Хандлага: 14 хоног → сүүлийн 7 (200) vs өмнөх 7 (100) = өсөлт +100.0%",
      !!up33 && up33.trend && up33.trend.cur === 200 && up33.trend.prev === 100 && up33.trend.pct === 100 &&
      up33.lines.includes("UP|200|100|100.0"), up33 && JSON.stringify(up33.lines));
    const dn33 = RA({ status: "ok", count: 100, date: "2026-09-14", byDay: mkDays(200, 100) }, TT33, same33, null, 8);
    check("BE33. Буурсан үед \"DN\" загвар сонгогдоно (өсөлт БИШ)",
      !!dn33 && dn33.lines.some((l) => l.startsWith("DN|")) && !dn33.lines.some((l) => l.startsWith("UP|")), dn33 && JSON.stringify(dn33.lines));
    check("BE33. 13 хоног (14-өөс бага) → хандлага ГАРАХГҮЙ (богино цуваа дээр таамаглахгүй)",
      (() => { const r = RA({ status: "ok", count: 100, date: "2026-09-13", byDay: mkDays(100, 200).slice(1) }, TT33, same33, null, 8);
        return !!r && r.trend === null && !r.lines.some((l) => /^(UP|DN)\|/.test(l)); })());
    check('BE33. fillTpl: үл мэдэгдэх нүд хэвээр үлдэнэ (хоосон болгохгүй)',
      fillTpl33('a {x} b {y}', { x: 1 }) === 'a 1 b {y}');
  }
  /* Загварын <sc-if> нь index.html-д (dc скриптийн гадна) байдаг тул тэрийг уншина. */
  const idxH = read('index.html');
  check('BE33. Хуудас road-ийн үзлэгт дүгнэлт/график, бусад датасэтэд trend-rank хэвээр',
    dcScript().includes("const roadExtra=(isRoadInspect&&this.state.page==='detail')?this.buildRoadInspectExtra():{};") &&
    /* ачаа тээвэр ба салбарын нэгтгэл (2026-10-19) өөрийн самбартай — ерөнхий trend-rank-аас мөн хасагдана */
    dcScript().includes("notRoadInspect:!isRoadInspect&&!isFreight&&!isSumTotal&&!isRoadPax,...roadExtra,") &&
    idxH.includes('<sc-if value="{{ detail.notRoadInspect }}">') &&
    idxH.includes('<sc-if value="{{ detail.isRoadInspect }}">'));
  check('BE33. Дүгнэлтийн бүх текст content.json → site.road_insp-д бүртгэгдсэн (шинэ хардкод текст алга)',
    ['summary_title', 'map_title', 'rank_title', 'daily_title', 'cats_title', 'week_title', 'kpi_total',
      's_total', 's_peak', 's_week_lower', 's_week_higher', 's_top', 's_cat', 's_stale', 'day_title',
      'region_title', 'region_none', 'rank_rest', 'map_nogeo', 'no_data', 'wd_mon', 'wd_sun',
      's_trend_up', 's_trend_down', 'ma_label'].every((k) =>
      readJson('content.json').site.road_insp && readJson('content.json').site.road_insp[k] != null));
  check('BE33. Гар утас: .eh-ri-row нэг багана (@640px)',
    /@media \(max-width:\s*640px\)[\s\S]*\.eh-ri-row\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/.test(read('style.css')));

  /* Модулийг vm дотор ачаалж URL-ийг ЯГ шалгана (BE3-ийн ижил зарчим):
     endpoint-ийг андуурвал road-ийн summary (замын ачаалал) руу унаж,
     үзлэгийн тоог ӨӨР хэмжигдэхүүнээр солих байв. */
  const ins = load('https://x.test', okJson(INSP_LIVE));
  const rIns = await ins.B.fetchRoadInspections();
  check('BE30. URL = BASE + /api/sectors/road/inspections',
    ins.calls[0] === 'https://x.test/api/sectors/road/inspections', ins.calls[0]);
  check('BE30. JSON хариу дамжина (count 2,790)', !!rIns && rIns.count === 2790);
  const insN = load('https://x.test', () => Promise.reject(new Error('net down')));
  check('BE30. Сүлжээний алдаа → null (сайт унахгүй)', (await insN.B.fetchRoadInspections()) === null);
  const insH = load('https://x.test', () => Promise.resolve({ ok: false, status: 404 }));
  check('BE30. HTTP 404 (endpoint суулгагдаагүй) → null, статик тоо хэвээр',
    (await insH.B.fetchRoadInspections()) === null);
  const insOff = load('', okJson(INSP_LIVE));
  check('BE30. BASE хоосон → хүсэлт ОГТ явахгүй',
    insOff.calls.length === 0 && (await insOff.B.fetchRoadInspections()) === null);

  /* ── BE31. applyRoadInspectionData() — ГАРААР БОДОХ фикстур ──
     Тоо · НЭГЖИЙН ШОШГО · МӨРИЙН НЭР · ӨӨРЧЛӨЛТИЙН ХУВЬ · SPARK
     тавыг ХАМТ шалгана (аль нэг нь хуучнаараа үлдвэл хуудас ХУДАЛ
     тайлбарлана). dataAgeDays/INSPECT_STALE_DAYS-ийг ГАДНААС өгнө. */
  const irm = dcScript().match(/\n  applyRoadInspectionData\(\)\{([\s\S]*?)\n  \}\n/);
  if (!irm) { bad('BE31. applyRoadInspectionData() олдсонгүй'); return; }
  const mkInsp = new Function('SECTORS', 'DS_SCHEMA', 'stxt', 'fmtNum', 'dataAgeDays', 'INSPECT_STALE_DAYS',
    'return function(){' + irm[1] + '}');
  const RTXT = {
    'sector_kpi_road_live.0': 'ХОНОГИЙН ҮЗЛЭГ', 'sector_kpi_road_live.1': 'ТЭНЦЭЭГҮЙ',
    'sector_kpi_road_live.2': 'ШАЛГАСАН ТХ', 'unit.inspection': 'үзлэг',
    'status.road_inspect_asof': 'Хоногийн мэдээ:', 'status.road_inspect_stale': 'хоног шинэчлэгдээгүй',
    'status.road_inspect_compare': 'өмнөх бүртгэлтэй хоногтой харьцуулбал',
    'status.no_compare': 'харьцуулах өгөгдөл алга',
    'road_fail_cats.0': 'Ерөнхий', 'road_fail_cats.1': 'Тоормос', 'road_fail_cats.2': 'Жолооны механизм',
    'road_fail_cats.3': 'Гэрэл', 'road_fail_cats.4': 'Утаа', 'road_fail_cats.5': 'Дуу чимээ',
    'sector_rank_road_live': 'Тэнцээгүй шалтгааны бүтэц (хэсгээр)',
    'sector_chart2_road_live': 'Аймаг тус бүрийн үзлэг',
    'chart.daily_trend': 'хоногийн чиг хандлага',
    'ds_schema_road_inspect.head.0': 'Аймаг, нийслэл', 'ds_schema_road_inspect.head.1': 'Үзлэг',
    'ds_schema_road_inspect.head.2': 'Тэнцсэн', 'ds_schema_road_inspect.head.3': 'Тэнцээгүй',
    'ds_schema_road_inspect.head.4': 'Тэнцээгүй хувь', 'ds_schema_road_inspect.head.5': 'Эзлэх хувь',
    'ds_schema_road_inspect.head.6': 'Төлөв',
    'ds_schema_road_inspect.st_fail': 'Тэнцээгүй бүртгэгдсэн',
    'ds_schema_road_inspect.st_clean': 'Бүгд тэнцсэн'
  };
  const runInsp = (live, ageDays) => {
    const SEC = { road: { label: 'Авто зам', kpis: [['НИЙТ ЗАМ', '48,210', 'км', '+2.1%', 'up']],
      rt: 'Замын ангиллын хуваарилалт', rank: [['Орон нутгийн', '19,410', '40.3%']],
      c2: 'Аймаг тус бүрийн ачаалал', bars: [['Улаанбаатар', 92, '214,300']] } };
    const ctx = { _roadInspections: live, _meta: null, _st: null,
      setSourceMeta(id, m) { this._meta = { id, m } }, setState(s) { this._st = s } };
    /* Датасэтийн хуудасны схем — вагоны DS_SCHEMA.rail_wagon-той ижил
       зарчим. Анхны төлөв нь ХООСОН мөр (зохиомол дата алга). */
    const DSS = { road_inspect: { head: [], types: [], notes: [], rows: [] } };
    mkInsp(SEC, DSS, (p, f) => (RTXT[p] !== undefined ? RTXT[p] : f),
      (n) => Number(n).toLocaleString('en-US'),
      () => (ageDays === undefined ? 1 : ageDays), 8).call(ctx);
    return { SEC, ctx, DSS };
  };
  const I = runInsp(toI(INSP_LIVE));
  const ir = I.SEC.road.kpis;
  check('BE31. 3 мөр үүснэ (үзлэг / тэнцээгүй / ТХ)', ir.length === 3, JSON.stringify(ir));
  check('BE31. kpis[0] = ХОНОГИЙН ҮЗЛЭГ · 2,790 · үзлэг',
    ir[0][0] === 'ХОНОГИЙН ҮЗЛЭГ' && ir[0][1] === '2,790' && ir[0][2] === 'үзлэг', JSON.stringify(ir[0]));
  /* (2790 − 2600) / 2600 × 100 = 7.3077 → "+7.3%" (ГАРААР) */
  check('BE31. Өмнөх хоногтой харьцуулсан хувь = +7.3% (by_day-аас, ЗОХИОМОЛ БИШ)',
    ir[0][3] === '+7.3%' && ir[0][4] === 'up', JSON.stringify([ir[0][3], ir[0][4]]));
  check('BE31. Харьцуулалт ЯМАР өдөртэй болохыг хэлнэ (2026-09-20)',
    /өмнөх бүртгэлтэй хоногтой харьцуулбал \(2026-09-20\)/.test(ir[0][5]), JSON.stringify(ir[0][5]));
  check('BE31. spark нь БОДИТ хоногийн цуваа (k[6] = [2600, 2790])',
    JSON.stringify(ir[0][6]) === '[2600,2790]', JSON.stringify(ir[0][6]));
  /* Цувааны ТАЙЛБАР мөр дээрээ (k[7]): виджетийн ерөнхий "12 сарын чиг
     хандлага" нь 30 хоногийн график дээр ХУДАЛ уншигдана. */
  check('BE31. Цувааны тайлбар мөрийн ӨӨРИЙНХ ("хоногийн чиг хандлага")',
    ir[0][7] === 'хоногийн чиг хандлага' && !/сарын/.test(String(ir[0][7])), JSON.stringify(ir[0][7]));
  /* ТЭНЦЭЭГҮЙ мөрийн spark нь ТЭНЦЭЭГҮЙН цуваа — үзлэгийн цувааг ДАХИН
     хэрэглэвэл хоёр мөр ижил график зурж, хандлагыг ХУДАЛ харуулна. */
  check('BE31. ТЭНЦЭЭГҮЙ мөрийн spark = тэнцээгүйн хоногийн цуваа [180, 202]',
    JSON.stringify(ir[1][6]) === '[180,202]' && ir[1][7] === 'хоногийн чиг хандлага',
    JSON.stringify(ir[1][6]));
  check('BE31. failed цуваа дутуу өдөртэй бол spark ОГТ гарахгүй (зохиохгүй)',
    runInsp(toI(Object.assign({}, INSP_LIVE, { by_day: [{ date: '2026-09-20', count: 2600 },
      { date: '2026-09-21', count: 2790, failed: 202 }] }))).SEC.road.kpis[1][6] === null);
  /* 202 / 2790 × 100 = 7.2401 → "7.2%" (ГАРААР) */
  check('BE31. kpis[1] = ТЭНЦЭЭГҮЙ · 202 · 7.2%',
    ir[1][0] === 'ТЭНЦЭЭГҮЙ' && ir[1][1] === '202' && ir[1][2] === '7.2%', JSON.stringify(ir[1]));
  check('BE31. kpis[2] = ШАЛГАСАН ТХ · 2,692 · нэгжгүй ("үзлэг" гэвэл ХУДАЛ)',
    ir[2][0] === 'ШАЛГАСАН ТХ' && ir[2][1] === '2,692' && ir[2][2] === '', JSON.stringify(ir[2]));
  check('BE31. Мөр бүр ЯМАР ӨДРИЙН тоо болохоо хэлнэ',
    ir.every((r) => String(r[5] || '').includes('Хоногийн мэдээ: 2026-09-21')), JSON.stringify(ir[0][5]));
  check('BE31. Хуучин статик мөр (48,210 км) БҮРЭН солигдоно',
    !JSON.stringify(ir).includes('48,210') && !JSON.stringify(ir).includes('НИЙТ ЗАМ'));
  check('BE31. _liveKpis=true', I.SEC.road._liveKpis === true);
  check('BE31. u07-ийн огноо roadInspect мета руу бичигдэнэ',
    I.ctx._meta && I.ctx._meta.id === 'roadInspect' && I.ctx._meta.m.updatedAt === '2026-09-21',
    JSON.stringify(I.ctx._meta));
  /* Хэсгийн бүтэц: 107/355 = 30.1% (ГАРААР), эрэмбэ нь буурахаар */
  check('BE31. Бүтэц = тэнцээгүй шалтгаан, эрэмбэ буурахаар, хувь нь ХЭСГҮҮДИЙН нийлбэрээс',
    I.SEC.road.rt === 'Тэнцээгүй шалтгааны бүтэц (хэсгээр)' &&
    JSON.stringify(I.SEC.road.rank) === JSON.stringify([['Ерөнхий', '107', '30.1%'], ['Гэрэл', '69', '19.4%'],
      ['Тоормос', '68', '19.2%'], ['Жолооны механизм', '52', '14.6%'], ['Утаа', '51', '14.4%'],
      ['Дуу чимээ', '8', '2.3%']]), JSON.stringify(I.SEC.road.rank));
  check('BE31. Зохиомол бүтэц (19,410 км · 40.3%) БҮРЭН солигдоно',
    !JSON.stringify(I.SEC.road.rank).includes('19,410'));
  check('BE31. Багана = аймгийн үзлэг, хамгийн их нь 100%',
    I.SEC.road.c2 === 'Аймаг тус бүрийн үзлэг' &&
    JSON.stringify(I.SEC.road.bars) === JSON.stringify([['Улаанбаатар', 100, '1,621 үзлэг'],
      ['Орхон', 8, '131 үзлэг'], ['Өмнөговь', 8, '124 үзлэг']]), JSON.stringify(I.SEC.road.bars));
  check('BE31. Зохиомол багана (214,300) БҮРЭН солигдоно',
    !JSON.stringify(I.SEC.road.bars).includes('214,300'));
  const I0 = runInsp(null);
  check('BE31. Дата ирээгүй → SECTORS.road ОГТ хөндөгдөхгүй',
    I0.SEC.road.kpis.length === 1 && I0.SEC.road.kpis[0][1] === '48,210' && !I0.SEC.road._liveKpis &&
    I0.SEC.road.rt === 'Замын ангиллын хуваарилалт');
  const I1 = runInsp(toI({ status: 'ok', count: 900, date: '2026-09-21' }));
  check('BE31. Дутуу талбар → тэр мөр ОГТ гарахгүй, хувь "—"',
    I1.SEC.road.kpis.length === 1 && I1.SEC.road.kpis[0][1] === '900' && I1.SEC.road.kpis[0][3] === '—' &&
    /харьцуулах өгөгдөл алга/.test(I1.SEC.road.kpis[0][5]), JSON.stringify(I1.SEC.road.kpis));
  check('BE31. Цуваа нэг өдөр → харьцуулалт ЗОХИОХГҮЙ',
    runInsp(toI(Object.assign({}, INSP_LIVE, { by_day: [{ date: '2026-09-21', count: 2790 }] })))
      .SEC.road.kpis[0][3] === '—');
  /* ХОЦРОЛТ: үзлэгийн ETL 7 хоногт нэг тул 8 хоног = ХЭВИЙН, 9 = хоцорсон */
  const iedge = (n) => String(runInsp(toI(INSP_LIVE), n).SEC.road.kpis[0][5] || '');
  check('BE31. 8 хоног = ХЭВИЙН (7 хоногийн ETL — сэрэмжлүүлэг алга)',
    !/шинэчлэгдээгүй/.test(iedge(8)), iedge(8));
  check('BE31. 9 хоног = хоцорсон гэж ил хэлнэ', /9 хоног шинэчлэгдээгүй/.test(iedge(9)), iedge(9));
  check('BE31. Хоцролт нь харьцуулалтын тайлбарыг СОЛИНО (хөл бичиг таслагдахгүй)',
    !/харьцуулах|харьцуулбал/.test(iedge(9)) && iedge(9).length <= 40, iedge(9).length + ' ' + iedge(9));
  const IN = runInsp(toI(Object.assign({}, INSP_LIVE, { date: null })), null);
  check('BE31. Огноогүй хариу → огноо ЗОХИОХГҮЙ',
    !/Хоногийн мэдээ/.test(IN.SEC.road.kpis[0][5]), JSON.stringify(IN.SEC.road.kpis[0][5]));
  /* ── BE31b. k04/ls-ийн ХӨЛ БИЧИГ ба SPARK — мөрийн өөрийн цуваатай үед ──
     Регресс: k04-ийн "12 сарын чиг хандлага" ба ls-ийн "өмнөх сартай
     харьцуулбал · 12 сарын график" нь ХОНОГИЙН мөрөнд ХУДАЛ (browser-оор
     илрүүлэв: 2,790 үзлэг · +7.3% гэсэн мөрийн доор "12 сарын" гэж
     бичигдэж байв). Мөр өөрийн тайлбартай бол түүнийг үзүүлнэ. */
  /* pathFor-ыг ГАДНААС: spark-ийн ЗАМ өөрөө энэ тестийн сэдэв биш —
     цуваа байгаа/байхгүйгээс хамаарах хөл бичиг л сэдэв. */
  const pathForStub = (data) => ({ line: 'M0,0 L' + (data || []).length + ',0' });
  const bk = dcScript().match(/\n  buildKpis\(kpis,color,verified,spec,foot\)\{([\s\S]*?)\n  \}\n/);
  if (!bk) { bad('BE31b. buildKpis() олдсонгүй'); return; }
  const buildKpis = new Function('pathFor', 'stxt', 'return function(kpis,color,verified,spec,foot){' + bk[1] + '}')
    (pathForStub, (p, f) => f);
  const dayRow = ['ХОНОГИЙН ҮЗЛЭГ', '2,790', 'үзлэг', '+7.3%', 'up', 'нот', [2600, 2790], 'хоногийн чиг хандлага'];
  const monRow = ['ЗОРЧИГЧ / САР', '148,470', 'зорчигч', '+1.2%', 'up', 'нот', [143220, 148470]];
  const noSer = ['ШАЛГАСАН ТХ', '2,692', '', '—', 'flat', 'нот'];
  const bkOut = buildKpis([dayRow, monRow, noSer], '#000', true, null, '12 сарын чиг хандлага');
  check('BE31b. Хоногийн мөр ерөнхий "12 сарын" хөл бичгийг НУУНА',
    bkOut[0].footNote === 'хоногийн чиг хандлага' && bkOut[0].footBaseStyle === 'display:none;' &&
    bkOut[0].footText === 'хоногийн чиг хандлага', JSON.stringify(bkOut[0].footNote));
  check('BE31b. Сарын мөр (өөрийн тайлбаргүй) виджетийн хөл бичгээ ХЭВЭЭР үзүүлнэ',
    bkOut[1].footText === '12 сарын чиг хандлага' && bkOut[1].footBaseStyle === '' &&
    bkOut[1].footNoteStyle === 'display:none;');
  check('BE31b. Цуваагүй мөр "чиг хандлагын цуваа алга" гэж ил хэлнэ',
    bkOut[2].hasSeries === false && /цуваа алга/.test(bkOut[2].footNote));
  check('BE31b. Админы холбоос (data-eh-field="foot") DOM-оос ХАСАГДАХГҮЙ — зөвхөн нуугдана',
    /data-eh-card="k04" data-eh-field="foot" style="\{\{ k\.footBaseStyle \}\}"/.test(read('index.html')));
  check('BE31b. ls-ийн spark мөрийн өөрийн цуваанаас (хавтгай шугам биш)',
    /spark:\(vs&&vs\.spark\)\|\|\(ownSeries\?pathFor\(ownSeries,120,32,3\)\.line:flatSpark\)/.test(dcScript()));
  check('BE31b. Цувааны тайлбар content.json-д бүртгэлтэй',
    readJson('content.json').site.chart.daily_trend === 'хоногийн чиг хандлага');

  /* ══ BE37. ls (01-р зурвас) — ХӨЛ БИЧИГ нь ДЕЛЬТАГИЙН СУУРЬТАЙ таарна ══
     Регресс (browser, 2026-09-28): "НИЙТ НИСЛЭГ 2,450 · +0.9% · өмнөх
     сартай харьцуулбал · 12 сарын график" гэж гарч байв. Гэтэл +0.9% нь
     applyRealFlightsData-ийн YoY (өмнөх ОНЫ мөн сар — агаарын тээвэр
     улирлын хэлбэлзэлтэй тул MoM зориуд хэрэглээгүй), доорх спарклайн нь
     хавтгай 0 шугам. Өөрөөр хэлбэл хөл бичгийн ХОЁР мэдэгдэл ХОЁУЛАА
     худал байв. Мөр өөрийн ҮНЭН тайлбарыг (kpis[0][5]) аль хэдийн
     хадгалдаг тул түүнийг үзүүлнэ. */
  const lsm = dcScript().match(/\.\.\.\(\(\)=>\{\r?\n\s*const hasCmp=[\s\S]*?\}\)\(\),/);
  if (!lsm) { bad('BE37. ls-ийн хөл бичгийн блок олдсонгүй'); return; }
  const lsFoot = new Function('verified', 'vs', 'sk', 'lsFootTxt', 'stxt',
    'return ' + lsm[0].slice(3).replace(/,\s*$/, ''));
  const LSF = 'өмнөх сартай харьцуулбал · 12 сарын график';
  const sx = (p, f) => f;
  const airRow = ['НИЙТ НИСЛЭГ', '2,450', '', '+0.9%', 'up',
    '8 сар · өмнөх оны мөн сартай (8 сар 2025) харьцуулбал'];
  const fAir = lsFoot(true, null, { kpis: [airRow] }, LSF, sx);
  check('BE37. air-ийн YoY дельтаг "өмнөх САРтай" гэж ХУДАЛ тайлбарлахгүй',
    fAir.footText === airRow[5] && !/өмнөх сартай/.test(fAir.footText) &&
    !/12 сарын/.test(fAir.footText), JSON.stringify(fAir.footText));
  check('BE37. Ерөнхий текст НУУГДАНА — DOM-оос ХАСАГДАХГҮЙ (админы холбоос)',
    fAir.footBaseStyle === 'display:none;' && fAir.footNoteStyle === '' &&
    fAir.footNote === airRow[5], JSON.stringify(fAir));
  /* Утгын тохиргоо (widgets.ls.value) нь EHChart.value-ээс МоМ дельта БА
     сарын цуваа ХОЁУЛАА өгдөг — ЗӨВХӨН тэр үед ерөнхий текст үнэн. */
  const fSpec = lsFoot(true, { delta: '+1.2%', spark: 'M0,0 L1,1' }, { kpis: [airRow] }, LSF, sx);
  check('BE37. Тохиргоотой (MoM дельта + сарын цуваа) үед ерөнхий текст ГАРНА',
    fSpec.footText === LSF && fSpec.footBaseStyle === '' &&
    fSpec.footNoteStyle === 'display:none;', JSON.stringify(fSpec));
  check('BE37. Тохиргоотой ч сарын цуваагүй бол "12 сарын график" гэж бичихгүй',
    lsFoot(true, { delta: '+1.2%', spark: null }, { kpis: [airRow] }, LSF, sx).footText === airRow[5]);
  check('BE37. Тохиргоотой ч дельта "—" бол "өмнөх сартай" гэж бичихгүй',
    lsFoot(true, { delta: '—', spark: 'M0,0' }, { kpis: [airRow] }, LSF, sx).footText === airRow[5]);
  const wagRow = ['ХОНОГИЙН АЧИЛТ', '1,069', 'вагон', '—', 'flat',
    'Хоногийн мэдээ: 2026-09-26 · харьцуулах өгөгдөл алга (өмнөх хоногийн дүн ирээгүй)'];
  check('BE37. Дельта "—" (вагон) → мөрийн ӨӨРИЙН тайлбар',
    lsFoot(true, null, { kpis: [wagRow] }, LSF, sx).footText === wagRow[5]);
  check('BE37. Холбогдоогүй салбар → "мэдээлэл алга"',
    lsFoot(false, null, { kpis: [['УСАН ЗАМ', '612', 'км', '0.0%', 'flat']] }, LSF, sx)
      .footText === 'мэдээлэл алга');

  /* ══ BE38. k04 — "—" дельтагийн доор БАЙХГҮЙ харьцуулалт мэдэгдэхгүй ══
     Регресс (browser, 2026-09-28): 04-р хэсгийн 02/03 карт ("ТЭНЦЭЭГҮЙ
     170 —", "ШАЛГАСАН ТХ 2,482 —") доор "Хоногийн мэдээ: 2026-09-25 ·
     өмнөх бүртгэлтэй хоногтой харьцуулбал (2026-09-24)" гэж бичигдэж
     байв — тэр харьцуулалт ЗӨВХӨН мөр 0-д бодогддог. Огноо нь мөр бүрд
     хэрэгтэй тул ЗӨВХӨН харьцуулалтын хэсэг өөрчлөгдөнө. */
  check('BE38. Мөр 0 (дельтатай) харьцуулалтаа ЯГ хэлнэ',
    ir[0][3] === '+7.3%' && /өмнөх бүртгэлтэй хоногтой харьцуулбал \(2026-09-20\)/.test(ir[0][5]),
    JSON.stringify(ir[0][5]));
  check('BE38. "—" мөрүүд БАЙХГҮЙ харьцуулалтыг мэдэгдэхгүй',
    ir[1][3] === '—' && ir[2][3] === '—' &&
    !/харьцуулбал/.test(ir[1][5]) && !/харьцуулбал/.test(ir[2][5]) &&
    /харьцуулах өгөгдөл алга/.test(ir[1][5]) && /харьцуулах өгөгдөл алга/.test(ir[2][5]),
    JSON.stringify([ir[1][5], ir[2][5]]));
  check('BE38. Огноо ("Хоногийн мэдээ") мөр БҮРД хэвээр — 3 мөр гурвуулаа',
    ir.every((r) => String(r[5] || '').includes('Хоногийн мэдээ: 2026-09-21')),
    JSON.stringify(ir.map((r) => r[5])));
  /* buildKpis-ийн НӨӨЦ шошго (мөр өөрийн k[5] огт өгөөгүй үед) */
  const bkNo = buildKpis([['ШАЛГАСАН ТХ', '2,692', '', '—', 'flat'],
    ['НИЙТ ЗОРЧИГЧ', '1.5M', '', '+6.6%', 'up']], '#000', true, null, '12 сарын чиг хандлага');
  check('BE38. Нөөц шошго: дельта "—" → "харьцуулах өгөгдөл алга"',
    bkNo[0].compareLabel === 'харьцуулах өгөгдөл алга' && bkNo[0].deltaGlyph === '',
    JSON.stringify(bkNo[0].compareLabel));
  check('BE38. Нөөц шошго: дельтатай → "өмнөх сартай харьцуулбал"',
    bkNo[1].compareLabel === 'өмнөх сартай харьцуулбал' && bkNo[1].deltaGlyph === '▲',
    JSON.stringify(bkNo[1].compareLabel));
  check('BE38. Нөөц шошго content.json-д бүртгэлтэй (кодод хатуу БИШ)',
    readJson('content.json').site.chart.compare_mom === 'өмнөх сартай харьцуулбал' &&
    !/k\[5\]\|\|'өмнөх сартай харьцуулбал'/.test(dcScript()));

  /* ══ BE39. 05-р хэсэг — ЦУВААГҮЙ үед ГРАФИК ОГТ зурагдахгүй ══
     Регресс (browser, 2026-09-28): Авто зам салбар дээр "САРЫН ДУНДАЖ
     АЧААЛАЛ (МЯНГА) · мэдээлэл алга" гэсэн гарчгийн доор ХАВТГАЙ муруй
     зурагдаж, Y тэнхлэг "-6 -3 0 3 6" (сөрөг "мянган" ачаалал!), X
     тэнхлэг "1-р сар … 11-р сар" гэж бичигдэж байв. */
  const btm = dcScript().match(/\nfunction buildTrendChart\(data,off(?:,partial(?:,noForecast)?)?\)\{([\s\S]*?)\r?\n\}\r?\n/);
  if (!btm) { bad('BE39. buildTrendChart() олдсонгүй'); return; }
  const btc = new Function('MONTHS', 'stxt',
    'return function buildTrendChart(data,off,partial,noForecast){' + btm[1] + '}')(
    ['1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар',
      '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'], sx);
  const zeroCh = btc(new Array(12).fill(0), 0);
  /* ГАРААР: 12 тэг → налуу 0, resid = 0||0||1 = 1, прогнозын зурвас
     ±1.9·(1,2,3) = ±5.7 → niceStep 1 → тэнхлэг −6 … 6. Өөрөөр хэлбэл
     тэг цуваанаас ГАРАЛТАЙ тэнхлэг нь ҮРГЭЛЖ утгагүй сөрөг тоо гаргана. */
  /* 2026-10-15: таамгийн доод хязгаарыг 0-оор хязгаарласан (DG: Y тэнхлэг 0-ээс) —
     тэг цуваа ч сөрөг тэнхлэг гаргахгүй. Тэг цувааг "мэдээлэл алга" болгох нь
     хэвээр зөв (UI4: dsHasTrend нь c1d.some(v>0)-ийг шаардана). */
  check('BE39. Тэг цувааны тэнхлэг сөрөг тоо ГАРГАХГҮЙ (0-ээс эхэлнэ)',
    zeroCh.yTicks.length > 0 && zeroCh.yTicks.every((t) => Number(String(t.label).replace(/,/g, '')) >= 0) &&
    Number(zeroCh.yTicks[0].label) === 0,
    JSON.stringify(zeroCh.yTicks.map((t) => t.label)));
  check('BE39. Цуваатай үед тэнхлэг хэвийн (0-ээс дээш)',
    btc([100, 110, 120, 130], 0).yTicks.every((t) => Number(String(t.label).replace(/,/g, '')) >= 0),
    JSON.stringify(btc([100, 110, 120, 130], 0).yTicks.map((t) => t.label)));
  check('BE39. trend.hasData / noData нь t05Verified-ээс',
    /trend\.hasData=!!t05Verified;/.test(dcScript()) && /trend\.noData=!t05Verified;/.test(dcScript()));
  check('BE39. Хоосон төлөв — тэнхлэггүй тайлбар мөр',
    /<sc-if value="\{\{ trend\.noData \}\}">[\s\S]{0,400}\{\{ trend\.noDataNote \}\}/.test(read('index.html')));
  check('BE39. SVG нь sc-if trend.hasData ДОТОР (тэнхлэг ОГТ зурагдахгүй)',
    /<sc-if value="\{\{ trend\.hasData \}\}">\s*<svg sc-camel-view-box="0 0 600 170" style="width:100%;height:auto;/
      .test(read('index.html')));
  check('BE39. Хоосон төлөвийн текст content.json-д бүртгэлтэй',
    readJson('content.json').site.status.no_series === 'чиг хандлагын цуваа алга');

  check('BE31. reapplyLiveText нь үзлэгийн мөрийг ч ДАХИН барина (нийтэлсэн шошго хүрнэ)',
    /reapplyLiveText\(\)\{[\s\S]*?this\.applyRoadInspectionData\(\);[\s\S]*?this\.recomputeAirData\(\);/.test(dcScript()));

  /* ── BE33. Датасэтийн дэлгэрэнгүйн ХҮСНЭГТ (DS_SCHEMA.road_inspect) ──
     Үзлэгийн датасэт `schema` зарлаагүй байсан тул schemaKey нь салбар
     руу (DS_SCHEMA.road) уначихаж, хуудас нь ЗАМЫН ХӨДӨЛГӨӨНИЙ зохиомол
     мөрүүдийг ("Сансар товчоо 4,820") үзлэгийн дата мэт харуулж, Excel
     татах товч түүнийг файлаар гаргаж байв. Гараар бодох фикстур: УБ
     120/1621 = 7.4028 → 7.4; Орхон 9/131 = 6.8702 → 6.9. */
  check('BE33. Үзлэгийн датасэт ӨӨРИЙН схем зарлана (салбарын схем БИШ)',
    /schema:'road_inspect',source:'roadInspect'/.test(dcScript()));
  check('BE33. DS_SCHEMA.road_inspect анхнаасаа ХООСОН мөртэй (зохиомол дата алга)',
    /road_inspect:\{head:\[[\s\S]*?rows:\[\]\}/.test(dcScript()));
  /* Регресс: "Төлөв" шошго ("Тэнцээгүй бүртгэгдсэн") амьд сайтад 2 мөрөнд
     хуваагдаж байв — 170px багана хэмжээс яг таарч sub-pixel-ээр багтаагүй.
     Шошго ~170px шаардана, тиймээс сүүлийн баганы өргөн ≥ 190 байх ёстой. */
  const wm = /road_inspect:\{head:\[[\s\S]*?widths:\[([\d,\s]+)\]/.exec(dcScript());
  const wv = wm ? wm[1].split(',').map(Number) : [];
  check('BE33. Схемийн widths нь баганын тоотой таарна (7) ба "Төлөв" ≥ 190px (шошго 2 мөр болохгүй)',
    wv.length === 7 && wv[6] >= 190, JSON.stringify(wv));
  const ISch = I.DSS.road_inspect;
  check('BE33. by_aimag-ийн 3 мөр хүснэгтэд буув', ISch.rows.length === 3, JSON.stringify(ISch.rows.length));
  check('BE33. Толгой content.json-оос (7 багана: тэнцсэн/тэнцээгүй/хувь/эзлэх хувь нэмэгдсэн)',
    ISch.head.length === 7 && ISch.head[0] === 'Аймаг, нийслэл' && ISch.head[1] === 'Үзлэг' &&
    ISch.head[4] === 'Тэнцээгүй хувь' && ISch.head[5] === 'Эзлэх хувь', JSON.stringify(ISch.head));
  check('BE33. Мөр 1 = Улаанбаатар · 1,621 · тэнцсэн 1,501 · тэнцээгүй 120 · 7.4% (ГАРААР бодов)',
    ISch.rows[0][0] === 'Улаанбаатар' && ISch.rows[0][1] === 1621 && ISch.rows[0][2] === 1501 &&
    ISch.rows[0][3] === 120 && ISch.rows[0][4] === 7.4, JSON.stringify(ISch.rows[0]));
  check('BE33. Эзлэх хувь = үзлэг / бүх аймгийн нийлбэр (1621 / 1876 = 86.4%)',
    ISch.rows[0][5] === 86.4, JSON.stringify(ISch.rows[0]));
  check('BE33. Мөр 2 = Орхон · 131 · тэнцээгүй 9 · 6.9% (ГАРААР бодов)',
    ISch.rows[1][0] === 'Орхон' && ISch.rows[1][3] === 9 && ISch.rows[1][4] === 6.9, JSON.stringify(ISch.rows[1]));
  check('BE33. Үзлэгийн тоогоор БУУРАХ эрэмбэтэй',
    ISch.rows[0][1] > ISch.rows[1][1] && ISch.rows[1][1] > ISch.rows[2][1]);
  check('BE33. Тэнцээгүйтэй аймаг "warn:", тайлбар нь content.json-оос',
    ISch.rows[0][6] === 'warn:Тэнцээгүй бүртгэгдсэн', ISch.rows[0][6]);
  /* Бүгд тэнцсэн аймаг → "ok:" (хувь 0). Эсрэг тохиолдлыг ЗААВАЛ шалгана:
     эс тэгвэл status үргэлж "warn" байсан ч тест ногоон үлдэнэ. */
  const ICl = runInsp(toI({ ...INSP_LIVE,
    by_aimag: [{ aimag: 'Говьсүмбэр', count: 40, failed: 0 }] })).DSS.road_inspect;
  check('BE33. Тэнцээгүйгүй аймаг → "ok:Бүгд тэнцсэн" · хувь 0',
    ICl.rows[0][4] === 0 && ICl.rows[0][6] === 'ok:Бүгд тэнцсэн' && ICl.rows[0][2] === 40, JSON.stringify(ICl.rows[0]));
  /* by_aimag ирээгүй бол хүснэгтийг ОГТ ХӨНДӨХГҮЙ (хуучин байдал хэвээр) */
  const INo = runInsp(toI({ ...INSP_LIVE, by_aimag: [] })).DSS.road_inspect;
  check('BE33. by_aimag хоосон → мөр ҮҮСГЭХГҮЙ (тоо ЗОХИОХГҮЙ)', INo.rows.length === 0);
  check('BE33. Шинэ харагдах текст content.json-д бүртгэгдсэн',
    (() => { const d = readJson('content.json').site.ds_schema_road_inspect || {};
      return (d.head || []).length === 7 && (d.notes || []).length === 7 &&
        d.st_fail === 'Тэнцээгүй бүртгэгдсэн' && d.st_clean === 'Бүгд тэнцсэн'; })());

  /* ══ BE35. Үзлэгийн ТҮҮХ ба нэгдсэн хугацааны шүүлт ══
     Гараар бодсон фикстур. Сарууд (өдөр/сарын өдөр · үзлэг · тэнцээгүй):
       2019-07  1/31 ·    1 ·   0   (эх сурвалжийн санамсаргүй нэг мөр)
       2025-12  1/31 ·    1 ·   0
       2026-01 31/31 · 1000 · 100   хэсэг: ерөнхий 60 тоормос 30 жол.мех 20
       2026-02 20/28 ·  400 ·  40   (дутуу)  ерөнхий 20 тоормос 10 жол.мех 10
       2026-03 31/31 · 1200 ·  60   ерөнхий 30 тоормос 15 жол.мех 10 гэрэл 5
     2026 I–III: нийт 2,600 · тэнцээгүй 200 (7.7%) · тэнцсэн 2,400 · 82 өдөр
     → өдрийн дундаж 2600/82 = 31.7 → 32 · дутуу сар 1 · хэсгийн нийлбэр 210. */
  {
    const src35 = dcScript();
    const grab35 = (name, args) => {
      const m = src35.match(new RegExp('function ' + name + '\\(' + args + '\\)\\{([\\s\\S]*?)\\n\\}'));
      return m ? m[1] : null;
    };
    const hb = grab35('roadInspectHistoryToValue', 'json');
    const yb = grab35('roadInspectYears', 'months,minDays');
    const pb = grab35('roadInspectPeriod', 'sel,months');
    const mb = grab35('roadInspectPeriodModel', 'P,range');
    if (!hb || !yb || !pb || !mb) { bad('BE35. түүхийн функцүүд олдсонгүй'); }
    else {
      const toVal = new Function('json', hb);
      const years = new Function('INSPECT_MIN_YEAR_DAYS', 'return function(months,minDays){' + yb + '\n};')(28);
      const period = new Function('sel', 'months', pb);
      const model = new Function('P', 'range', mb);
      const mk = (month, days, dim, total, failed, passed, c) => ({ month, days, days_in_month: dim,
        partial: days < dim, total, failed, passed, passed_minor: 0, unknown_result: 0,
        failed_by_category: Object.assign({ general: 0, brake: 0, steering: 0, light: 0, emission: 0, noise: 0 }, c || {}) });
      const MONTHS35 = [
        mk('2019-07', 1, 31, 1, 0, 1), mk('2025-12', 1, 31, 1, 0, 1),
        mk('2026-01', 31, 31, 1000, 100, 900, { general: 60, brake: 30, steering: 20 }),
        mk('2026-02', 20, 28, 400, 40, 360, { general: 20, brake: 10, steering: 10 }),
        mk('2026-03', 31, 31, 1200, 60, 1140, { general: 30, brake: 15, steering: 10, light: 5 })];
      const RES35 = { status: 'ok', months: MONTHS35,
        by_aimag: [{ aimag: 'Улаанбаатар', total: 1800, failed: 120 }, { aimag: 'Орхон', total: 600, failed: 40 }],
        by_weekday: [0, 1, 2, 3, 4, 5, 6].map((k) => ({ weekday: k, days: 10, total: 100 * (k + 1), avg: 10 * (k + 1) })) };
      const H35 = toVal(RES35);
      check('BE35. Түүх задлагдана: 5 сар, 2019-07 → жил 2019 сар 7, аймаг 2, гариг 7',
        !!H35 && H35.months.length === 5 && H35.months[0].year === 2019 && H35.months[0].mon === 7 &&
        H35.byAimag.length === 2 && H35.byWeekday.length === 7, H35 && JSON.stringify(H35.months[0]));
      check('BE35. no_data / null / сарын массивгүй → null (шүүлт нуугдана, тоо зохиохгүй)',
        toVal(null) === null && toVal({ status: 'no_data' }) === null && toVal({ status: 'ok' }) === null);
      check('BE35. Нийт нь тоон биш сар хасагдана (NaN гаргахгүй)',
        toVal({ status: 'ok', months: [mk('2026-01', 1, 31, 'x', 0, 0), mk('2026-02', 1, 28, 5, 0, 5)] }).months.length === 1);
      check('BE35. Жил: бүртгэлтэй өдөр ≥ 28 → зөвхөн 2026 (2019/2025 нэг мөртэй = жил БИШ)',
        JSON.stringify(years(H35.months)) === '[2026]', JSON.stringify(years(H35.months)));
      check('BE35. minDays=1 үед гурван жил (босго үнэхээр ажиллаж байгааг батална)',
        JSON.stringify(years(H35.months, 1)) === '[2019,2025,2026]', JSON.stringify(years(H35.months, 1)));
      const P1 = period({ yFrom: 2026, yTo: 2026, mFrom: 1, mTo: 3 }, H35.months);
      check('BE35. 2026 I–III → 3 сар, тасралтгүй, 2026-01-01 … 2026-03-31',
        P1.months.length === 3 && P1.contiguous && P1.from === '2026-01-01' && P1.to === '2026-03-31', JSON.stringify(P1));
      const P2 = period({ yFrom: 2026, yTo: 2026, mFrom: 2, mTo: 2 }, H35.months);
      check('BE35. 2026-02 → to = 2026-02-28 (сарын сүүлийн өдөр)', P2.to === '2026-02-28', P2.to);
      check('BE35. 2024-02 → to = 2024-02-29 (хоёр дахь жилийн нэмэлт өдөр)',
        period({ yFrom: 2024, yTo: 2024, mFrom: 2, mTo: 2 }, []).to === '2024-02-29');
      check('BE35. Олон жил + хэсэгчилсэн сар → тасралтгүй БИШ (аймаг/гариг тооцохгүй)',
        period({ yFrom: 2025, yTo: 2026, mFrom: 1, mTo: 3 }, H35.months).contiguous === false);
      const PA = period({ yFrom: 2019, yTo: 2026, mFrom: 1, mTo: 12 }, H35.months);
      check('BE35. Бүх жил + 1–12 сар → тасралтгүй, 5 сар, 2019-01-01 … 2026-12-31',
        PA.contiguous && PA.months.length === 5 && PA.from === '2019-01-01' && PA.to === '2026-12-31', JSON.stringify(PA));
      check('BE35. Хагас бичсэн он (2) / сар (13) / NaN → хүчингүй (backend-д 400 явуулахгүй)',
        period({ yFrom: 2, yTo: 2026, mFrom: 1, mTo: 12 }, H35.months).contiguous === false &&
        period({ yFrom: 2026, yTo: 2026, mFrom: 1, mTo: 13 }, H35.months).contiguous === false &&
        period({ yFrom: NaN, yTo: 2026, mFrom: 1, mTo: 12 }, H35.months) === null);
      check('BE35. Эхлэл > төгсгөл үед солигдоно (3–1 сар = 1–3 сар)',
        period({ yFrom: 2026, yTo: 2026, mFrom: 3, mTo: 1 }, H35.months).months.length === 3);
      const RANGE35 = toVal({ status: 'ok', months: MONTHS35.slice(2), by_aimag: RES35.by_aimag, by_weekday: RES35.by_weekday });
      const M = model(P1, RANGE35);
      check('BE35. Нэгтгэл: 2,600 үзлэг · тэнцээгүй 200 · тэнцсэн 2,400 · 82 өдөр',
        M.total === 2600 && M.failed === 200 && M.passed === 2400 && M.days === 82, JSON.stringify([M.total, M.failed, M.passed, M.days]));
      check('BE35. Тэнцээгүй хувь 7.7% · өдрийн дундаж 32 (2600/82)',
        M.rate.toFixed(1) === '7.7' && M.avgPerDay === 32, JSON.stringify([M.rate, M.avgPerDay]));
      check('BE35. Дутуу сар 1 / 3 (2026-02 → 20/28 өдөр)', M.partialCount === 1 && M.monthCount === 3);
      check('BE35. Хэсэг: ерөнхий 110 · тоормос 55 · жол.мех 40 · гэрэл 5, нийлбэр 210, ерөнхий 52.4%',
        M.catSum === 210 && M.cats.find((c) => c.key === 'general').n === 110 &&
        M.cats.find((c) => c.key === 'brake').n === 55 && M.cats.find((c) => c.key === 'light').n === 5 &&
        M.cats.find((c) => c.key === 'general').pct.toFixed(1) === '52.4', JSON.stringify(M.cats));
      check('BE35. Сарын цуваа: 3 мөр, дутуу сар partial:true, 2026-03 хувь 5.0%',
        M.monthly.length === 3 && M.monthly[1].partial === true && M.monthly[2].rate.toFixed(1) === '5.0', JSON.stringify(M.monthly));
      check('BE35. Аймаг: Улаанбаатар 1,800 → 75.0% (аймагтай 2,400-д), Орхон 25.0%',
        M.aimags && M.aimags[0].name === 'Улаанбаатар' && M.aimags[0].share === 75 && M.aimags[1].share === 25,
        JSON.stringify(M.aimags));
      check('BE35. Гариг 7 мөр range-ээс', M.weekday && M.weekday.length === 7);
      const MBAD = model(P1, toVal({ status: 'ok', months: MONTHS35.slice(2, 4), by_aimag: RES35.by_aimag, by_weekday: [] }));
      check('BE35. Мужийн нийлбэр сонголттой таарахгүй (хоцорсон/буруу хариу) → аймаг/гариг ХАРУУЛАХГҮЙ',
        MBAD.aimags === null && MBAD.weekday === null && MBAD.total === 2600);
      const MNC = model(period({ yFrom: 2025, yTo: 2026, mFrom: 1, mTo: 3 }, H35.months), RANGE35);
      check('BE35. Тасралтгүй биш сонголт → аймаг/гариг null, гэхдээ сарын нэгтгэл тооцогдоно',
        MNC.aimags === null && MNC.weekday === null && MNC.total === 2600);
      check('BE35. Сонгосон сар алга → null (хоосон нэгтгэл зохиохгүй)',
        model(period({ yFrom: 2020, yTo: 2020, mFrom: 1, mTo: 12 }, H35.months), RANGE35) === null);
    }
    const idx35 = read('index.html');
    check('BE35. Шүүлт ДЭЭД талд (detail.riF.show) — хүснэгтийн дотор БИШ',
      idx35.includes('<sc-if value="{{ detail.riF.show }}">') &&
      idx35.includes('<sc-if value="{{ detail.ri.period.show }}">') &&
      idx35.includes('<sc-if value="{{ detail.tableFilterOpen }}">') &&
      !idx35.includes('<sc-if value="{{ detail.pvFilterOpen }}">'));
    /* RAW (2026-10-18): түүхий мөрийн хүснэгт нэгдсэн хугацааны шүүлтээс ӨӨР баганатай
       (аймаг, салбар, дүгнэлт…) тул тэр үед л баганын шүүлтийн самбар нээгдэнэ. */
    check('BE35. Нэгдсэн шүүлт байхад нэгтгэлийн хүснэгтийн дотор талын шүүлт ДАВХАРДАХГҮЙ (түүхий мөрөнд л нээгдэнэ)',
      src35.includes("tableFilterOpen:!!this.state.pvFilterOpen&&(!(roadExtra.riF&&roadExtra.riF.available)||!!(this.tableSchema(dsel,dsel.schema||dsel.sector)||{}).raw)"));
    check('BE35. Түүх ирээгүй (null) → панель нуугдана, хуудас өмнөх шигээ',
      src35.includes("const none={riF:{available:false,show:false}") &&
      src35.includes('if(!hist||!sel||!P) return none;'));
    check('BE35. Түүхийн таталт: from/to-г ЗӨВХӨН тасралтгүй мужид, токеноор хоцорсон хариуг үл тооно',
      src35.includes('if(!P||!P.contiguous||typeof EHBackend===') && src35.includes('if(tok!==this._riTok) return;'));
    check('BE35. Backend клиент history endpoint-той',
      read('js/erthub-backend.js').includes("'/api/sectors/road/inspections/history'") &&
      read('js/erthub-backend.js').includes('fetchRoadInspectionsHistory: fetchRoadInspectionsHistory'));
    check('BE35. Шинэ харагдах текст бүр content.json site.road_insp-д бүртгэгдсэн',
      ['f_head', 'f_year', 'f_month', 'f_interval', 'f_by_year', 'f_by_month', 'f_status', 'f_all', 'f_loading',
        'period_title', 'period_scope', 'period_kpi_total', 'period_kpi_failed', 'period_kpi_avg', 'period_kpi_partial',
        'monthly_title', 'month_title', 'monthly_note', 'scope_noncontig', 'scope_loading', 'scope_none'].every((k) =>
        (readJson('content.json').site.road_insp || {})[k] != null) &&
      (readJson('content.json').site.ds_schema_road_inspect || {}).note_period != null);
  }

  /* ── BE34. Hero ticker-ийн зорчигч — цэвэр "0" БИШ ──
     "0 ЗОРЧИГЧ / ӨДӨР" нь "өнөөдөр зорчигч байхгүй" гэж уншигдаж, 04-р
     хэсгийн амьд "148,470 зорчигч/сар"-тай зөрчилдөж байв. */
  check('BE34. hero_px эх сурвалжгүй үед "0" гэж ХУДАЛ тоо гаргахгүй',
    !dcScript().includes("heroPxValue:this.isWidgetMock('hero_px')?'0':") &&
    dcScript().includes("heroPxValue:this.isWidgetMock('hero_px')?'—':"));
  check('BE34. Оронд нь "мэдээлэл алга" гэж ИЛ хэлнэ (status.no_data ДАХИН ашиглав)',
    dcScript().includes("heroPxNote:this.isWidgetMock('hero_px')") &&
    dcScript().includes("stxt('status.no_data'") &&
    read('index.html').includes('{{ heroPxTitle }}</span>{{ heroPxNote }}'));

  /* ── BE35. Админы preview нь үзлэгийн АМЬД тоог уншина ──
     BE30–BE33 сайтын талыг бүрэн шалгасан ч metricValue()-д road-ийн
     салаа БАЙХГҮЙ байсныг барьсангүй: админ "Авто зам 0 / мэдээлэл алга"
     гэж үзүүлэх зэрэгцээ "Слотын чанар" нь "амьд утга" гэсэн ногоон badge
     гаргаж байв. CLAUDE.md §"Тестийн мөчлөг" алхам 3 — ХОЁР талыг ХАМТ.
     (rail-д ижил зорилгын BE16 бий, road-д нь дутуу байв.) */
  check('BE35. Админ үзлэгийг тусад нь (feed-ээс хамааралгүй) уншина',
    adm.includes('function loadRoadInspections()') && adm.includes('EHBackend.fetchRoadInspections()'));
  check('BE35. INSP төлөв RAIL/FEED-ээс ТУСДАА',
    adm.includes("var INSP={state:'idle'") && adm.includes("INSP.state='ready'"));
  check('BE35. metricValue road.inspection_* -г INSP-ээс өгнө (FEED-ээр хаагдахгүй)',
    adm.includes("mk.indexOf('road.inspection')===0") && adm.includes("INSP.state!=='ready'"));
  check('BE35. metricDate road.feed_updated_at-ыг INSP.date-ээс өгнө',
    adm.includes("mk==='road.feed_updated_at'") && adm.includes("INSP.state==='ready'&&INSP.date"));
  /* Функцийг ГАРГАЖ АВААД бодит утган дээр ажиллуулна — regex нь зөвхөн
     "бичигдсэн эсэх"-ийг хэлнэ, УТГА зөв эсэхийг БИШ. */
  const mv35 = adm.match(/function metricValue\(mk\)\{([\s\S]*?)\n\}/);
  const md35 = adm.match(/function metricDate\(mk\)\{([\s\S]*?)\n\}/);
  if (!mv35 || !md35) { bad('BE35. metricValue/metricDate олдсонгүй'); return; }
  /* 7 хоногийн нэгтгэл (ST_METRIC/stWeek) энэ тестэд хамааралгүй — хоосон орчин. */
  const mkMV = new Function('FEED', 'RAIL', 'INSP', 'var ST_METRIC={},stWeek=function(){return null},stWeekVal=stWeek;return function(mk){' + mv35[1] + '}');
  const mkMD = new Function('FEED', 'RAIL', 'INSP', 'return function(mk){' + md35[1] + '}');
  const FEED35 = { state: 'off' }, RAIL35 = { state: 'off' };
  const INSP_R = { state: 'ready', date: '2026-09-21', count: 2790, failed: 202, vehicles: 2692 };
  const mvR = mkMV(FEED35, RAIL35, INSP_R), mdR = mkMD(FEED35, RAIL35, INSP_R);
  check('BE35. feed УНААГҮЙ ч үзлэгийн preview 2,790 гарна (0 БИШ)',
    mvR('road.inspection_count') === 2790 && mvR('road.inspection_kpi_set') === 2790,
    String(mvR('road.inspection_count')));
  check('BE35. Огноо нь INSP-ээс (u07 preview "мэдээлэл алга" болохгүй)',
    mdR('road.feed_updated_at') === '2026-09-21', String(mdR('road.feed_updated_at')));
  const INSP_O = { state: 'off', date: null, count: null };
  const mvO = mkMV(FEED35, RAIL35, INSP_O), mdO = mkMD(FEED35, RAIL35, INSP_O);
  check('BE35. Backend унтарсан → null (тоо ЗОХИОХГҮЙ, 0 ч гаргахгүй)',
    mvO('road.inspection_count') === null && mdO('road.feed_updated_at') === null);
  check('BE35. Мэдэхгүй метрик → null', mvR('road.blah') === null && mvR('zzz') === null);

  /* ── BE36. Зорчигчийн цуваа ДАТАСЭТ болж танигдана ──
     SECTOR_SERIES.rail.dataset нь 'Зорчигчийн галт тэрэгний мэдээ'-г
     заадаг атал DATASETS-д тийм нэртэй бичлэг БАЙХГҮЙ байсан тул
     dsHasTrend() (_liveSeriesDs === dsel.name) хэзээ ч тэнцэхгүй —
     амьд муруй ямар ч датасэтийн хуудсан дээр гардаггүй байв. */
  const dsNames36 = [...dcScript().matchAll(/\{sector:'[a-z]+',name:'([^']+)'/g)].map((m) => m[1]);
  const serDs36 = (dcScript().match(/rail:\{api:'rail',[\s\S]{0,120}?dataset:'([^']+)'/) || [])[1];
  check('BE36. SECTOR_SERIES.rail.dataset нь DATASETS-д БОДИТООР байна',
    !!serDs36 && dsNames36.includes(serDs36), serDs36 + ' / ' + dsNames36.length + ' датасэт');
  check('BE36. Цувааны датасэт railPax эх сурвалжтай',
    /name:'Зорчигчийн галт тэрэгний мэдээ'[\s\S]{0,500}?source:'railPax'/.test(dcScript()));
  check('BE36. SOURCES-д railPax бүртгэлтэй (auditBindings сануулахгүй)',
    dcScript().includes('railPax:{label:'));
  check('BE36. u07-ийн зорчигчийн мөр амьд метад холбогдов',
    /title:'Зорчигчийн галт тэрэгний мэдээ'[\s\S]{0,400}?source:'railPax', bind:\{date:'feedUpdated'\}/.test(dcScript()));
  check('BE36. applySectorSeries нь cfg.source-д мета бичнэ (салбар БҮРД ерөнхий)',
    dcScript().includes('if(cfg.source){') && dcScript().includes('this.setSourceMeta(cfg.source,'));
  check('BE36. Датасэт content.json-д ТӨГСГӨЛД бүртгэгдсэн (индекс гулсахгүй)',
    (() => {
      const ds = readJson('content.json').site.datasets;
      /* Зорчигч индекс 3 хэвээр; дараа нэмэгдсэн нь (ачаа, ачааны нэгтгэл, салбарын нэгтгэл — 2026-10-19;
         авто тээврийн зорчигч — 2026-10-20) ТӨГСГӨЛД */
      return ds[3].name === 'Зорчигчийн галт тэрэгний мэдээ' && ds[3].sector === 'rail' &&
        ds.slice(4).every(d => /^Ачаа тээврийн мэдээ/.test(d.name) || d.name === 'Төмөр замын ачаа тээврийн нэгтгэл' || d.sector === 'total' ||
          d.name === 'Авто тээврийн зорчигч тээврийн мэдээ') &&
        ds[ds.length - 3].name === 'Төмөр замын ачаа тээврийн нэгтгэл' && ds[ds.length - 2].sector === 'total' &&
        ds[ds.length - 1].name === 'Авто тээврийн зорчигч тээврийн мэдээ';
    })());

  /* ── BE37. period_coverage — САРЫН ЦУВААНЫ ГАНЦ ДҮРЭМ ──
     Өмнө нь дүрэм ХОЁР газар ХОЁР ӨӨРӨӨР хатуу бичигдсэн байв: rail нь
     явагдаж буй сарыг ХАСДАГ, air нь сүүлийн дата бүхий сарыг БҮТЭН мэт
     ҮЛДЭЭДЭГ. Иймд t05 дээр air сонговол дуусаагүй 9-р сарын цэг бүтэн
     сартай зэрэгцэж "уналт" мэт уншигдаж байв. */
  const dpm = dcScript().match(/\nfunction dropPartialMonth\(counts,year,cov,now\)\{([\s\S]*?)\n\}\n/);
  if (!dpm) { bad('BE37. dropPartialMonth() олдсонгүй'); return; }
  const covDef = dcScript().match(/const COVERAGE_DEFAULT=(\{[^}]*\});/);
  if (!covDef) { bad('BE37. COVERAGE_DEFAULT олдсонгүй'); return; }
  const drop = new Function('COVERAGE_DEFAULT', 'counts', 'year', 'cov', 'now',
    dpm[1]).bind(null, JSON.parse(covDef[1].replace(/([a-z_]+):/g, '"$1":').replace(/'/g, '"')));
  /* 2026-09-24 12:00 UTC → УБ-д 2026-09-24 20:00, өөрөөр хэлбэл 9-р сар */
  const NOW_0924 = Date.UTC(2026, 8, 24, 12, 0, 0);
  const NINE = [10, 11, 12, 13, 14, 15, 16, 17, 18];
  const d1 = drop(NINE.slice(), 2026, null, NOW_0924);
  check('BE37. Явагдаж буй 9-р сар хасагдаж 8 цэг үлдэнэ',
    d1.counts.length === 8 && d1.counts[7] === 17, JSON.stringify(d1.counts));
  check('BE37. Хасагдсан сарыг ИЛ нэрлэнэ (хэрэглэгчид "яагаад" гэж хэлнэ)',
    d1.partial === '2026-09', String(d1.partial));
  const d2 = drop(NINE.slice(), 2025, null, NOW_0924);
  check('BE37. ӨНГӨРСӨН оны цуваа ХӨНДӨГДӨХГҮЙ (2025-09 бүтэн сар)',
    d2.counts.length === 9 && d2.partial === null, JSON.stringify(d2.counts.length));
  const d3 = drop(NINE.slice(0, 8), 2026, null, NOW_0924);
  check('BE37. Цуваа 8-р сараар дууссан бол юу ч хасахгүй (аль хэдийн бүтэн)',
    d3.counts.length === 8 && d3.partial === null);
  const d4 = drop(NINE.slice(), 2026, { grain: 'month', excludes_current: false }, NOW_0924);
  check('BE37. excludes_current:false → цуваа ХЭВЭЭР (дүрэм registry-гээс)',
    d4.counts.length === 9 && d4.partial === null, JSON.stringify(d4.counts.length));
  check('BE37. Хоосон цуваа → унахгүй', drop([], 2026, null, NOW_0924).counts.length === 0);
  /* УБ цагийн хил: UTC 09-30 20:00 нь УБ-д аль хэдийн 10-р сарын 1 */
  const d5 = drop([1, 2, 3, 4, 5, 6, 7, 8, 9], 2026, null, Date.UTC(2026, 8, 30, 20, 0, 0));
  check('BE37. УБ цагаар (UTC+8) сар солигдоно — 9-р сар БҮТЭН болж үлдэнэ',
    d5.counts.length === 9 && d5.partial === null, JSON.stringify(d5.partial));

  /* sectorSummaryToSeries ч ижил дүрмийг registry-гээс авна */
  const ss37 = dcScript().match(/function sectorSummaryToSeries\(json,now,cov\)\{([\s\S]*?)\n\}\n/);
  if (!ss37) { bad('BE37. sectorSummaryToSeries(json,now,cov) олдсонгүй'); return; }
  const toSer37 = new Function('COVERAGE_DEFAULT', 'json', 'now', 'cov',
    ss37[1]).bind(null, { grain: 'month', excludes_current: true });
  /* 2026 оны БОДИТ зорчигчийн тоо (/api/sectors/rail/summary, 2026-09-24).
     1–9-р сарын нийлбэр = 1,167,735. 9-р сар нь ДУУСААГҮЙ (77,735 нь
     22 хоногийнх) тул 8-р сарын 148,470-тай зэрэгцвэл −47.6% "уналт"
     мэт уншигдана — яг энэ ХУДАЛ уншилтаас хамгаална.
     sectorSummaryToSeries нь 1-р сараас ЗАВСАРГҮЙ цуваа шаарддаг. */
  const PAX37 = [143220, 95798, 115010, 134414, 134068, 160319, 158701, 148470, 77735];
  const SUM37 = {
    status: 'ok', unit: 'зорчигч',
    data: PAX37.map((v, i) => ({
      month: '2026-' + String(i + 1).padStart(2, '0') + '-01T00:00:00.000Z',
      total_volume: String(v)
    })).reverse()
  };
  const keep = toSer37(SUM37, NOW_0924, { grain: 'month', excludes_current: false });
  check('BE37. excludes_current:false → 9-р сар цуваанд ОРНО (гэрээ хоёр тийш)',
    !!keep && keep.counts.length === 9 && keep.counts[8] === 77735,
    JSON.stringify(keep && keep.counts));
  const cut = toSer37(SUM37, NOW_0924, null);
  check('BE37. Өгөгдмөл дүрэм → 9-р сар ХАСАГДАНА, partial тэмдэглэгдэнэ',
    !!cut && cut.counts.length === 8 && cut.partial === '2026-09',
    JSON.stringify(cut && [cut.counts.length, cut.partial]));
  check('BE37. Сүүлийн цэг нь 8-р сарын 148,470 (дутуу 77,735 БИШ)',
    !!cut && cut.counts[7] === 148470, JSON.stringify(cut && cut.counts[7]));
  /* 1,167,735 − 77,735 = 1,090,000 (ГАРААР) */
  check('BE37. Хасагдсан сар НИЙЛБЭРТ ч орохгүй: 1,090,000',
    !!cut && cut.counts.reduce((a, b) => a + b, 0) === 1090000,
    JSON.stringify(cut && cut.counts.reduce((a, b) => a + b, 0)));

  /* Сайт талын утсан холбоос */
  check('BE37. coverageOf() registry-гээс уншиж, байхгүй бол өгөгдмөл рүү',
    dcScript().includes('coverageOf(mk){') &&
    dcScript().includes('(m&&m.period_coverage)||COVERAGE_DEFAULT'));
  check('BE37. rail цуваа coverageOf-оор дамжина (хатуу дүрэм үлдээгүй)',
    dcScript().includes('this.coverageOf(SECTOR_SERIES[k].metric)') &&
    dcScript().includes("metric:'rail.monthly_passenger_series'"));
  check('BE37. air ч ИЖИЛ функцээр (хоёр өөр дүрэм үлдээгүй)',
    dcScript().includes("dropPartialMonth(lastRealIdx>=0?c1dFull.slice(0,lastRealIdx+1):[]") &&
    dcScript().includes("this.coverageOf('air.monthly_flight_series')"));
  check('BE37. t05-ийн толгойд тэмдэглэгээ гарна, текст content.json-д',
    read('index.html').includes('{{ t05CovNote }}') &&
    dcScript().includes("stxt('status.partial_month'") &&
    readJson('content.json').site.status.partial_month === '* дуусаагүй сар цэгээр тэмдэглэв');

  /* ── BE38. datasets{} — БҮРЭН БАЙДАЛ машинаар уншигдана ──
     Өмнө нь "эх сурвалжийн 0.1% нь татагдсан" гэсэн баримт ЗӨВХӨН
     t05.road.would_need-ийн зохиолын дотор амьдарч байсан тул
     (а) хэрэглэгчид хэзээ ч харагдахгүй, (б) бусад слот мэдэхгүй,
     (в) машинаар уншигдахгүй байв. */
  const reg38 = readJson('metric_registry.json');
  const ds38 = reg38.datasets || {};
  check('BE38. datasets{} блок бий, backend-ийн dataset_id-гаар түлхүүрлэсэн',
    !!ds38['road.veritech.vehicle_registry'] && !!ds38['rail.veritech.freight_ubtz'],
    Object.keys(ds38).join(', '));
  const vr38 = (ds38['road.veritech.vehicle_registry'] || {}).completeness || {};
  check('BE38. vehicle_registry-ийн бүрэн байдал тоогоор бүртгэгдсэн',
    vr38.ingested === 2000 && vr38.source_total === 1941092,
    JSON.stringify([vr38.ingested, vr38.source_total]));
  /* 2000 / 1941092 × 100 = 0.10303… → 2 аравтаар "0.10%" (ГАРААР) */
  check('BE38. Хувь нь ТООЦООЛОГДОНО — registry-д pct ХАДГАЛАГДААГҮЙ (ганц эх сурвалж)',
    !('pct' in vr38) && (vr38.ingested / vr38.source_total * 100).toFixed(2) === '0.10');
  check('BE38. Хэмжилтийн гарал үүсэл бүртгэлтэй (тоо зохиогоогүйн баталгаа)',
    !!vr38.method && vr38.measured_on === '2026-09-24' && vr38.blocks_publication === true);
  const blocked38 = [];
  for (const [wid, w] of Object.entries(reg38.widgets)) {
    const secs = (w.sectors && !Array.isArray(w.sectors)) ? w.sectors : {};
    for (const [k, sv] of Object.entries(secs)) if (sv && sv.blocked_by) blocked38.push([wid, k, sv.blocked_by]);
  }
  check('BE38. Блоклогдсон слотууд датасэтээ ЗААНА (t05.road орсон)',
    /* 2026-10-21: w2p/w2pb/w2px.road авто тээврийн зорчигчоор холбогдсон тул 5 слот үлдэв */
    blocked38.length >= 5 && blocked38.some((b) => b[0] === 't05' && b[1] === 'road'),
    blocked38.length + ' слот');
  check('BE38. blocked_by бүр БОДИТ датасэтийг заана (бичгийн алдаагүй)',
    blocked38.every((b) => !!ds38[b[2]]),
    blocked38.filter((b) => !ds38[b[2]]).map((b) => b.join('.')).join(', '));
  check('BE38. Метрик холбогдсон слотод blocked_by ҮЛДЭЭГҮЙ (хуучирсан мета)',
    blocked38.every((b) => !reg38.widgets[b[0]].sectors[b[1]].metric));

  /* Админ тал — функцийг ГАРГАЖ АВААД бодит registry дээр ажиллуулна */
  const cn38 = adm.match(/function completenessNote\(dsId\)\{([\s\S]*?)\n\}/);
  if (!cn38) { bad('BE38. completenessNote() олдсонгүй'); return; }
  const mkCN = new Function('REG', 'esc', 'utxt', 'nf',
    'return function(dsId){' + cn38[1] + '}');
  const cnFn = mkCN(reg38, (x) => String(x), (p, f) => f,
    (n) => Number(n).toLocaleString('en-US'));
  const cnOut = cnFn('road.veritech.vehicle_registry');
  check('BE38. Админ 0.10% (2,000 / 1,941,092) гэж ИЛ харуулна',
    cnOut.includes('0.10%') && cnOut.includes('2,000') && cnOut.includes('1,941,092'), cnOut);
  check('BE38. "тоо нийтлэхгүй" сануулга ба хэмжсэн огноо мөрөнд',
    cnOut.includes('тоо нийтлэхгүй') && cnOut.includes('2026-09-24'));
  check('BE38. Хэмжилтгүй датасэт → мөр ОГТ гарахгүй (хоосон талбар үүсгэхгүй)',
    cnFn('rail.veritech.freight_ubtz') === '' && cnFn('') === '' && cnFn('байхгүй.id') === '');
  check('BE38. Админы шошго content.json ui{}-д бүртгэлтэй',
    readJson('content.json').ui.slot_text.completeness === 'Эх сурвалжийн бүрэн байдал' &&
    !!readJson('content.json').ui.slot_text.blocks_publication);
  check('BE38. Слотын маягт бүрэн байдлын мөрийг залгана',
    adm.includes('completenessNote(sv.blocked_by)'));

  /* ── BE48. БҮРЭН татагдсан датасэт — ХУДАЛ "дутуу" текст ГАРАХГҮЙ ──
     2026-09-26-ны ETL таталт (silver.etl_runs id=57, 460.5 мин,
     rows_fetched=rows_inserted=rows_transformed=910 444, error_text
     хоосон) эх сурвалжийг БҮТНЭЭР авсан. completenessNote() эхлээд
     ЗӨВХӨН дутуу таталтад зориулагдсан байсан тул 100% үед ч "дутуу
     таталт тул тоо нийтлэхгүй" гэж бичих эрсдэлтэй байв — тэр нь
     хуудсыг ХУДАЛ тайлбарлана. */
  const in39 = (ds38['road.veritech.inspections'] || {});
  const c39 = in39.completeness || {};
  check('BE48. inspections-ийн бүрэн байдал тоогоор бүртгэгдсэн (ETL run 57)',
    c39.ingested === 910444 && c39.source_total === 910444,
    JSON.stringify([c39.ingested, c39.source_total]));
  /* 910444 / 910444 × 100 = 100 → 1%-аас их тул 1 аравтаар "100.0" (ГАРААР) */
  check('BE48. Хувь нь ТООЦООЛОГДОНО — pct ХАДГАЛАГДААГҮЙ',
    !('pct' in c39) && (c39.ingested / c39.source_total * 100).toFixed(1) === '100.0');
  check('BE48. Хэмжилтийн гарал үүсэл ба огноо бүртгэлтэй, нийтлэлийг БЛОКЛООГҮЙ',
    c39.measured_on === '2026-09-26' && /run 57/.test(c39.method || '') &&
    c39.blocks_publication === false,
    JSON.stringify([c39.measured_on, c39.blocks_publication]));

  /* Админ тал — completenessNote() ба datasetOfMetric()-ийг ГАРГАЖ АВНА */
  const cnB39 = adm.match(/function completenessNote\(dsId\)\{([\s\S]*?)\n\}/);
  const dmB39 = adm.match(/function datasetOfMetric\(mk\)\{([\s\S]*?)\n\}/);
  if (!cnB39 || !dmB39) { bad('BE48. completenessNote/datasetOfMetric олдсонгүй'); return; }
  const con39 = readJson('content.json');
  const utxt39 = (path, fb) => {
    let v = con39.ui; for (const k of path.split('.')) v = v && v[k];
    return v == null ? fb : v;
  };
  const mk39 = (reg) => new Function('REG', 'esc', 'utxt', 'nf',
    'return {cn:function(dsId){' + cnB39[1] + '},dm:function(mk){' + dmB39[1] + '}}')(
    reg, (x) => String(x), utxt39, (n) => Number(n).toLocaleString('en-US'));
  const F39 = mk39(reg38);
  const full39 = F39.cn('road.veritech.inspections');
  check('BE48. 100% үед "дутуу таталт тул тоо нийтлэхгүй" ГАРАХГҮЙ',
    !/дутуу таталт/.test(full39), full39);
  check('BE48. 100% үед "бүрэн татагдсан" гэж ИЛ бичнэ (хувь нь дуугүй үлдэхгүй)',
    full39.includes('100.0%') && full39.includes('910,444') &&
    full39.includes(con39.ui.slot_text.complete_ingest), full39);
  check('BE48. Блоклогдсон датасэт дээр сануулга ХЭВЭЭР (эсрэг талд регресс үгүй)',
    /дутуу таталт/.test(F39.cn('road.veritech.vehicle_registry')) &&
    !F39.cn('road.veritech.vehicle_registry').includes(con39.ui.slot_text.complete_ingest));
  /* ГАРААР бодогдох фикстур: 5/10 = 50.0%, блоклоогүй → ХОЁУЛАА дуугүй */
  const fx39 = mk39({ datasets: { 'x.y': { completeness: {
    ingested: 5, source_total: 10, measured_on: '2026-01-01',
    method: 'фикстур', blocks_publication: false } } }, metrics: {} });
  const part39 = fx39.cn('x.y');
  check('BE48. Дутуу ч блоклоогүй бол ХОЁР шошго аль нь ч гарахгүй, хувь нь 50.0%',
    part39.includes('50.0%') && !/дутуу таталт/.test(part39) &&
    !part39.includes(con39.ui.slot_text.complete_ingest), part39);
  check('BE48. Шинэ шошго content.json ui{}-д бүртгэлтэй',
    con39.ui.slot_text.complete_ingest === 'бүрэн татагдсан');

  /* Мөр ХҮРЭХ ЭСЭХ — амьд (холбогдсон) слотод ч харагдана. Өмнө нь
     completenessNote() зөвхөн sv.blocked_by-аар дуудагддаг тул амьд
     датасэтийн 100% нь хаана ч харагдахгүй ҮХМЭЛ бичлэг байв. */
  check('BE48. datasets{}.table ↔ metrics{}.dataset холбоос ажиллана',
    F39.dm('road.inspection_count') === 'road.veritech.inspections' &&
    F39.dm('') === '' && F39.dm('байхгүй.метрик') === '',
    F39.dm('road.inspection_count'));
  check('BE48. Холбогдсон слотын маягт бүрэн байдлын мөрийг залгана',
    adm.includes('calcLine(sv.metric)+completenessNote(datasetOfMetric(sv.metric))'));
  check('BE48. check-registry нь blocks_publication-ийг төрөл ба зөрчлөөр шалгана',
    read('scripts/check-registry.js').includes("typeof c.blocks_publication !== 'boolean'") &&
    read('scripts/check-registry.js').includes('c.blocks_publication && c.ingested >= c.source_total') &&
    read('scripts/check-registry.js').includes(".table: "));

  /* Сайт тал — index.html нь datasets{}-ийн ТАТАЛТЫН бүрэн байдлыг ОГТ
     уншихгүй, тул нийтийн хуудсанд "дутуу татагдсан" гэсэн текст гарах
     ЗАМ байхгүй. Хэрэв хожим нэмэгдвэл ЭНЭ тест унаж, 100%-ийн салааг
     тэндээ бас нэмэхийг сануулна.
     ⚠️ Шалгуур нь REGISTRY-ийн ӨВӨРМӨЦ талбаруудаар явна, ерөнхий
     "completeness" ҮГЭЭР БИШ: 2026-10-05-наас хойш index.html-д огт
     ӨӨР утгатай completeness бий — rowProfile()-ийн "Бүрэн байдал N%"
     нь ачаалагдсан мөрүүдийн НҮДНИЙ дүүргэлт (gov.opendata.mn жишиг),
     ETL-ийн таталттай ямар ч хамаагүй. Үгээр шалгавал тэр онцлог энэ
     тестийг ХУУРАМЧААР унагана (яг ингэж унасан). */
  const site39 = read('index.html');
  const etlMarks = ['source_total', 'blocks_publication', 'дутуу таталт', 'measured_on'];
  const leaked = etlMarks.filter((t) => site39.includes(t));
  check('BE48. Сайт дээр ТАТАЛТЫН бүрэн байдлын текст гарах зам БАЙХГҮЙ (хуурамч сануулга үгүй)',
    leaked.length === 0, 'сайтад гарсан: ' + leaked.join(', '));

  /* ── BE32. Registry / админ / content — ГЭРЭЭ (хоёр талыг ХАМТ) ── */
  const reg32 = readJson('metric_registry.json');
  const sl32 = (id, k) => ((reg32.widgets[id] || {}).sectors || {})[k] || {};
  check('BE32. ls.road → road.inspection_count (verified)',
    sl32('ls', 'road').metric === 'road.inspection_count' && sl32('ls', 'road').quality === 'verified',
    JSON.stringify(sl32('ls', 'road')));
  check('BE32. k04.road → road.inspection_kpi_set (verified)',
    sl32('k04', 'road').metric === 'road.inspection_kpi_set' && sl32('k04', 'road').quality === 'verified');
  check('BE32. u07.road → road.feed_updated_at (verified)',
    sl32('u07', 'road').metric === 'road.feed_updated_at' && sl32('u07', 'road').quality === 'verified');
  check('BE32. Гурван метрик registry-д, датасэт нь silver.road_inspections',
    ['road.inspection_count', 'road.inspection_kpi_set', 'road.feed_updated_at']
      .every((m) => reg32.metrics[m] && reg32.metrics[m].dataset === 'silver.road_inspections'));
  check('BE32. Метрикийн нэгж: үзлэг / mixed / огноо',
    reg32.metrics['road.inspection_count'].unit === 'үзлэг' &&
    reg32.metrics['road.inspection_kpi_set'].unit === 'mixed' &&
    reg32.metrics['road.feed_updated_at'].unit === 'огноо');
  check('BE32. Баталгаажуулалтын нотолгоо (2,790 мөр, 202 тэнцээгүй) registry-д ил',
    /2,790/.test(reg32.metrics['road.inspection_count'].period_note) &&
    /2,692/.test(reg32.metrics['road.inspection_count'].period_note));
  check('BE32. val()-д хоёр getter холбогдсон',
    dcScript().includes("'road.inspection_count':()=>this._roadInspections") &&
    dcScript().includes("'road.inspection_kpi_set':()=>this._roadInspections"));
  const fu32 = (read('admin/index.html').match(/var FIXED_UNIT=\{([\s\S]*?)\n\};/) || [])[1] || '';
  const fx32 = {}; for (const fm of fu32.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) fx32[fm[1]] = fm[2];
  check('BE32. FIXED_UNIT ls.road = "үзлэг" (хуучин "км" бол why() холбоосыг САЛГАНА)',
    fx32['ls.road'] === reg32.metrics['road.inspection_count'].unit, fx32['ls.road']);
  check('BE32. FIXED_UNIT k04.road = "mixed"',
    fx32['k04.road'] === reg32.metrics['road.inspection_kpi_set'].unit, fx32['k04.road']);
  check('BE32. Админы required_unit-д "үзлэг" бүртгэлтэй',
    readJson('content.json').ui.required_unit['үзлэг'] === 'үзлэг');
  check('BE32. Админ каталогт silver.road_inspections нэртэй (түүхий код гарахгүй)',
    /'silver\.road_inspections':\{n:/.test(read('admin/index.html')) &&
    !!(readJson('content.json').ui.dataset.silver_road_inspections || {}).name);
  const c32 = readJson('content.json').site;
  check('BE32. Шинэ харагдах текст content.json-д бүртгэгдсэн',
    JSON.stringify(c32.sector_kpi_road_live) === JSON.stringify(['ХОНОГИЙН ҮЗЛЭГ', 'ТЭНЦЭЭГҮЙ', 'ШАЛГАСАН ТХ']) &&
    (c32.road_fail_cats || []).length === 6 && c32.unit.inspection === 'үзлэг' &&
    !!c32.sector_rank_road_live && !!c32.sector_chart2_road_live &&
    !!c32.status.road_inspect_asof && !!c32.status.road_inspect_stale && !!c32.status.road_inspect_compare);
  check('BE32. Каталог ба u07-ийн мөр content.json-д (код дээрх текст давхардахгүй)',
    (readJson('content.json').site.datasets || []).some((d) => d.name === 'Техникийн хяналтын үзлэгийн мэдээ') &&
    (readJson('content.json').site.updates || []).some((u) => u.title === 'Техникийн хяналтын үзлэгийн мэдээ'));
  check('BE32. Хоцролтын босго 8 хоног (7 хоногийн ETL-д тохирсон)',
    /const INSPECT_STALE_DAYS=8;/.test(dcScript()));
  check('BE32. t05.road ХОЛБОГДООГҮЙ хэвээр — хоногийн цуваа сарын тэнхлэгт тохирохгүй',
    sl32('t05', 'road').metric === null && /ХОНОГИЙН/.test(sl32('t05', 'road').would_need || ''),
    JSON.stringify(sl32('t05', 'road').metric));
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
/* ── VR. ТЭЭВРИЙН ХЭРЭГСЛИЙН БҮРТГЭЛИЙН САМБАР ──────────────────────────
   Зорилго: самбарын АРИФМЕТИКийг бодит feed дээр "нүдээр" биш, ГАРААР
   БОДОХ БОЛОМЖТОЙ жижиг фикстур дээр батлах (CLAUDE.md — тестийн мөчлөг
   1-р алхам). Эх сурвалж нь өнөөдөр хаалттай тул "хоосон үед юу гарах" ба
   "дата ирэхэд юу гарах" ХОЁУЛАНГ нь шалгана — зөвхөн хоосон төлвийг
   шалгавал таталт засагдмагц шинэ алдаа чимээгүй орж ирнэ. */
async function groupVR() {
  group('VR. Тээврийн хэрэгслийн бүртгэлийн самбар');

  const src = dcScript();
  const tpl = indexTemplate();
  const con = readJson('content.json');

  /* Самбарын логикийг эх кодоос ТАСЛАН авч, стабтайгаар ажиллуулна —
     хуулбар БИШ, ЯГ нийтлэгдэх код ажиллана. */
  const i = src.indexOf('const VEHREG_DS=');
  const j = src.indexOf('/* ── Сайтын ерөнхий текстийн ГАНЦ эх сурвалж');
  check('VR1. Самбарын логик эх кодоос олдов', i >= 0 && j > i,
    'i=' + i + ' j=' + j);
  if (i < 0 || j <= i) return;

  const stxt = (p, fb) => {
    let c = con.site;
    for (const k of String(p).split('.')) {
      if (c == null || typeof c !== 'object') return fb;
      c = c[k];
    }
    return (c == null || c === '') ? fb : c;
  };
  const fmtNum = (n) => Number(n).toLocaleString('en-US');
  const M = new Function('fmtNum', 'stxt', 'NEON',
    src.slice(i, j) + '\nreturn {vehregNum,vehregFmt,vehregPct,vehregDonut,vehregBars,' +
    'vehregAgeBars,vehicleRegistryToValue,buildVehRegBoard,' +
    'VEHREG_KPI,VEHREG_SHARE,VEHREG_TOP,VEHREG_C,VEHREG_DS,' +
    'VEHREG_TABS,VEHREG_TAB_DEFAULT,vehregTabId,VEHREG_FUEL_KPI,' +
    'VEHREG_FUEL_TOP,buildVehRegFuel};'
  )(fmtNum, stxt, { road: '#8CA9E8' });

  /* ── Нэгж тест: 0 ба null-ийг ХОЛИХГҮЙ ─────────────────────────────── */
  check('VR2. vehregNum — 0 нь БОДИТ утга, хоосон нь null',
    M.vehregNum(0) === 0 && M.vehregNum(null) === null &&
    M.vehregNum('') === null && M.vehregNum(undefined) === null &&
    M.vehregNum('abc') === null && M.vehregNum('42') === 42,
    JSON.stringify([M.vehregNum(0), M.vehregNum(null), M.vehregNum('42')]));
  check('VR2. vehregFmt — null → "—", тоо → таслалтай',
    M.vehregFmt(null) === '—' && M.vehregFmt(1942315) === '1,942,315' &&
    M.vehregFmt(0) === '0',
    M.vehregFmt(null) + ' / ' + M.vehregFmt(1942315));
  check('VR2. vehregPct — 25/100 = 25.0%, нийт 0 эсвэл null → "—"',
    M.vehregPct(25, 100) === '25.0%' && M.vehregPct(1, 3) === '33.3%' &&
    M.vehregPct(5, 0) === '—' && M.vehregPct(null, 100) === '—',
    M.vehregPct(25, 100) + ' / ' + M.vehregPct(1, 3));

  /* ── Нэгж тест: бөөрөнхий график (гараар бодогдохуйц 60/40) ────────── */
  const d2 = M.vehregDonut([{ label: 'Баруун', count: 60 }, { label: 'Зүүн', count: 40 }]);
  const seg0 = d2.segs[0].dash.split(' ').map(Number);
  const seg1 = d2.segs[1].dash.split(' ').map(Number);
  check('VR3. Бөөрөнхий — 60/40 нь 60.0% / 40.0%',
    !d2.empty && d2.legend.length === 2 &&
    d2.legend[0].pct === '60.0%' && d2.legend[1].pct === '40.0%' && d2.total === '100',
    JSON.stringify(d2.legend.map((l) => l.pct)) + ' нийт=' + d2.total);
  check('VR3. Бөөрөнхий — зүсмийн урт бүтэн тойргийг ЯГ дүүргэнэ',
    Math.abs(seg0[0] - M.VEHREG_C * 0.6) < 0.01 &&
    Math.abs(seg1[0] - M.VEHREG_C * 0.4) < 0.01 &&
    Math.abs(seg0[0] + seg1[0] - M.VEHREG_C) < 0.02,
    seg0[0] + ' + ' + seg1[0] + ' vs ' + M.VEHREG_C);
  check('VR3. Бөөрөнхий — шилжилт хуримтлагдана (зүсэм давхцахгүй)',
    Number(d2.segs[0].offset) === 0 &&
    Math.abs(Number(d2.segs[1].offset) + seg0[0]) < 0.01,
    d2.segs.map((s) => s.offset).join(' / '));
  const dEmpty = M.vehregDonut([]);
  check('VR4. Бөөрөнхий — дата алга бол ЗҮСЭМ ОГТ гарахгүй',
    dEmpty.empty === true && dEmpty.segs.length === 0 &&
    dEmpty.legend.length === 0 && dEmpty.total === '—',
    JSON.stringify(dEmpty));
  check('VR4. Бөөрөнхий — нийт 0 бол мөн хоосон (0-д хуваахгүй)',
    M.vehregDonut([{ label: 'А', count: 0 }]).empty === true);

  /* ── Нэгж тест: TOP жагсаалт ба насжилт ────────────────────────────── */
  const b3 = M.vehregBars([{ label: 'Б', count: 20 }, { label: 'А', count: 70 },
    { label: 'В', count: 10 }], 8);
  check('VR5. TOP — буурахаар эрэмбэлж, хамгийн их нь 100%',
    !b3.empty && b3.rows.map((r) => r.label).join(',') === 'А,Б,В' &&
    b3.rows[0].width === '100.0%' && b3.rows[0].rank === 1 &&
    b3.rows[1].width === '28.6%' && b3.rows[2].width === '14.3%',
    b3.rows.map((r) => r.label + ':' + r.width).join(' '));
  check('VR5. TOP — хязгаараас илүү мөр таслагдана',
    M.vehregBars(Array.from({ length: 12 }, (_, n) => ({ label: 'x' + n, count: n })), 8)
      .rows.length === 8);
  check('VR5. TOP — дата алга бол мөр ОГТ гарахгүй',
    M.vehregBars([], 8).empty === true && M.vehregBars(null, 8).rows.length === 0);
  const ag = M.vehregAgeBars([{ label: '0-3', count: 10 }, { label: '4-6', count: 20 },
    { label: '13+', count: 40 }]);
  check('VR6. Насжилт — өндөр нь ХАМГИЙН ИХ утгаас тооцогдоно',
    !ag.empty && ag.rows.map((r) => r.height).join(',') === '25.0%,50.0%,100.0%' &&
    ag.rows[2].value === '40',
    ag.rows.map((r) => r.height).join(','));
  check('VR6. Насжилт — дата алга бол багана ОГТ гарахгүй',
    M.vehregAgeBars([]).empty === true && M.vehregAgeBars(null).rows.length === 0);

  /* ── Гэрээ: backend хариу → самбарын утга ──────────────────────────── */
  check('VR7. no_data / хоосон хариу → null (тоо ЗОХИОХГҮЙ)',
    M.vehicleRegistryToValue(null) === null &&
    M.vehicleRegistryToValue({ status: 'no_data' }) === null &&
    M.vehicleRegistryToValue('') === null);
  const FEED = {
    status: 'ok', as_of: '2026-09-29', total: 100,
    kpi: { ub: 60, rural: 40, owners: 80, individual: 70, wanted: 3 },
    age: { avg_years: 13.9, buckets: [{ label: '0-3 жил', count: 10 },
      { label: '4-6 жил', count: 20 }, { label: '13+ жил', count: 40 }] },
    breakdowns: {
      wheel: [{ label: 'Баруун', count: 60 }, { label: 'Зүүн', count: 40 }],
      fuel: [{ label: 'Бензин', count: 50 }, { label: 'Дизель', count: 25 },
        { label: 'Цахилгаан', count: 25 }]
    },
    top: { country: [{ label: 'Япон', count: 70 }, { label: 'БНСУ', count: 20 },
      { label: 'Хятад', count: 10 }] }
  };
  const val = M.vehicleRegistryToValue(FEED);
  check('VR7. Бүтэн хариу → бүх талбар зураглагдана',
    val && val.total === 100 && val.kpi.ub === 60 && val.kpi.indiv === 70 &&
    val.ageAvg === 13.9 && val.ageBuckets.length === 3 &&
    val.share.wheel.length === 2 && val.top.country.length === 3 &&
    Array.isArray(val.share.gender) && val.share.gender.length === 0,
    JSON.stringify(val && val.kpi));

  /* ── Хоосон төлөв: НЭГ Ч ТОО гарахгүй ──────────────────────────────── */
  const empty = M.buildVehRegBoard(null);
  check('VR8. Хоосон — 6 KPI бүгд "—"',
    empty.kpis.length === 6 && empty.kpis.every((k) => k.value === '—'),
    empty.kpis.map((k) => k.value).join(','));
  check('VR8. Хоосон — 5 бөөрөнхий, 3 TOP, насжилт бүгд хоосон',
    empty.shares.length === 5 && empty.shares.every((s) => s.empty) &&
    empty.tops.length === 3 && empty.tops.every((t) => t.empty) &&
    empty.age.empty === true && empty.age.avg === '—',
    empty.shares.filter((s) => !s.empty).length + ' / ' + empty.tops.filter((t) => !t.empty).length);
  check('VR8. Хоосон — блокерын шалтгаан ИЛ бичигдэнэ',
    empty.blocked === true && empty.live === false &&
    empty.blockHead.length > 0 && empty.blockBody.length > 0 && empty.hasAsOf === false,
    JSON.stringify([empty.blocked, empty.hasAsOf]));
  /* Хоосон самбарын БҮХ харагдах утга дотор цифр огт байх ёсгүй —
     "0.05%" гэх мэт тайлбарын тоо нь content.json-ы ТЕКСТ, харин
     KPI/легенд/мөр нь ТООН талбар тул тэдгээрийг л шалгана. */
  const emptyNums = []
    .concat(empty.kpis.map((k) => k.value))
    .concat(empty.shares.map((s) => s.total))
    .concat(empty.shares.reduce((a, s) => a.concat(s.legend.map((l) => l.value)), []))
    .concat(empty.tops.reduce((a, t) => a.concat(t.rows.map((r) => r.value)), []))
    .concat(empty.age.rows.map((r) => r.value))
    .concat([empty.age.avg]);
  check('VR8. Хоосон — тоон талбарт ЦИФР огт алга (тоо ЗОХИОХГҮЙ)',
    emptyNums.length > 0 && emptyNums.every((x) => !/[0-9]/.test(String(x))),
    emptyNums.filter((x) => /[0-9]/.test(String(x))).join(','));

  /* ── Амьд төлөв: ЯГ ИЖИЛ builder дата ирэхэд дүүрнэ ────────────────── */
  const live = M.buildVehRegBoard(val);
  const kv = {};
  live.kpis.forEach((k) => { kv[k.id] = k.value; });
  check('VR9. Амьд — KPI мөр бүр feed-ийн утгыг харуулна',
    kv.total === '100' && kv.ub === '60' && kv.rural === '40' &&
    kv.owners === '80' && kv.indiv === '70' && kv.wanted === '3',
    JSON.stringify(kv));
  const wheel = live.shares.find((s) => s.id === 'wheel');
  const fuel = live.shares.find((s) => s.id === 'fuel');
  const gender = live.shares.find((s) => s.id === 'gender');
  check('VR9. Амьд — бөөрөнхий нь feed-ийн ангиллаар дүүрнэ',
    !wheel.empty && wheel.legend[0].pct === '60.0%' &&
    !fuel.empty && fuel.legend.length === 3 && fuel.legend[0].pct === '50.0%',
    wheel.legend.map((l) => l.label + ' ' + l.pct).join(', '));
  check('VR9. Амьд — feed-д АЛГА слот хэвээр хоосон (хуурамч дүүргэхгүй)',
    gender.empty === true && live.tops.find((t) => t.id === 'mark').empty === true &&
    live.tops.find((t) => t.id === 'color').empty === true,
    JSON.stringify([gender.empty, live.tops.map((t) => t.id + ':' + t.empty)]));
  check('VR9. Амьд — TOP улс эрэмбэлэгдэж, насжилт ба огноо гарна',
    live.tops[0].rows[0].label === 'Япон' && live.tops[0].rows[0].value === '70' &&
    live.age.hasRows === true && live.age.avg === '~13.9 жил' &&
    live.blocked === false && live.hasAsOf === true && live.asOf.indexOf('2026-09-29') > 0,
    live.age.avg + ' | ' + live.asOf);

  /* ── Слотын шалтгаан: хоёр өөр шалтгааныг ХОЛИХГҮЙ ─────────────────── */
  const needIds = []
    .concat(empty.kpis.filter((k) => k.needs).map((k) => k.id))
    .concat(empty.shares.filter((s) => s.needs).map((s) => s.id))
    .concat(empty.tops.filter((t) => t.needs).map((t) => t.id));
  /* Өнгө (COLORNAME) ба хүйс (GENDER) нь датасэтэд БАЙГАА багана —
     тэдгээрийг "эх сурвалж дутуу" гэж бичвэл ажилтан байхгүй ажил
     хүлээнэ (docs/etl-scheduling.md §2.1-ийн probe). Үнэхээр дутуу нь
     ЗӨВХӨН өмчлөгчийн танигч ба эрэн сурвалжлалтын бүртгэл. */
  check('VR10. Нэмэлт эх сурвалж шаардсан слот ЯГ 2 (owners/wanted)',
    needIds.sort().join(',') === 'owners,wanted', needIds.join(','));
  check('VR10. Өнгө ба хүйс нь ДАТАСЭТИЙН багантай (худал блокер алга)',
    empty.shares.find((s) => s.id === 'gender').field === 'GENDER' &&
    empty.tops.find((t) => t.id === 'color').field === 'COLORNAME' &&
    empty.shares.find((s) => s.id === 'gender').needs === false &&
    empty.tops.find((t) => t.id === 'color').needs === false,
    empty.shares.find((s) => s.id === 'gender').field + ' / ' +
    empty.tops.find((t) => t.id === 'color').field);
  check('VR10. Шалтгааныг ЗӨВХӨН тэр 2 слот дээр бичнэ (давталт багасна)',
    empty.kpis.concat(empty.shares, empty.tops).every((s) => s.showWhy === s.needs) &&
    empty.age.showWhy === false,
    empty.kpis.map((k) => k.id + ':' + k.showWhy).join(' '));
  check('VR10. Багана бүхий слот эх багананы нэрээ харуулна',
    empty.shares.find((s) => s.id === 'fuel').field === 'FUELNAME' &&
    empty.tops.find((t) => t.id === 'country').field === 'COUNTRYNAME' &&
    empty.age.field === 'BUILDYEAR' &&
    empty.kpis.find((k) => k.id === 'owners').hasField === false,
    empty.shares.map((s) => s.field).join(','));

  /* ── Хүрэх зам: хуудас нь PAGES-д БАЙХ ЁСТОЙ ───────────────────────── */
  const rf = src.match(/routeFromHash\(\)\{[\s\S]*?\n  \}/);
  check('VR11. routeFromHash эх кодоос олдов', !!rf);
  /* PAGES/route нь доорх VR16-д ч хэрэгтэй тул функцийн хүрээнд. */
  let PAGES = null, route = null;
  if (rf) {
    PAGES = JSON.parse('[' + (src.match(/const PAGES=\[([\s\S]*?)\n\];/) || [])[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/([{,])\s*(\w+):/g, '$1"$2":')
      .replace(/'/g, '"').replace(/,\s*$/, '') + ']');
    route = new Function('PAGES', 'location',
      'var o={' + rf[0] + '};return o.routeFromHash();');
    check('VR11. #/vehreg танигдана (хуудас ХҮРЭХ ЗАМТАЙ)',
      JSON.stringify(route(PAGES, { hash: '#/vehreg' })) === '{"page":"vehreg"}',
      JSON.stringify(route(PAGES, { hash: '#/vehreg' })));
    check('VR11. Танигдаагүй зам хэвээр null (бүх юм танигдахгүй)',
      route(PAGES, { hash: '#/sector' }) === null &&
      JSON.stringify(route(PAGES, { hash: '#/browse' })) === '{"page":"browse"}');
  }
  check('VR11. Темплейтэд isVehReg блок ба 15 слотын холбоос бий',
    tpl.includes('<sc-if value="{{ isVehReg }}">') &&
    tpl.includes('{{ vehreg.kpis }}') && tpl.includes('{{ vehreg.shares }}') &&
    tpl.includes('{{ vehreg.tops }}') && tpl.includes('{{ vehreg.age.rows }}'),
    'isVehReg=' + tpl.includes('<sc-if value="{{ isVehReg }}">'));
  check('VR11. Загварт isVehReg ба vehreg зарлагдсан',
    /isVehReg:page==='vehreg'/.test(src) && /vehreg:buildVehRegBoard\(/.test(src));

  /* ── Эх сурвалжийн холболт ─────────────────────────────────────────── */
  check('VR12. SOURCES-д roadVehReg бүртгэлтэй, ачаалагчтай',
    /roadVehReg:\{label:'[^']+', load:app=>app\.loadRoadVehicleRegistry\(\)\}/.test(src) &&
    /async loadRoadVehicleRegistry\(\)\{/.test(src));
  check('VR12. Ачаалагч нь backend хаалттай үед ЧИМЭЭГҮЙ гарна',
    /if\(typeof EHBackend==='undefined'\|\|!EHBackend\.enabled\) return;[\s\S]{0,120}?if\(!EHBackend\.fetchVehicleRegistry\) return;/
      .test(src));
  const be = read('js/erthub-backend.js');
  check('VR12. erthub-backend.js-д fetchVehicleRegistry ба зөв зам',
    be.includes("'/api/sectors/road/vehicle-registry'") &&
    be.includes('fetchVehicleRegistry: fetchVehicleRegistry'));

  /* ── Текстийн бүртгэл: content.json → site.vehreg{} ────────────────── */
  const paths = ['title', 'sub', 'source', 'rows_word', 'unit', 'total_word', 'asof',
    'pending', 'field_label', 'blocked.head', 'blocked.body', 'blocked.doc',
    'age.title', 'age.avg', 'age.years']
    .concat(M.VEHREG_KPI.reduce((a, s) => a.concat(['kpi.' + s.id + '.label', 'kpi.' + s.id + '.sub']), []))
    .concat(M.VEHREG_SHARE.map((s) => 'share.' + s.id))
    .concat(M.VEHREG_TOP.map((s) => 'top.' + s.id))
    .concat(M.VEHREG_KPI.concat(M.VEHREG_SHARE, M.VEHREG_TOP)
      .filter((s) => s.need).map((s) => 'need.' + s.need));
  const missing = paths.filter((p) => {
    let c = con.site.vehreg;
    for (const k of p.split('.')) {
      if (c == null || typeof c !== 'object') return true;
      c = c[k];
    }
    return c == null || c === '';
  });
  check('VR13. Харагдах текст бүр content.json-д бүртгэлтэй',
    missing.length === 0, 'дутуу: ' + missing.join(', '));
  /* ROUND-TRIP: content.json-д бичсэн утга самбарын гаралт дээр ЯГ
     гарч ирнэ. B бүлгийн статик хайлт динамик зам дээр ажиллахгүй тул
     "бүртгэгдсэн ч уншигддаггүй" зам ЭНД баригдана. */
  const probe = JSON.parse(JSON.stringify(con));
  const stampAt = (o, ks, v) => { let c = o; for (let n = 0; n < ks.length - 1; n++) c = c[ks[n]]; c[ks[ks.length - 1]] = v; };
  const seen = [];
  paths.forEach((pp, n) => {
    const marker = "ZZ" + n + "ZZ";
    stampAt(probe.site.vehreg, pp.split("."), marker);
    seen.push(marker);
  });
  const stxt2 = (pp, fb) => {
    let c = probe.site;
    for (const k of String(pp).split(".")) {
      if (c == null || typeof c !== "object") return fb;
      c = c[k];
    }
    return (c == null || c === "") ? fb : c;
  };
  const M2 = new Function("fmtNum", "stxt", "NEON",
    src.slice(i, j) + "\nreturn {buildVehRegBoard};")(fmtNum, stxt2, { road: "#8CA9E8" });
  /* Хоосон ба АМЬД хоёр төлвийг ХОЁУЛАНГ нь зурна: asof, age.years зэрэг
     зөвхөн дата ирэхэд гардаг зам эс тэгвэл "уншигдаагүй" мэт харагдана. */
  const painted = JSON.stringify(M2.buildVehRegBoard(null))
    + JSON.stringify(M2.buildVehRegBoard(val));
  const unread = seen.filter((mk) => painted.indexOf(mk) < 0)
    .map((mk) => paths[Number(mk.slice(2, -2))]);
  check('VR13. Бүртгэсэн зам бүр САМБАР дээр гарч ирнэ (round-trip)',
    unread.length === 0, "уншигдаагүй: " + unread.join(", "));
  check('VR13. Навигацийн шошго бүртгэлтэй (site.nav.vehreg)',
    !!(con.site.nav && con.site.nav.vehreg), JSON.stringify(con.site.nav));
  check('VR13. content.json-д ТОО бичигдээгүй (тоо зөвхөн feed-ээс)',
    !/[0-9]/.test(JSON.stringify([con.site.vehreg.kpi, con.site.vehreg.share,
      con.site.vehreg.top, con.site.vehreg.age])),
    JSON.stringify(con.site.vehreg.kpi).slice(0, 80));

  /* ── Регресс: датасэтийн хэмжээ нь БАРИМТ, зохиомол тоо биш ────────── */
  check('VR14. Мөрийн тоо нь эх сурвалжийн totalcount-той таарна',
    M.VEHREG_DS.rows === 1942315 &&
    M.VEHREG_DS.dataset === 'road.veritech.vehicle_registry' &&
    M.VEHREG_DS.indicator === '14996840',
    JSON.stringify(M.VEHREG_DS));
  check('VR14. Слотын тоо = дэлгэцийн үзүүлэлтийн тоо (6 + 5 + 3 + 1)',
    M.VEHREG_KPI.length === 6 && M.VEHREG_SHARE.length === 5 &&
    M.VEHREG_TOP.length === 3,
    [M.VEHREG_KPI.length, M.VEHREG_SHARE.length, M.VEHREG_TOP.length].join('/'));

  /* ── Таб ───────────────────────────────────────────────────────────
     Табын НЭР нь эх дэлгэцээс авсан баримт; агуулга нь зөвхөн
     structure дээр харагдсан. Иймд ops/plate нь слот ЗОХИОХГҮЙ, харин
     ЯГ юу дутууг нэрлэх ёстой — үүнийг энд хамгаална. */
  check('VR15. Дөрвөн таб, анхдагч нь structure',
    M.VEHREG_TABS.map((t) => t.id).join(',') === 'ops,structure,fuel,plate' &&
    M.VEHREG_TAB_DEFAULT === 'structure',
    M.VEHREG_TABS.map((t) => t.id).join(','));
  check('VR15. Танихгүй/хоосон таб анхдагч руу унана (хуудас цагаан болохгүй)',
    M.vehregTabId('fuel') === 'fuel' && M.vehregTabId('zzz') === 'structure' &&
    M.vehregTabId('') === 'structure' && M.vehregTabId(undefined) === 'structure',
    [M.vehregTabId('zzz'), M.vehregTabId(undefined)].join('/'));
  check('VR15. Табын нэр content.json-д бүртгэлтэй (админаас засварлагдана)',
    M.VEHREG_TABS.every((t) => con.site.vehreg.tabs && con.site.vehreg.tabs[t.id]),
    JSON.stringify(con.site.vehreg.tabs));

  check('VR16. #/vehreg/<таб> хуваалцах боломжтой хаягтай',
    !!route && JSON.stringify(route(PAGES, { hash: '#/vehreg/fuel' })) ===
      '{"page":"vehreg","vehTab":"fuel"}' &&
    JSON.stringify(route(PAGES, { hash: '#/vehreg' })) === '{"page":"vehreg"}',
    route ? JSON.stringify(route(PAGES, { hash: '#/vehreg/fuel' })) : '(route алга)');
  check('VR16. applyRoute ба syncHash таб мэднэ',
    src.indexOf("if(r.page==='vehreg'){") >= 0 &&
    src.indexOf("vehregTabId(r.vehTab)") >= 0 &&
    src.indexOf("this.pushRoute('vehreg/'+vehregTabId(this.state.vehTab)") >= 0);

  /* Түлшний таб — ГАРААР бодогдохуйц фикстур: 20 цахилгаан, 30 хайбрид
     → mix 40.0%/60.0%; TOP 40/10 → 100.0%/25.0%; он 5/10 → 50/100%. */
  const FUEL = Object.assign({}, FEED, {
    fuel: {
      ev: 20, hybrid: 30, share_pct: 25, new_12m: 7,
      mix: [{ label: 'Цахилгаан', count: 20 }, { label: 'Хайбрид', count: 30 }],
      top: { mark: [{ label: 'Toyota', count: 40 }, { label: 'Nissan', count: 10 }], aimag: [] },
      by_year: [{ label: '2020', count: 5 }, { label: '2021', count: 10 }]
    }
  });
  const fLive = M.buildVehRegBoard(M.vehicleRegistryToValue(FUEL), 'fuel');
  const fkv = {};
  fLive.fuel.kpis.forEach((k) => { fkv[k.id] = k.value; });
  check('VR17. Түлш — KPI feed-ийн утгыг харуулна, хувь нь % тэмдэгтэй',
    fkv.ev === '20' && fkv.hybrid === '30' && fkv.share === '25.0%' && fkv.new12 === '7',
    JSON.stringify(fkv));
  check('VR17. Түлш — бөөрөнхий 20/30 нь 40.0%/60.0%',
    !fLive.fuel.shares[0].empty &&
    fLive.fuel.shares[0].legend.map((l) => l.pct).join(',') === '40.0%,60.0%',
    fLive.fuel.shares[0].legend.map((l) => l.pct).join(','));
  check('VR17. Түлш — TOP 40/10 нь 100.0%/25.0%, оны багана 5/10 нь 50/100%',
    fLive.fuel.tops[0].rows.map((r) => r.width).join(',') === '100.0%,25.0%' &&
    fLive.fuel.year.rows.map((r) => r.height).join(',') === '50.0%,100.0%',
    fLive.fuel.tops[0].rows.map((r) => r.width).join(',') + ' | ' +
    fLive.fuel.year.rows.map((r) => r.height).join(','));
  check('VR17. Түлш — feed-д алга жагсаалт хэвээр хоосон (aimag)',
    fLive.fuel.tops[1].empty === true && fLive.fuel.tops[1].id === 'aimag');

  const fEmpty = M.buildVehRegBoard(null, 'fuel');
  check('VR18. Түлш — дата алга бол тоон талбарт ЦИФР огт байхгүй',
    fEmpty.fuel.kpis.every((k) => !/[0-9]/.test(k.value)) &&
    fEmpty.fuel.shares.every((x) => x.empty) &&
    fEmpty.fuel.tops.every((x) => x.empty) && fEmpty.fuel.year.empty === true,
    fEmpty.fuel.kpis.map((k) => k.value).join(','));
  check('VR18. Түлшний слот бүр ДАТАСЭТИЙН багантай (худал блокер алга)',
    fEmpty.fuel.kpis.every((k) => k.hasField && !k.needs) &&
    fEmpty.fuel.tops.every((t) => t.hasField && !t.needs) &&
    fEmpty.fuel.year.field === 'BUILDYEAR',
    fEmpty.fuel.kpis.map((k) => k.field).join(','));

  const ops = M.buildVehRegBoard(null, 'ops');
  const plate = M.buildVehRegBoard(null, 'plate');
  check('VR19. ops/plate нь "бэлэн биш" төлөвтэй, structure/fuel нь БИШ',
    ops.isPending === true && plate.isPending === true &&
    empty.isPending === false && fEmpty.isPending === false,
    [ops.isPending, plate.isPending, empty.isPending, fEmpty.isPending].join('/'));
  check('VR19. ops/plate нь ЯГ ямар эх сурвалж дутууг нэрлэнэ (ерөнхий үг БИШ)',
    ops.pendingBody.length > 60 && plate.pendingBody.length > 60 &&
    ops.pendingBody.indexOf('үйлчилгээ') >= 0 &&
    plate.pendingBody.indexOf('PLATENO') >= 0,
    ops.pendingBody.slice(0, 50));
  check('VR19. Таб солиход structure-ийн слот ХЭВЭЭР (хөндлөн бохирдол алга)',
    ops.kpis.length === 6 && ops.shares.length === 5 && ops.tops.length === 3 &&
    ops.kpis.every((k) => k.value === '—'),
    ops.kpis.map((k) => k.value).join(','));

  const tabPaths = []
    .concat(M.VEHREG_TABS.map((t) => 'tabs.' + t.id))
    .concat(M.VEHREG_TABS.map((t) => 'tab_sub.' + t.id))
    .concat(M.VEHREG_TABS.filter((t) => t.need).map((t) => 'need_source.' + t.need))
    .concat(['pending_tab.head', 'fuel.share.mix', 'fuel.year.title'])
    .concat(M.VEHREG_FUEL_KPI.reduce((a, x) =>
      a.concat(['fuel.kpi.' + x.id + '.label', 'fuel.kpi.' + x.id + '.sub']), []))
    .concat(M.VEHREG_FUEL_TOP.map((x) => 'fuel.top.' + x.id));
  const tabMissing = tabPaths.filter((pp) => {
    let c = con.site.vehreg;
    for (const k of pp.split('.')) {
      if (c == null || typeof c !== 'object') return true;
      c = c[k];
    }
    return c == null || c === '';
  });
  check('VR20. Табын харагдах текст бүр content.json-д бүртгэлтэй',
    tabMissing.length === 0, 'дутуу: ' + tabMissing.join(', '));
  check('VR20. Темплейтэд таб тууз ба түлшний таб холбогдсон',
    tpl.includes('{{ vehreg.tabs }}') && tpl.includes('{{ vehreg.isFuel }}') &&
    tpl.includes('{{ vehreg.isPending }}') && tpl.includes('{{ vehreg.fuel.kpis }}') &&
    tpl.includes('{{ vehreg.fuel.year.rows }}'),
    'tabs=' + tpl.includes('{{ vehreg.tabs }}'));
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
    check('AI7. Авто зам / авто тээврийн хамрах хүрээ — тоо огт алга, "мэдээлэл алга"',
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

/* ───────────────── VIS. ДЭЛГЭЦИЙН ХАРАГДАЦЫН АУДИТ ─────────────────
   Тоо, текст зөв байлаа ч ХАРАГДАЦ эвдэрч болно: график карт 2/3-аараа хоосон,
   текст виджетийн хүрээнээс гарсан, тэнхлэгийн шошго давхцсан/clip-д орсон.
   Эдгээр нь хэрэглэгч дээр л илэрдэг байсан тул хуудас бүрийг ЖИНХЭНЭ
   браузер дээр 1440/1024 өргөнөөр зурж DOM хэмжээгээр шалгана
   (tests/layout-audit.js, дүрмүүд tests/lib/layout-audit-probe.js).
   Шалгагчийн selftest фикстурууд эхэлж ажиллана — тэр унавал хуудасны
   үр дүнд итгэхгүй. Дэлгэрэнгүй: node tests/layout-audit.js --html */
/* ═════════════════════════════════════════════════════════════════
   HV. Графикийн hover стандарт (нэр + нийт дүн хулганаар харагдана)

   Яагаад энэ бүлэг байхгүй байсан бэ: өмнөх тестүүд "график зурагдсан,
   тоо зөв, текст холбогдсон" гэдгийг шалгадаг байсан ч ХУЛГАНЫГ ЗАЛГАСАН
   хэрэглэгчийн алхмыг (улсын цэг дээр очих) ХЭЗЭЭ Ч давтаагүй. Native SVG
   <title> нь DOM-д байгаа тул "tooltip бий" гэж харагддаг ч Electron/
   webview дээр огт гардаггүй, бусад хөтөч дээр ~1 сек хоцорч гардаг.

     HV1. Tooltip-ийн задлал (нэр — утга) гараар бодогдох фикстур дээр
     HV2. Статик: модуль ачаалагдсан, чимэглэлийн давхарга hover хаахгүй
     HV3. Браузер: глобус/хавтгай/дотоод бүх тэмдэг дээр tooltip = нэр+тоо
     HV4. Статистик нийцэл: нэг тоо хоёр газар өөр байж болохгүй
   ═════════════════════════════════════════════════════════════════ */
function hvClean(s) { return !/NaN|undefined|null|\[object|Infinity/.test(String(s)); }
async function groupHV() {
  group('HV. Графикийн hover стандарт (нэр + нийт дүн)');
  const idx = read('index.html');

  /* ── HV1. Модулийн задлал: гараар бодогдох фикстур ── */
  const T = (() => { try { return require(path.join(ROOT, 'js', 'erthub-tip.js')); } catch (e) { return null; } })();
  check('HV1. js/erthub-tip.js ачаалагдана (EHTip.parse)', !!T && typeof T.parse === 'function');
  if (T) {
    const a = T.parse('Хятад — 500,304 зорчигч');
    check('HV1. "Нэр — утга" → нэр ба утга салгагдана',
      a && a.name === 'Хятад' && a.value === '500,304 зорчигч', JSON.stringify(a));
    const b = T.parse('  Улаанбаатар (эх цэг)  ');
    check('HV1. Тусгаарлагчгүй текст → зөвхөн нэр',
      b && b.name === 'Улаанбаатар (эх цэг)' && b.value === '', JSON.stringify(b));
    check('HV1. Хоосон/null → tooltip ГАРАХГҮЙ (null)',
      T.parse('') === null && T.parse(null) === null && T.parse('   ') === null);
    const c = T.parse('Хонг Конг — 86,174 зорчигч — нэмэлт');
    check('HV1. Олон тусгаарлагч → эхнийх дээр л хуваана',
      c && c.name === 'Хонг Конг' && c.value === '86,174 зорчигч — нэмэлт', JSON.stringify(c));
  }

  /* ── HV2. Статик ── */
  check('HV2. Сайт tooltip модулийг ачаална', idx.includes('<script src="js/erthub-tip.js"></script>'));
  const a0 = idx.indexOf('<svg class="eh-fmap"');
  const tplFlow = idx.slice(a0, idx.indexOf('<sc-if value="{{ detail.flowMap.detail }}">', a0));
  [
    ['ripples', /<circle cx="\{\{ rp\.cx \}\}"[^>]*pointer-events="none"/],
    ['halos', /<circle cx="\{\{ ha\.cx \}\}"[^>]*pointer-events="none"/],
    ['arcs', /<path d="\{\{ ar\.d \}\}"[^>]*pointer-events="none"/],
    ['arcs dash', /<path d="\{\{ ar2\.d \}\}"[^>]*pointer-events="none"/],
    ['flyDots', /<g style="\{\{ fd\.style \}\}"[^>]*pointer-events="none"/],
    ['UB pulse', /r="15"[^>]*pointer-events="none"/]
  ].forEach(([n, re]) => check('HV2. Чимэглэл давхарга hover-ийг ХААХГҮЙ (' + n + ')', re.test(tplFlow), n));
  check('HV2. Улсын polygon нэр + дүн (title) агуулна',
    /<path d="\{\{ cp\.d \}\}"[^>]*><title>\{\{ cp\.title \}\}<\/title><\/path>/.test(tplFlow));
  check('HV2. Аймгийн polygon нэр + дүн (rg.title)', /<title>\{\{ rg\.title \}\}<\/title>/.test(tplFlow));
  check('HV2. .eh-tip хэв маяг style.css-д', /\.eh-tip\s*\{[^}]*pointer-events:\s*none/.test(read('style.css')));

  if (!CHROME) { skipped('HV3–HV4 (браузерын хэсэг)', 'Chrome олдсонгүй'); return; }
  const conH = readJson('content.json');
  const slugH = (d) => d.sector + '__' + String(d.name).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const air = (conH.site.datasets || []).find((x) => x.sector === 'air');
  if (!air) { skipped('HV3–HV4', 'агаарын датасэт content.json-д алга'); return; }
  const srv = serve();
  try {
    PROBE_SRC = '/index.html#/browse/' + encodeURIComponent(slugH(air));
    const probeSrc = '(' + require(path.join(ROOT, 'tests', 'lib', 'hover-probe.js')).toString() + ')';
    const R = await runProbe(probeSrc, 150000);
    if (R.__err) { bad('HV3. Hover шалгагч ажиллав', R.__err); return; }
    if (!R.ready) {
      skipped('HV3–HV4', 'газрын зургийн feed ирсэнгүй (сүлжээ/эх сурвалж) — худал FAIL гаргахгүй');
      return;
    }

    const num = (s) => { const m = String(s).replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? +m[0] : NaN; };
    [['intlGlobe', 'Бөмбөрцөг'], ['intlFlat', 'Хавтгай'], ['domestic', 'Дотоод']].forEach(([key, label]) => {
      const P = R.phases[key];
      if (!P) { bad('HV3. ' + label + ': газрын зураг зурагдсан', 'phase алга'); return; }
      const nodes = P.rows.filter((r) => r.kind === 'node');
      check('HV3. ' + label + ': бөмбөлөг/цэг байна (' + nodes.length + ')', nodes.length >= (key === 'domestic' ? 2 : 3));
      const noTip = P.rows.filter((r) => !r.tip.vis).map((r) => r.title);
      check('HV3. ' + label + ': ТЭМДЭГ БҮР дээр tooltip гарна (' + P.rows.length + ')',
        noTip.length === 0, 'tooltip-гүй: ' + noTip.slice(0, 5).join(' | '));
      const wrong = P.rows.filter((r) => r.tip.vis).filter((r) => {
        const want = T.parse(r.title);
        return !want || r.tip.name !== want.name || r.tip.value !== want.value;
      }).map((r) => r.title + ' → ' + r.tip.name + '/' + r.tip.value);
      check('HV3. ' + label + ': tooltip = нэр + дүн (title-тэй ЯГ ижил)', wrong.length === 0, wrong.slice(0, 4).join(' | '));
      const noVal = nodes.filter((r) => !(num(r.tip.value) >= 0)).map((r) => r.title);
      check('HV3. ' + label + ': бөмбөлөг бүр НЭР ба ТОО харуулна', noVal.length === 0, noVal.slice(0, 5).join(' | '));
      const junk = P.rows.filter((r) => !hvClean(r.title) || !hvClean(r.tip.name + r.tip.value)).map((r) => r.title);
      check('HV3. ' + label + ': NaN/undefined ил гарахгүй', junk.length === 0, junk.slice(0, 4).join(' | '));
      /* Polygon нь бөмбөлөг/тууз ДООР байх нь хэвийн — зөвхөн бөмбөлөгт шаардана */
      const blocked = nodes.filter((r) => !r.reach).map((r) => r.title);
      check('HV3. ' + label + ': тэмдэг бүр ХҮРЭГДЭНЭ (нисэх цэг/цагираг дарахгүй)',
        blocked.length === 0, blocked.slice(0, 5).join(' | '));
      const dbl = P.rows.filter((r) => r.tip.vis && (r.tip.native || !r.tip.restored)).map((r) => r.title);
      check('HV3. ' + label + ': native <title> давхцахгүй, hover дараа ЯГ буцна', dbl.length === 0, dbl.slice(0, 4).join(' | '));

      /* HV4. Статистик нийцэл — нэг тоо хоёр өөр байж болохгүй */
      const byName = {};
      nodes.forEach((r) => { const p = T.parse(r.title); (byName[p.name] = byName[p.name] || []).push(p.value); });
      const dup = Object.keys(byName).filter((k) => new Set(byName[k]).size > 1);
      check('HV4. ' + label + ': нэг нэр хоёр өөр дүнтэй биш', dup.length === 0, dup.join(', '));
      const polys = P.rows.filter((r) => r.kind === 'path');
      const polyBad = polys.filter((r) => { const p = T.parse(r.title); return byName[p.name] && byName[p.name][0] !== p.value; })
        .map((r) => r.title);
      check('HV4. ' + label + ': polygon-ы дүн бөмбөлгийнхтэй ЯГ ижил (' + polys.length + ')',
        polyBad.length === 0, polyBad.slice(0, 4).join(' | '));
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const legBad = nodes.filter((r) => {
        const p = T.parse(r.title), v = p.value.replace(/\s*зорчигч.*$/, '');
        const m = new RegExp(esc(p.name) + '\\s+(\\d[\\d,]*)').exec(P.cardText);
        return m && m[1] !== v;
      }).map((r) => r.title);
      check('HV4. ' + label + ': легендийн тоо tooltip-тэй тэнцүү', legBad.length === 0, legBad.slice(0, 4).join(' | '));
      if (key === 'domestic') {
        /* Аймгийн дүнгийн нийлбэр = нисэх буудлуудын нийлбэр: нэг зорчигч
           хоёр дахин тоологдох ч, алдагдах ч ёсгүй. */
        const sum = (arr) => arr.reduce((t, r) => t + (num(T.parse(r.title).value) || 0), 0);
        const nodeSum = sum(nodes), polySum = sum(polys.filter((r) => /[0-9]/.test(T.parse(r.title).value)));
        check('HV4. Дотоод: аймгуудын нийлбэр (' + polySum + ') = нисэх буудлуудын нийлбэр (' + nodeSum + ')',
          nodeSum === polySum, 'зөрүү ' + (nodeSum - polySum));
      }
      const vals = nodes.map((r) => num(r.tip.value));
      check('HV4. ' + label + ': зорчигчийн дүн сөрөг/бутархай биш бүхэл тоо',
        vals.every((v) => Number.isInteger(v) && v >= 0), vals.filter((v) => !(Number.isInteger(v) && v >= 0)).join(','));
    });
    check('HV3. "Хавтгай" ба "Дотоодын" товч олдлоо', R.hasProjTabs === true && R.hasDomestic === true,
      JSON.stringify({ proj: R.hasProjTabs, dom: R.hasDomestic }));

    /* Хуудасны бусад график (trend цэг, багана, ...) — ижил стандарт */
    const pg = R.page || [];
    const pgMiss = pg.filter((r) => !r.tip.vis).map((r) => r.title);
    check('HV3. Хуудасны бусад графикийн тэмдэг бүрд tooltip гарна (' + pg.length + '/' + R.pageTotal + ')',
      pgMiss.length === 0, pgMiss.slice(0, 5).join(' | '));
    /* Статистикч: тэгээс их тоо "0.0%" гэж харагдвал "огт байхгүй" гэж
       уншигдана (Европ — 589 зорчигч (0.0%) байсан). */
    const zeroPct = pg.map((r) => r.title).filter((t) => /\(0\.0%\)/.test(t) && /[1-9]/.test(t.split('(0.0%)')[0].split(' — ')[1] || ''));
    check('HV4. Тэгээс их дүн "0.0%" гэж харагдахгүй (<0.1%)', zeroPct.length === 0, zeroPct.slice(0, 4).join(' | '));
    const pgJunk = pg.filter((r) => !hvClean(r.title)).map((r) => r.title);
    check('HV3. Бусад графикийн tooltip-д NaN/undefined алга', pgJunk.length === 0, pgJunk.slice(0, 5).join(' | '));

    /* HV5. Дата тэмдэгтэй боловч ГАНЦ ч tooltip-гүй график байж болохгүй.
       Чимэглэл (hero дүрслэл, AI цөм, түүхийн шугам) нь жагсаалтад нэрээр
       бүртгэлтэй — шинэ график нэмбэл tooltip өгөх ЭСВЭЛ энд шалтгаантай
       нэмэх ёстой. */
    const DECOR = ['ErtHub AI CORE', 'НЭЭЛТТЭЙ ӨГӨГДӨЛ', 'COMMUNITY', 'САЛБАРЫН ТҮҮХ', 'ШИНЭЧЛЭЛ', 'Монголын зам'];
    const invOf = async (src) => {
      PROBE_SRC = src;
      return runProbe('(' + require(path.join(ROOT, 'tests', 'lib', 'hover-probe.js')).inventory.toString() + ')', 120000);
    };
    for (const [label, src] of [['нүүр', '/index.html#/'], ['агаарын датасэт', '/index.html#/browse/' + encodeURIComponent(slugH(air))]]) {
      const I = await invOf(src);
      if (I.__err) { bad('HV5. ' + label + ': инвентар ажиллав', I.__err); continue; }
      const naked = (I.svgs || []).filter((x) => x.w > 60 && x.h > 50 && x.shapes >= 2 && x.tips === 0)
        .filter((x) => !DECOR.some((k) => x.sec.indexOf(k) >= 0)).map((x) => x.sec + ' [' + x.shapes + ']');
      check('HV5. ' + label + ': tooltip-гүй график алга (' + (I.svgs || []).length + ' svg)', naked.length === 0, naked.join(' | '));
    }
  } finally {
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

async function groupVIS() {
  group('VIS. Дэлгэцийн харагдацын аудит (хуудас × өргөн)');
  if (!CHROME) { skipped('VIS. харагдацын аудит', 'Chrome олдсонгүй'); return; }
  const out = await new Promise((resolve) => {
    let buf = '';
    const ch = spawn(process.execPath, [path.join(ROOT, 'tests', 'layout-audit.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
    ch.stdout.on('data', (d) => { buf += d; });
    ch.stderr.on('data', (d) => { buf += d; });
    ch.on('close', () => resolve(buf));
  });
  const lines = out.split(String.fromCharCode(10));
  let cur = null, detail = [], n = 0, section = '';
  const flush = () => { if (cur) { cur.ok ? ok(cur.name) : bad(cur.name, detail.join(' | ').slice(0, 900)); } cur = null; detail = []; };
  lines.forEach((ln) => {
    const m = ln.match(/^ {2}(PASS|FAIL) {2}(.+?)(?: {2}\(\d+\))?$/);
    if (/^══ Шалгагчийн selftest/.test(ln)) { flush(); section = 'selftest'; return; }
    if (/^══ Хуудас/.test(ln)) { flush(); section = 'page'; return; }
    if (m) { flush(); n++; cur = { ok: m[1] === 'PASS', name: 'VIS. ' + (section === 'selftest' ? 'шалгагч: ' : 'харагдац ') + m[2] }; return; }
    if (cur && /^ {8}\S/.test(ln)) detail.push(ln.trim());
  });
  flush();
  check('VIS. аудит дуустал ажиллав (' + n + ' кейс)', n > 20 && /Харагдацын аудит:/.test(out), out.slice(-300));
}

/* ─────────── FM. Газрын зургийн шүүлт — "Бүгд" хасагдсан ───────────
   Улаанбаатараас чиглэсэн урсгалын газрын зураг дээр "Бүгд" сонголт байхгүй
   (дэлхийн горимд "Бүгд" = "Олон улсын" тул хоёр шүүлт зэрэг харагдаж
   төөрөлдүүлдэг байв). "Олон улсын" анхдагчаар идэвхтэй, "Дотоодын"
   дарахад шилжиж, буцааж дарахад эргэнэ.
   FM1 — сонголтын бүрдэл (статик)
   FM2 — DOM: 2 товч, анхдагч идэвхтэй, шилжилт */
function groupFM() {
  group('FM. Газрын зургийн шүүлт — "Бүгд" хасагдсан');
  const dc = dcScript();

  check('FM1. Газрын зургийн сонголт: зөвхөн "Олон улсын" ба "Дотоодын"',
    /const typeTabs=\[\['intl','Олон улсын'\],\['domestic','Дотоодын'\]\]\.map\(/.test(dc) &&
    !/const typeTabs=\[\['all'/.test(dc),
    'газрын зургийн толгойд "Бүгд" дахин орсон байна');
  check('FM1. "Олон улсын" идэвхтэй тодорхойлолт: airType !== "domestic"',
    dc.includes("key==='intl'?this.state.airType!=='domestic':this.state.airType===key"),
    'ОУ гэдэг нь "бүгд" горимд ч идэвхтэй харагдах ёстой');

  if (!CHROME) { skipped('FM2 (DOM)', 'Chrome олдсонгүй'); return; }
  return (async () => {
    const srv = serve();
    try {
      const con = readJson('content.json');
      const slugOf = (d) => d.sector + '__' + String(d.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
      const air = (con.site.datasets || []).find((d) => d.sector === 'air');
      if (!air) { bad('FM2. Агаарын датасэт олдсонгүй'); return; }
      PROBE_SRC = '/index.html#/browse/' + encodeURIComponent(slugOf(air));
      const R = await runProbe(`async function(d,w){
        const sleep=ms=>new Promise(r=>setTimeout(r,ms));
        const mb=()=>[...d.querySelectorAll('button')].filter(b=>b.style.padding==='6px 14px');
        const on=(b)=>b.style.background.indexOf('var(--ink)')>=0;
        const st=()=>mb().map(b=>b.textContent.trim()+':'+(on(b)?'ON':'off')).join(' ');
        for(let t=0;t<60&&mb().length<2;t++) await sleep(250);
        await sleep(1500);
        const R={count:mb().length, first:st()};
        const pick=async (label)=>{
          const b=mb().find(x=>x.textContent.trim()===label); if(!b) return;
          b.click();
          for(let t=0;t<30;t++){ await sleep(250);
            if(mb().some(x=>x.textContent.trim()===label&&on(x))) break; }
        };
        await pick('Дотоодын'); R.afterDom=st();
        await pick('Олон улсын'); R.back=st();
        return R;
      }`, 120000);
      if (R.__err) { bad('FM2. Газрын зургийн шалгалт ажиллав', R.__err); return; }
      check('FM1. DOM: газрын зургийн толгойд 2 сонголт (Бүгд алга)', R.count === 2,
        JSON.stringify(R));
      check('FM2. Анхдагчаар "Олон улсын" идэвхтэй, "Дотоодын" идэвхгүй',
        /Олон улсын:ON/.test(R.first) && /Дотоодын:off/.test(R.first), R.first);
      check('FM2. "Дотоодын" дарахад шилжинэ',
        /Дотоодын:ON/.test(R.afterDom) && /Олон улсын:off/.test(R.afterDom), R.afterDom);
      check('FM2. "Олон улсын" буцааж дарахад эргэнэ',
        /Олон улсын:ON/.test(R.back) && /Дотоодын:off/.test(R.back), R.back);
    } finally {
      PROBE_SRC = '/admin/index.html';
      srv.close();
    }
  })();
}

/* ═══════════════════════════════════════════════════════════════════
   SP. «Салбарын дэлгэрэнгүй» хуудас — ХҮРЭХ ЗАМГҮЙ үхмэл код

   Хуудас нь эхний коммитуудад (2026-08-20) темплейт болж бичигдсэн ч
   `page`-ийг 'sector' болгодог газар ХЭЗЭЭ Ч бичигдээгүй: PAGES-д ч
   'sector' алга, routeFromHash ч түүнийг танихгүй. 150 коммитын турш
   хэрэглэгч ТҮҮН РҮҮ ОРЖ ЧАДААГҮЙ.

   Бүр аюултай нь: зурагдвал `trend:buildTrendChart(as.c1d)` нь verified
   эсэхийг ШАЛГАХГҮЙ. Авто зам/ус/нийтийн тээвэрт `c1d` нь SECTORS
   тогтмолын СТАТИК ДЕМО тоо тул "Тоо ЗОХИОХГҮЙ" дүрэм зөрчсөн зохиомол
   муруй зурагдана. Нүүрийн 05-р хэсэг (t05) ба датасэтийн дэлгэрэнгүй
   хуудас ХОЁУЛАА үүнийг hasData/noData, hasTrend/noTrend-ээр аль хэдийн
   шийдсэн — зөвхөн энэ хуудас хоцорсон.

   Шийдэл: темплейт + builder + админы текст бүлэг + content.json-ы
   site.sector-ыг БҮРМӨСӨН устгав. Доорх тестүүд (а) хуудас үнэхээр
   хүрэхгүй байсныг, (б) үхмэл код буцаж ОРЖ ИРЭХГҮЙ байхыг, (в)
   ҮЛДСЭН buildTrendChart дуудлага бүр хамгаалалттай байхыг барина.
   ═══════════════════════════════════════════════════════════════════ */
function groupSP() {
  group('SP. Салбарын дэлгэрэнгүй — үхмэл хуудас устсан, муруй хамгаалалттай');
  const dc = dcScript(), tpl = indexTemplate(), adm = adminScript();
  const con = readJson('content.json');

  /* ── SP1. ХАРИУЦЛАГАТАЙ БАТАЛГАА: routeFromHash нь 'sector'-ыг танихгүй.
        PAGES ба функцийн БИЕИЙГ эх кодоос гаргаж, гараар бодох боломжтой
        хаягууд дээр ГҮЙЛГЭНЭ (нүдээр биш). ── */
  const pagesSrc = (dc.match(/const PAGES=(\[[\s\S]*?\]);/) || [])[1];
  const rfhBody = (dc.match(/\n  routeFromHash\(\)\{\n([\s\S]*?)\n  \}\n/) || [])[1];
  if (!pagesSrc || !rfhBody) {
    bad('SP1. PAGES / routeFromHash() эх кодоос олдсонгүй',
      'pages=' + !!pagesSrc + ' rfh=' + !!rfhBody);
  } else {
    const PAGES = new Function('return ' + pagesSrc)();
    /* DATASETS-гүйгээр ажиллана — 'sector' нь detach салаанд ОРДОГГҮЙ */
    const route = (hash) => new Function('PAGES', 'location',
      rfhBody)(PAGES, { hash });
    check('SP1. PAGES-д \'sector\' гэсэн хуудас АЛГА',
      !PAGES.some((p) => p.id === 'sector'), PAGES.map((p) => p.id).join(','));
    check('SP1. #/sector → маршрут АЛГА (null) — хуудас хүрэхгүй',
      route('#/sector') === null, JSON.stringify(route('#/sector')));
    check('SP1. #/sector/road → маршрут АЛГА (null)',
      route('#/sector/road') === null, JSON.stringify(route('#/sector/road')));
    /* Харнессийн эсрэг шалгуур — бодитой хаяг ТАНИГДАХ ёстой, эс тэгвэл
       дээрх хоёр тест "бүх юм null" гэсэн ХУДАЛ ногоон болно. */
    const rb = route('#/browse');
    check('SP1. Харнесс үнэн: #/browse → {page:browse} (бүх юм null БИШ)',
      rb && rb.page === 'browse', JSON.stringify(rb));
    const rh = route('#/history');
    check('SP1. Харнесс үнэн: #/history → {page:history}',
      rh && rh.page === 'history', JSON.stringify(rh));
  }

  /* ── SP2. Кодод page-ийг 'sector' болгодог газар АЛГА ── */
  check('SP2. page:\'sector\' гэсэн оноолт кодод АЛГА',
    !/page:\s*'sector'/.test(dc), (dc.match(/page:\s*'sector'/g) || []).join(','));
  check('SP2. go(\'sector\') гэсэн дуудлага АЛГА',
    !/go\(\s*'sector'\s*\)/.test(dc));

  /* ── SP3. Үхмэл темплейт + builder БҮРМӨСӨН устсан ── */
  check('SP3. Темплейтэд sectorPage.* холбоос АЛГА',
    !/sectorPage/.test(tpl), String((tpl.match(/sectorPage/g) || []).length) + ' холбоос');
  check('SP3. Темплейтэд isSector нөхцөл АЛГА', !/isSector/.test(tpl));
  check('SP3. Кодод sectorPage builder АЛГА',
    !/sectorPage/.test(dc), String((dc.match(/sectorPage/g) || []).length) + ' холбоос');
  check('SP3. Кодод isSector тугийн оноолт АЛГА', !/isSector/.test(dc));
  check('SP3. Зөвхөн энэ хуудсанд хэрэглэгддэг backToBrowse ч АЛГА',
    !/backToBrowse/.test(dc) && !/backToBrowse/.test(tpl));

  /* ── SP4. Админ ба content.json-оос текст бүлэг устсан (админд
        "Байршил тодорхойгүй" гэсэн үхмэл 3 талбар үлдэхгүй) ── */
  check('SP4. content.json → site.sector блок АЛГА',
    con.site.sector === undefined, JSON.stringify(con.site.sector));
  check('SP4. Админы SITE_GROUPS-д \'sector\' бүлэг АЛГА',
    !/\{key:'sector',\s*title:/.test(adm));
  check('SP4. Кодод sector.kicker / data_head / svc_head уншилт АЛГА',
    !/'sector\.(kicker|data_head|svc_head)'/.test(dc));
  /* Админы бусад 'sector' хэрэглээ (каталогийн "Салбар" талбар,
     facet_sector) нь ӨӨР зүйл — тэдгээр ХЭВЭЭР байх ёстой. */
  check('SP4. Каталогийн "Салбар" талбар (ds_cat.f_sector) ХЭВЭЭР',
    /ds_cat\.f_sector/.test(adm));
  check('SP4. Шүүлтийн facet_sector ХЭВЭЭР', /cat\.facet_sector/.test(adm));

  /* ── SP5. ҮНДСЭН ШАЛТГААН: buildTrendChart-ийн дуудлага бүр
        "дата үнэхээр ирсэн үү" гэдгээр хамгаалагдсан байх. Хамгаалалтгүй
        дуудлага = статик демо c1d-г амьд муруй болгон зурна. ── */
  const defCount = (dc.match(/function buildTrendChart\(/g) || []).length;
  check('SP5. buildTrendChart нэг л газар тодорхойлогдсон', defCount === 1, String(defCount));
  const lines = dc.split('\n');
  const callSites = [];
  lines.forEach((ln, i) => {
    if (!/buildTrendChart\(/.test(ln)) return;
    if (/function buildTrendChart\(/.test(ln)) return;
    callSites.push({ n: i + 1, line: ln.trim(), ctx: lines.slice(Math.max(0, i - 4), i + 1).join('\n') });
  });
  /* Датасэтийн дэлгэрэнгүй 1 + t05-ийн 3 салаа (spec-ийн цуваа /
     сарын цонх / хоосон 12 тэг) = 4. Салбарын хуудсыг устгаснаар
     5-аас 4 болов — 5 дахь нь ЯГ тэр хамгаалалтгүй as.c1d байв. */
  check('SP5. Дуудлагын газар 4 — датасэтийн дэлгэрэнгүй 1 + t05-ийн 3 салаа',
    callSites.length === 4, callSites.map((c) => c.n).join(','));
  /* Хамгаалалтын тэмдэг: verified тугийг уншсан, эсвэл ЗОРИУД хоосон
     (12 тэг) цуваа — хоёулаа "зохиомол демо тоо орохгүй" гэсэн утга. */
  const GUARD = /Verified|hasTrend|HasTrend|new Array\(12\)\.fill\(0\)/;
  const unguarded = callSites.filter((c) => !GUARD.test(c.ctx));
  check('SP5. Хамгаалалтгүй buildTrendChart дуудлага АЛГА',
    unguarded.length === 0,
    unguarded.map((c) => 'мөр ' + c.n + ': ' + c.line).join(' | '));
}

/* ─────────── OD. gov.opendata.mn-тэй жишсэн датасэтийн хуудас ───────────
   Үндэсний портал манай сервисийг датасэт бүрийн "API харах" цонхонд
   БОДИТ URL + JS/Python жишээгээр, "Бүрэн байдал / Давхцал"-ыг мөрөөс
   тооцож үзүүлдэг. Манайх зохиомол хост (api.erthub.gov.mn), хязгаар,
   түлхүүр, файлын хэмжээ үзүүлдэг байв.
   OD1 — datasetEndpoint: source → бодит URL
   OD2 — rowProfile: 3 мөрийн фикстур дээр бүрэн байдал / давхцал (гараар бодно)
   OD3 — зохиомол хост/түлхүүр/хэмжээ кодонд үлдээгүй
   OD4 — DOM: API цонх бодит URL, хэлний таб код солино, профайл гарна */
async function groupOD() {
  group('OD. Датасэтийн хуудас — gov.opendata.mn жишиг');
  const sc = dcScript();
  const grab = (re) => { const m = sc.match(re); return m ? m[0] : ''; };
  const apiSrc = grab(/\nconst API_ENDPOINTS=\[[\s\S]*?\n\];/);
  const epSrc = grab(/\nfunction datasetEndpoint\(dsel\)\{[\s\S]*?\n\}/);
  const snSrc = grab(/\nfunction apiSnippets\(url\)\{[\s\S]*?\n\}/);
  const rpSrc = grab(/\nfunction rowProfile\(head,rows\)\{[\s\S]*?\n\}/);
  check('OD0. Туслах функцууд олдов', !!(apiSrc && epSrc && snSrc && rpSrc));
  let F = null;
  try {
    F = new Function('ETRANSPORT_BACKEND_BASE',
      apiSrc + epSrc + snSrc + rpSrc + '\nreturn {datasetEndpoint,apiSnippets,rowProfile};')('https://portal.mrt.gov.mn');
  } catch (e) { bad('OD0. Функцууд үнэлэгдэв', e.message); }
  if (F) {
    const ep = (src) => F.datasetEndpoint({ source: src });
    check('OD1. railPax → portal.mrt.gov.mn/api/sectors/rail/summary (нэр нь зөрдөг ч source-оор олдоно)',
      (ep('railPax') || {}).url === 'https://portal.mrt.gov.mn/api/sectors/rail/summary', JSON.stringify(ep('railPax')));
    check('OD1. flights → бүтэн хаягаараа (backend-ийн BASE залгахгүй)',
      /^https:\/\/otgonerdene02-cmyk\.github\.io\/.*flights-index\.json$/.test((ep('flights') || {}).url || ''));
    check('OD1. Хост нь URL-аас гарна', (ep('roadInspect') || {}).host === 'portal.mrt.gov.mn');
    check('OD1. Бүртгэлгүй source → null (зохиомол URL үүсгэхгүй)', ep('nope') == null && F.datasetEndpoint({}) == null);
    const ds41 = sc.match(/\nconst DATASETS=\[([\s\S]*?)\n\];/);
    const srcs = ds41 ? (ds41[1].match(/source:'(\w+)'/g) || []).map((x) => x.slice(8, -1)) : [];
    check('OD1. Каталогийн датасэт бүр бодит endpoint-той', srcs.length > 0 && srcs.every((k) => !!ep(k)), srcs.join(','));
    const sn = F.apiSnippets('https://x.test/a');
    check('OD1. Жишээ код 3 хэлээр, бүгд ЯГ тэр URL-тай, түлхүүргүй',
      ['curl', 'js', 'py'].every((k) => sn[k].includes('https://x.test/a') && !/Api-Key|ERTHUB_KEY/.test(sn[k])));
    /* 3 мөр × 3 багана = 9 нүд; хоосон 3 ('' ×2, '—' ×1) → 6/9 = 66.7%;
       1-р ба 3-р мөр ижил → давхцал 1 */
    const P = F.rowProfile(['a', 'b', 'c'], [['1', '', 'ok:x'], ['2', '—', 'ok:x'], ['1', '', 'ok:x']]);
    check('OD2. rowProfile: мөр 3, багана 3', P && P.rows === 3 && P.cols === 3, JSON.stringify(P));
    check('OD2. Бүрэн байдал 66.7% (6/9 нүд)', P && P.completeness === 66.7, P && P.completeness);
    check('OD2. Давхардсан мөр 1', P && P.dupRows === 1, P && P.dupRows);
    check('OD2. Хоосон дата → null (0% гэж зохиохгүй)', F.rowProfile(['a'], []) === null);
  }
  const idx = read('index.html'), con = readJson('content.json');
  check('OD3. "api.erthub.gov.mn" хост мөр утга болж үлдээгүй',
    !/'[^'\n]*api\.erthub\.gov\.mn/.test(sc) && !/>api\.erthub\.gov\.mn</.test(idx));
  check('OD3. Хуурамч түлхүүр eh_live_ алга', !idx.includes('eh_live_'));
  check('OD3. Зохиомол файлын хэмжээ (≈240 KB …) алга', !/≈\d[\d.]* ?(KB|MB)/.test(idx));
  check('OD3. Лиценз dq.license:false-тэй НИЙЦНЭ (CC-BY гэж зарлахгүй)',
    !/CC-BY/.test(con.site.detail.license) && !sc.includes("['Түүх','2021 оноос']"));
  /* Регресс: профайл render БҮРТ (датасэтийн хуудас хаалттай үед ч) 16мянга+
     мөрийг тоолж байсан → админы preview удааширч "0" харуулав (F1/I5/I7/J4). */
  const pg = sc.match(/if\(this\.state\.page==='detail'\)\{\s*if\(!this\._dsProfCache[\s\S]{0,200}?rowProfile\(/);
  check('OD3. rowProfile зөвхөн датасэтийн хуудас нээлттэй үед тооцогдоно',
    !!pg && (sc.match(/rowProfile\(dsSc/g) || []).length === 1);
  check('OD3. Шинэ текст content.json-д', ['copy_btn', 'profile_head', 'prof_complete', 'spec_access_v', 'file_api']
    .every((k) => typeof con.site.detail[k] === 'string'));

  if (!CHROME) { skipped('OD4 (DOM)', 'Chrome олдсонгүй'); return; }
  const srv = serve();
  try {
    const slugOf = (d) => d.sector + '__' + String(d.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
    const runFor = async (d) => {
      PROBE_SRC = '/index.html#/browse/' + encodeURIComponent(slugOf(d));
      return runProbe(`async function(d,w){
        const sleep=ms=>new Promise(r=>setTimeout(r,ms));
        for(let t=0;t<40&&!d.querySelector('[data-ds-profile]');t++) await sleep(250);
        await sleep(3500);
        const btn=[...d.querySelectorAll('button')].find(b=>/API холбогдох/.test(b.textContent));
        if(!btn) return {__err:'API товч алга'};
        btn.click(); await sleep(500);
        const R={};
        const ep=d.querySelector('[data-ds-endpoint]'); R.ep=ep?ep.textContent.trim():'';
        const code=()=>{const c=d.querySelector('[data-ds-code]');return c?c.textContent:'';};
        R.curl=code();
        const py=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()==='Python');
        if(py){ py.click(); await sleep(400); }
        R.py=code();
        const pf=d.querySelector('[data-ds-profile]'); R.prof=pf?pf.innerText:'';
        R.text=d.body.innerText;
        return R;
      }`, 120000);
    };
    const dsl = con.site.datasets || [];
    const air = dsl.find((d) => d.sector === 'air'), pax = dsl.find((d) => /Зорчигч/.test(d.name));
    const A = await runFor(air);
    if (A.__err) bad('OD4. Агаарын датасэтийн API цонх', A.__err);
    else {
      check('OD4. Агаар: endpoint = бодит feed URL', /flights-index\.json$/.test(A.ep), A.ep);
      check('OD4. Агаар: cURL код ЯГ тэр URL-тай', A.curl.includes(A.ep) && /^curl /.test(A.curl), A.curl);
      check('OD4. Python таб дарахад код СОЛИГДОНО', A.py !== A.curl && /requests\.get/.test(A.py), A.py);
      check('OD4. Хуудсанд api.erthub.gov.mn / "10 дуудлага/сек" алга',
        A.text.indexOf('api.erthub.gov.mn') < 0 && A.text.indexOf('10 дуудлага/сек') < 0);
      check('OD4. Профайл блок: хэмжилт ЭСВЭЛ "мэдээлэл алга"',
        /Бүрэн байдал[\s\S]*%/i.test(A.prof) || /мэдээлэл алга/.test(A.prof), A.prof.slice(0, 160));
    }
    const B = await runFor(pax);
    if (B.__err) bad('OD4. Зорчигчийн датасэтийн API цонх', B.__err);
    else check('OD4. Зорчигч: /api/sectors/rail/summary (өөр датасэтийн URL биш)',
      /portal\.mrt\.gov\.mn\/api\/sectors\/rail\/summary$/.test(B.ep), B.ep);

    /* OD5. Регресс: "Төрөл → Дотоодын" сонгоход ОУ НИСЛЭГ / ОУ ЗОРЧИГЧ карт
       "0 / 0.0%" гэж харагдаж өгөгдөл алга мэт төөрөгдүүлдэг байв. Одоо "—" +
       шалтгаан; "Бүгд" руу буцахад тоо буцна. */
    PROBE_SRC = '/index.html#/browse/' + encodeURIComponent(slugOf(air));
    const E = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const cards=()=>{ const out={};
        [...d.querySelectorAll('span,div')].filter(e=>e.children.length===0&&/^(ОУ НИСЛЭГ|ОУ ЗОРЧИГЧ|ДОТООД ЗОРЧИГЧ)$/i.test(e.textContent.trim()))
          .forEach(e=>{ const k=e.textContent.trim().toUpperCase();
            /* {{ }} нь span-д ороогддог — шошгоны div биш КАРТ хүртэл дээш алхана */
            let c=e.parentElement, t='';
            for(let i=0;c&&i<4;i++,c=c.parentElement){ t=c.innerText.replace(/\\s+/g,' ').trim(); if(t.length>k.length+2) break; }
            if(t.length>k.length+2&&t.length<400&&(!out[k]||t.length<out[k].length)) out[k]=t; });
        return out; };
      for(let t=0;t<60;t++){ const c=cards(); if(c['ОУ НИСЛЭГ']&&/\\d/.test(c['ОУ НИСЛЭГ'])) break; await sleep(300); }
      await sleep(1500);
      const R={all:cards()};
      const fb=[...d.querySelectorAll('button')].find(b=>/Шүүлт/.test(b.textContent)&&b.getBoundingClientRect().top<500);
      if(fb){ fb.click(); await sleep(800); }
      const dom=[...d.querySelectorAll('span')].find(e=>e.children.length===0&&e.textContent.trim()==='Дотоодын'
        &&e.getBoundingClientRect().top>0&&e.getBoundingClientRect().top<900);
      /* "Бүгд" нь он/чиглэл/бүсийн мөрөнд ч бий — ЗӨВХӨН «Төрөл»-ийн мөрийнхийг */
      const rowTop=dom?Math.round(dom.getBoundingClientRect().top):-1;
      R.picked=!!dom; if(dom) dom.click(); await sleep(1500); R.dom=cards();
      const all=[...d.querySelectorAll('span')].find(e=>e.children.length===0&&e.textContent.trim()==='Бүгд'
        &&Math.abs(Math.round(e.getBoundingClientRect().top)-rowTop)<4);
      if(all) all.click(); await sleep(1500); R.back=cards();
      return R;
    }`, 150000);
    if (E.__err) bad('OD5. Төрлийн шүүлтийн KPI шалгагч', E.__err);
    else if (!E.picked || !/\d/.test(E.all['ОУ НИСЛЭГ'] || '')) {
      skipped('OD5', 'нислэгийн feed ирсэнгүй (сүлжээ) — худал FAIL гаргахгүй');
    } else {
      check('OD5. Дотоодын шүүлт: ОУ НИСЛЭГ карт "0" БИШ — "—" + шалтгаан',
        /—/.test(E.dom['ОУ НИСЛЭГ']) && !/(^|\s)0(\s|$)/.test(E.dom['ОУ НИСЛЭГ']) && /шүүлтээр хасагдсан/.test(E.dom['ОУ НИСЛЭГ']),
        E.dom['ОУ НИСЛЭГ']);
      check('OD5. Дотоодын шүүлт: ОУ ЗОРЧИГЧ карт "—" + шалтгаан, "0.0%" алга',
        /—/.test(E.dom['ОУ ЗОРЧИГЧ']) && /шүүлтээр хасагдсан/.test(E.dom['ОУ ЗОРЧИГЧ']) && !/0\.0%/.test(E.dom['ОУ ЗОРЧИГЧ']),
        E.dom['ОУ ЗОРЧИГЧ']);
      check('OD5. Дотоодын шүүлт: ДОТООД ЗОРЧИГЧ карт тоотой хэвээр', /\d/.test(E.dom['ДОТООД ЗОРЧИГЧ']) && !/—/.test(E.dom['ДОТООД ЗОРЧИГЧ']),
        E.dom['ДОТООД ЗОРЧИГЧ']);
      check('OD5. "Бүгд" руу буцахад ОУ НИСЛЭГ тоо буцна (зөвхөн шүүлтийн үед хасагдана)',
        E.back['ОУ НИСЛЭГ'] === E.all['ОУ НИСЛЭГ'] && !/—/.test(E.back['ОУ НИСЛЭГ']), E.back['ОУ НИСЛЭГ']);
    }
  } finally {
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* ══════════════════════════════════════════════════════════════════
   HS. НҮҮРИЙН ХАЙЛТ → ДАТАСЭТИЙН ХУУДАС

   Хайлт ЗӨВХӨН "Нээлттэй өгөгдөл" каталогийн датасэтээс (DATASETS)
   олно; дарахад тухайн датасэтийн хуудас руу шууд үсэрнэ.
   searchDatasets() нь index.html-ээс задлагдаж, 3 датасэтийн
   ГАРААР БОДОХ БОЛОМЖТОЙ фикстур дээр шалгагдана.
   ══════════════════════════════════════════════════════════════════ */
function groupHS() {
  group('HS. Нүүрийн хайлт → датасэт');
  const idx = read('index.html');
  const m = idx.match(/function searchDatasets\(q\)\{[\s\S]*?\n\}\r?\n/);
  if (!m) { bad('HS. searchDatasets() олдсонгүй'); return; }
  const DATASETS = [
    { sector: 'air', name: 'Агаарын тээврийн статистик', agency: 'ИНЕГ', desc: 'Нислэг, зорчигч.' },
    { sector: 'rail', name: 'Вагон ачилт', agency: 'УБТЗ', desc: 'Агаар биш, төмөр зам.' },
    { sector: 'road', name: 'Техникийн үзлэг', agency: 'ЗТХЕГ', desc: 'Тээврийн хэрэгсэл.' }
  ];
  const SECTORS = { air: { label: 'Агаарын тээвэр' }, rail: { label: 'Төмөр зам' }, road: { label: 'Авто зам' } };
  const S = new Function('DATASETS', 'SECTORS', m[0] + '\nreturn searchDatasets;')(DATASETS, SECTORS);
  const names = (q) => S(q).map(d => d.name);

  check('HS1. "агаар" → нэрээр тохирсон нь ЭХЭНД, тайлбараар тохирсон нь дараа',
    JSON.stringify(names('агаар')) === JSON.stringify(['Агаарын тээврийн статистик', 'Вагон ачилт']),
    JSON.stringify(names('агаар')));
  check('HS2. Том/жижиг үсэг ялгахгүй', names('АГААР').length === 2);
  check('HS3. Байгууллагаар олдоно (УБТЗ → вагон)', names('убтз')[0] === 'Вагон ачилт');
  check('HS4. Түлхүүр үг бүр тохирно (AND): "агаар зорчигч" → 1', names('агаар зорчигч').length === 1);
  check('HS5. Тохирохгүй → хоосон (зохиомол үр дүн гаргахгүй)', S('xyz').length === 0);
  check('HS6. Хоосон хайлт → хоосон', S('  ').length === 0 && S('').length === 0);
  check('HS7. Салбарын нэрээр олдоно ("авто" → Техникийн үзлэг)', names('авто')[0] === 'Техникийн үзлэг');

  /* Сайт талын холболт: Enter/товч/дарах бүгд датасэтийн хуудас руу */
  const flat = idx.replace(/\s+/g, ' ');
  check('HS8. Санал нь DATASETS-ээс (каталогоос өөр жагсаалт биш)',
    flat.includes('searchDatasets(homeQ).slice(0,6)') && /DATASETS\.forEach/.test(m[0]));
  check('HS9. Дарах/Enter → openDataset (датасэтийн хуудас)',
    /const homeOpenDs=\(d\)=>\{.{0,200}this\.openDataset\(d,/.test(flat) &&
    /const homeSubmit=\(\)=>\{ if\(homeHits\.length\) homeOpenDs\(homeHits\[homeSugActive\]\)/.test(flat));
  check('HS10. Тохирох нь байхгүй үед каталог руу (хоосон төлөвийн зөвлөгөөтэй)',
    /else homeToCatalog\(\)/.test(flat));
  check('HS11. Санал нь mousedown-аар (blur нь жагсаалтыг дарахаас өмнө хаахгүй)',
    /data-home-sug-item="1" sc-camel-on-mouse-down="\{\{ hs\.open \}\}"/.test(idx));
  const con = readJson('content.json'), adm = read('admin/index.html');
  check('HS12. Шинэ текст content.json (site.hero + ui_form) ба админы бүртгэлд',
    !!(con.site.hero.search_empty && con.site.hero.search_catalog) &&
    /search_empty:'/.test(adm) && /search_catalog:'/.test(adm) &&
    JSON.stringify(con.ui_form).includes('"search_empty"') && JSON.stringify(con.ui_form).includes('"search_catalog"'));
}

/* ═══════════════════════════════════════════════════════════════
   DG. ДОМЭЙНЫ ТОЛЬ + ГРАФИКИЙН SANITY (js/erthub-glossary.js)

   Агаарын хуудасны 4 алдааны регресс:
   (1) "Орон нутаг"/ОН дотоод гэж танигдаагүй, «Төрөл»=ОУ шүүлтээр донут
       100% ОУ болж дотоодыг нуусан;
   (2) дутуу сар бүтэн сар мэт, Y тэнхлэг 500-аас эхэлсэн;
   (3) тээвэрлэгчийн хувь = зорчигч, дэд мөр = нислэг (нэгж ХУТГАГДСАН);
   (4) мөр хоорондын багана зөрсөн.
   Бүгд ГАРААР БОДОХ БОЛОМЖТОЙ жижиг фикстур дээр.
   ═══════════════════════════════════════════════════════════════ */
/* ─────────── FR. Ачаа тээврийн мэдээ (УБТЗ ХНН · МТЗ ТӨХК, 2026-10-19) ───────────
   Veritech-ийн баримтын 7–9-р мөр. Анализын модель ба графикийг ГАРААР бодогдох
   3 сарын фикстур дээр (нүдээр "зөв харагдана" гэж батлахгүй):
     2025-09 бүтэн: транзит 10т/1в · экспорт 100/2 · дотоод 40/1          = 150 т · 4 в
     2026-09 бүтэн: транзит 20/1 · экспорт 110/2 · импорт 10/1 · дотоод 60/2 = 200 т · 6 в
     2026-10 (10-18 хүртэл, ДУТУУ): экспорт 50/1 · дотоод 10/1             =  60 т · 2 в
   Нийт 410 т · 12 вагон · 78 өдөр. YoY = 2026-09 / 2025-09 = 200/150 − 1 = +33.3%. */
function groupFR() {
  group('FR. Ачаа тээврийн мэдээ — модель · график · холболт');
  const src = dcScript();
  const fam = src.match(/\nfunction freightAnalysisModel\(all,sel,year,mr\)\{([\s\S]*?)\n\}/);
  const yoc = src.match(/\nfunction yoyCompare\(months,yr,mFrom,mTo,key\)\{([\s\S]*?)\n\}/);
  const dirsM = src.match(/const FREIGHT_DIRS=(\[[^\]]*\]);/);
  check('FR0. freightAnalysisModel + yoyCompare + FREIGHT_DIRS тодорхойлогдсон', !!(fam && yoc && dirsM));
  if (!(fam && yoc && dirsM)) return;
  const YOC = new Function('months', 'yr', 'mFrom', 'mTo', 'key', yoc[1]);
  const minM = src.match(/const FREIGHT_YOY_MIN=([0-9]+);/);
  check('FR0. FREIGHT_YOY_MIN = 3 (YoY хамгийн багадаа 3 бүтэн хос сар)', !!minM && +minM[1] === 3);
  const FA = (all, sel, year, mr) => new Function('FREIGHT_DIRS', 'FREIGHT_YOY_MIN', 'yoyCompare', 'all', 'sel', 'year', 'mr', fam[1])(eval(dirsM[1]), minM ? +minM[1] : 3, YOC, all, sel, year, mr);
  const fm = (month, days, last, d) => Object.assign({ month, days, days_in_month: 30, last_date: last, rows: 10,
    transit_tonnes: 0, transit_wagons: 0, export_tonnes: 0, export_wagons: 0, import_tonnes: 0, import_wagons: 0, domestic_tonnes: 0, domestic_wagons: 0 }, d);
  const ALL = { status: 'ok', months: [
    fm('2025-09', 30, '2025-09-30', { transit_tonnes: 10, transit_wagons: 1, export_tonnes: 100, export_wagons: 2, domestic_tonnes: 40, domestic_wagons: 1 }),
    fm('2026-09', 30, '2026-09-30', { transit_tonnes: 20, transit_wagons: 1, export_tonnes: 110, export_wagons: 2, import_tonnes: 10, import_wagons: 1, domestic_tonnes: 60, domestic_wagons: 2 }),
    fm('2026-10', 18, '2026-10-18', { export_tonnes: 50, export_wagons: 1, domestic_tonnes: 10, domestic_wagons: 1 })],
    by_station: [{ station: 'А', export_tonnes: 100, domestic_tonnes: 20, export_wagons: 2 }, { station: 'Б', transit_tonnes: 30, export_tonnes: 60, transit_wagons: 1 }],
    by_cargo: [{ cargo: 'Бусад', domestic_tonnes: 50 }, { cargo: 'Нүүрс', export_tonnes: 160 }] };
  const m = FA(ALL, null, 'all');
  check('FR1. Нийт 410 т, 12 вагон, 78 өдөр; вагон бүрт 410/12, өдөрт 410/78',
    m.hasData && m.tonnes === 410 && m.wagons === 12 && m.days === 78 &&
    Math.abs(m.perWagon - 410 / 12) < 1e-9 && Math.abs(m.perDay - 410 / 78) < 1e-9, JSON.stringify([m.tonnes, m.wagons, m.days]));
  check('FR2. Зөвхөн СҮҮЛИЙН сар (10-18 < 10-31) дутуу, шошго "*"; дунд 11 сар хоосон слот',
    m.partialN === 1 && m.series.labels[m.series.labels.length - 1] === '26-10*' &&
    m.series.gap.filter(Boolean).length === 11 && m.series.labels[1] === '25-10' && m.series.dirs.export[1] === null,
    JSON.stringify(m.series.labels));
  const sumPct = m.dirs.reduce((t, d) => t + d.pct, 0);
  const ex = m.dirs.find(d => d.key === 'export');
  check('FR3. Чиглэлийн хувь нийлбэр 100%, экспорт = 260/410', Math.abs(sumPct - 100) < 1e-9 && Math.abs(ex.pct - 260 / 410 * 100) < 1e-9,
    JSON.stringify(m.dirs));
  /* Регресс (2026-10-19 UX аудит): МТЗ дээр ганц хос сар (2026-01/2025-01) "+535.8%" гэж гарч байв */
  check('FR4. Ганц бүтэн хос сар (2026-09/2025-09) → YoY ГАРАХГҮЙ, шалтгаан "few"',
    m.yoy === null && m.yoyReason === 'few', JSON.stringify([m.yoy, m.yoyReason]));
  const Y3 = FA({ status: 'ok', months: ['07', '08', '09'].flatMap((mo, i) => [
    fm('2025-' + mo, 31, '2025-' + mo + '-30', { export_tonnes: 100, export_wagons: 2 }),
    fm('2026-' + mo, 31, '2026-' + mo + '-30', { export_tonnes: 110 + i * 10, export_wagons: 2 })]) }, null, 'all');
  check('FR4. 3 бүтэн хос сар: (110+120+130)/(3×100) − 1 = +20.0%',
    !!Y3.yoy && Math.abs(Y3.yoy.pct - 20) < 1e-9 && Y3.yoy.months === 3, JSON.stringify(Y3.yoy));
  const mtz = FA({ status: 'ok', months: [fm('2024-01', 5, '2024-01-31', { domestic_tonnes: 300, domestic_wagons: 5 }),
    fm('2024-02', 3, '2024-02-29', { domestic_tonnes: 100, domestic_wagons: 2, export_tonnes: 20, export_wagons: 1 })] }, null, 'all');
  check('FR5. МТЗ шиг: транзит/импорт ОГТ алга бол харьцаа/легендэд гарахгүй (зөвхөн экспорт + дотоод)',
    JSON.stringify(mtz.present) === '["export","domestic"]' && mtz.dirs.length === 2, JSON.stringify(mtz.present));
  check('FR6. Өдрийн тоо цөөн (5/31) ч сарын сүүлийн өдөртэй бол дутуу БИШ (МТЗ өдөр бүр бүртгэдэггүй)',
    mtz.partialN === 0, String(mtz.partialN));
  const mk = FA(ALL, null, 'all', { keys: new Set(['Б']) });
  check('FR7. Хүснэгтийн өртөөний шүүлт (FL3) → зөвхөн өртөөний эрэмбэ шүүгдэнэ, KPI хэвээр',
    mk.stations.length === 1 && mk.stations[0].name === 'Б' && mk.stationTotal === 90 && mk.tonnes === 410);
  check('FR8. Ачааны эрэмбэ тонноор буурахаар (Нүүрс 160 > Бусад 50)',
    m.cargo.filter(c => !c.unnamed)[0].name === 'Нүүрс' && m.cargo.filter(c => !c.unnamed)[1].name === 'Бусад');
  /* Регресс (2026-10-19 UX аудит): нэргүй мөр задаргаанд ороогүй тул «Нийт» KPI-аас дутуу (МТЗ 13%) */
  check('FR8. Нэргүй үлдэгдэл (410 − 210 = 200) тусдаа мөр → эрэмбийн нийт = KPI-ийн нийт 410',
    m.cargo.length === 3 && m.cargo[0].unnamed && m.cargo[0].tonnes === 200 && m.cargoTotal === 410 && m.stationTotal === 410,
    JSON.stringify([m.cargoTotal, m.stationTotal]));
  const y25 = FA(ALL, null, 2025);
  const y25s = FA(ALL, { status: 'ok', months: [], by_station: [{ station: 'А', export_tonnes: 7 }], by_cargo: [] }, 2025);
  check('FR9. Он сонгоход KPI тэр оных (150 т), задаргаа сонгосон хүрээний хариуг хүлээнэ (sel=null → pending)',
    y25.tonnes === 150 && !y25.hasBreakdown && y25s.hasBreakdown && y25s.stations.find(s => s.name === 'А').tonnes === 7);
  check('FR10. Түүх алга / no_data / буруу хариу → hasData:false (тоо зохиохгүй)',
    !FA(null).hasData && !FA({ status: 'no_data', months: [] }).hasData && !FA({ status: 'ok' }).hasData);
  check('FR11. Сонгосон хүрээнд сар алга бол hasData:false, гэхдээ жилүүдийг буцаана (шүүлт харагдсаар)',
    FA(ALL, null, 2024).hasData === false && JSON.stringify(FA(ALL, null, 2024).years) === '[2025,2026]');

  const bc = src.match(/\nfunction buildFreightStackedChart\(stacks,lineSeries,labels,gaps,words\)\{([\s\S]*?)\n\}/);
  check('FR12. buildFreightStackedChart тодорхойлогдсон', !!bc);
  if (bc) {
    const BC = new Function('stacks', 'lineSeries', 'labels', 'gaps', 'words', bc[1]);
    const stacks = m.present.map(d => ({ key: d, label: d, color: '#000', values: m.series.dirs[d] }));
    const c = BC(stacks, m.series.wagons, m.series.labels, m.series.gap, {});
    const sep = c.barRects.find(r => /^26-09 — /.test(r.tip));
    check('FR12. Hover: "26-09 — export: 110 т · … · нийт: 200 т" (HV: нэр — утга)',
      !!sep && /export: 110 т/.test(sep.tip) && /нийт: 200 т/.test(sep.tip), sep && sep.tip);
    check('FR12. Өгөгдөлгүй сар — бүдэг тууз + "мэдээлэл алга" (0 багана зурахгүй)',
      c.barRects.filter(r => /мэдээлэл алга/.test(r.tip)).length === 11);
    check('FR12. Y тэнхлэг 0-ээс, дутуу сар шугамд холбогдохгүй (2 бүтэн сар → нэг M + нэг M)',
      c.yTicksLeft[0].label === '0' && (c.line.match(/M/g) || []).length === 2 && !/L/.test(c.line), c.line);
    check('FR12. Дутуу сарын цэгийн tooltip-д "(дутуу сар)"', /\(дутуу сар\)/.test(c.dotPts[c.dotPts.length - 1].tip));
  }

  /* Холболт — нэг датасэт нэмэхэд хамт өөрчлөгдөх ёстой газрууд (CLAUDE.md RAW: backend
     DATASETS + index.html DS_ROWS_API + feed-fixtures). */
  const fxSrc = read('tests/lib/feed-fixtures.js');
  const content = JSON.parse(read('content.json'));
  for (const [srcKey, rowsKey, schema, name] of [['railFreightUbtz', 'rail-freight-ubtz', 'rail_freight_ubtz', 'Ачаа тээврийн мэдээ (УБТЗ ХНН)'],
    ['railFreightMtz', 'rail-freight-mtz', 'rail_freight_mtz', 'Ачаа тээврийн мэдээ (МТЗ ТӨХК)'],
    ['railFreightAll', 'rail-freight-all', 'rail_freight_all', 'Төмөр замын ачаа тээврийн нэгтгэл']]) {
    check('FR13. ' + srcKey + ': DATASETS + SOURCES + DS_ROWS_API + DS_ROWS_SCOPE + DS_SCHEMA + API_ENDPOINTS',
      src.includes("name:'" + name + "'") && src.includes("schema:'" + schema + "',source:'" + srcKey + "'") &&
      new RegExp(srcKey + ":\\{label:").test(src) && src.includes(srcKey + ":'" + rowsKey + "'") &&
      src.includes(srcKey + ":{col:'station_name'}") && src.includes('  ' + schema + ':{head:') &&
      src.includes("'" + srcKey + "'],"));
    check('FR14. ' + rowsKey + ': фикстурт түүхий мөр + түүх (layout-audit/FL11 өгөгдөлтэй төлөв)',
      fxSrc.includes("'" + rowsKey + "'") && /rail\\\/freight\\\/\(\[a-z\]\+\)\\\/history/.test(fxSrc));
    check('FR15. content.json site.datasets-д ' + name + ' (индексээр давхардана)',
      content.site.datasets.some(d => d.name === name));
  }
  const dsBlock = (src.split('\nconst DATASETS=[')[1] || '').split('\n];')[0];
  const dsN = (dsBlock.match(/\n  \{sector:'[a-z]+',name:'/g) || []).length;
  check('FR15. content.json site.datasets ба DATASETS ижил урттай (индексийн давхарга зөрөхгүй)',
    dsN > 0 && content.site.datasets.length === dsN, content.site.datasets.length + ' / ' + dsN);
  /* Регресс (2026-10-19): түүхий мөрийн хүснэгтэд pvColScope().schemaKey = "<схем>__raw"
     болсноос хойш FL3-ийн тайлбар БҮХ датасэт дээр note_default ("зөвхөн хүснэгтэд")
     болж ХУДАЛ хэлж байв — KPI/эрэмбэ дагаж байхад. */
  check('FR16. FL3 тайлбар __raw түлхүүрээс схемийн нэрийг авна (бүх датасэт)',
    /\}\[String\(pvSc\.schemaKey\|\|''\)\.replace\(\/__raw\$\/,''\)\]/.test(src) &&
    src.includes("rail_freight_ubtz:()=>stxt('pv_scope.note_rail_freight'"));
  check('FR17. Ачааны хуудсанд салбарын ерөнхий «чиг хандлага + бүтэц» мөр гарахгүй (өөрийн самбартай)',
    src.includes('notRoadInspect:!isRoadInspect&&!isFreight&&!isSumTotal'));
  check('FR18. Түүх нэг удаа ачаалж каталогийн «Сүүлийн бичлэг»-ийг backend-ийн огнооноос',
    /async loadFreightHistory\(source\)\{[\s\S]*?setSourceMeta\(source,\{updatedAt:m\.lastDate/.test(src));
  check('FR19. EHBackend.fetchRailFreightHistory — org-ийг шалгаж /api/sectors/rail/freight/:org/history',
    /function fetchRailFreightHistory\(org, from, to\)[\s\S]*?\/\^\[a-z\]\+\$\/[\s\S]*?\/api\/sectors\/rail\/freight\//.test(read('js/erthub-backend.js')));
  /* Регресс — chart-stat-qa (2026-10-19): тоо зөв ч ШОШГО худал байсан 3 газар */
  check('FR20. «Вагон» KPI «ачаатай» гэж хэлэхгүй (эх датанд хоосон вагон/чингэлэг 19–39%)',
    !/kpi_wagons_sub','ачаатай вагон'/.test(src) && content.site.freight_an.kpi_wagons_sub.includes('хоосон'));
  check('FR21. Өртөөний мөр: вагоны тоон дээр ТОННЫ хувийг давтахгүй (вагоны хувь мэт уншигдана)',
    src.includes("(r)=>fmt(r.wagons)+' '+wUnit);") && !/fmt\(r\.wagons\)\+' '\+wUnit\+' · '\+\(t>0\?\(r\.tonnes/.test(src));
  check('FR22. Сонгосон хугацаанд 0 тонн чиглэл: KPI «бүртгэгдээгүй», donut-д зүсмэлгүй (МТЗ экспорт 0.0%)',
    src.includes("const exp=m.dirs.find(d=>d.key==='export'&&d.tonnes>0);") && src.includes('const donut=m.dirs.filter(d=>d.tonnes>0).map('));

  /* ── FT. Төмөр замын ачаа тээврийн НЭГТГЭЛ (railFreightAll, backend VIEW gold.rail_freight_total) ──
     Гараар бодох фикстур:
       org_months 2026: УБТЗ 100 (01) + 300 (09) = 400 · МТЗ 50 (01)  → 450, УБТЗ 88.9%
       7 хоног: 10-05…10-11 = 200 т · 10-12…10-18 = 180 т (экспорт 100 + дотоод 80) → −10.0%
       YTD 2026 = 1200 (УБТЗ 1000, МТЗ 200) / 2025 мөн үе 1000 → +20.0%
       МТЗ сүүлийн бичлэг 2026-02-01 < 10-12 → хоцорсон (7 хоногт ороогүй гэж ил) */
  const ftm = src.match(/\nfunction freightTotalModel\(all,year,mr\)\{([\s\S]*?)\n\}/);
  const fcol = src.match(/const FREIGHT_ORG_COLORS=(\[[^\]]*\]);/);
  check('FT0. freightTotalModel + FREIGHT_ORG_COLORS тодорхойлогдсон', !!(ftm && fcol));
  if (ftm && fcol) {
    const TM = (all, year, mr) => new Function('FREIGHT_ORG_COLORS', 'all', 'year', 'mr', ftm[1])(eval(fcol[1]), all, year, mr);
    const TOT = { status: 'ok',
      by_org: [{ org: 'УБТЗ', name: 'Улаанбаатар төмөр зам ХНН', last_date: '2026-10-18' }, { org: 'МТЗ', name: 'Монголын төмөр зам ТӨХК', last_date: '2026-02-01' }],
      org_months: [{ month: '2025-09', org: 'УБТЗ', tonnes: 999, wagons: 9, rows: 9 },
        { month: '2026-01', org: 'УБТЗ', tonnes: 100, wagons: 2, rows: 1 }, { month: '2026-01', org: 'МТЗ', tonnes: 50, wagons: 1, rows: 1 },
        { month: '2026-09', org: 'УБТЗ', tonnes: 300, wagons: 6, rows: 3 }],
      weekly: { week_end: '2026-10-18', weeks: [
        { week_start: '2026-10-05', week_end: '2026-10-11', missing: false, tonnes: 200, export_tonnes: 200, by_org: { 'УБТЗ': { tonnes: 200, wagons: 4 }, 'МТЗ': { tonnes: 0, wagons: 0 } } },
        { week_start: '2026-10-12', week_end: '2026-10-18', missing: false, tonnes: 180, export_tonnes: 100, domestic_tonnes: 80, by_org: { 'УБТЗ': { tonnes: 180, wagons: 4 }, 'МТЗ': { tonnes: 0, wagons: 0 } } }],
        ytd: { year: 2026, from: '2026-01-01', to: '2026-10-18', tonnes: 1200, by_org: { 'УБТЗ': { tonnes: 1000 }, 'МТЗ': { tonnes: 200 } } },
        prev_ytd: { year: 2025, from: '2025-01-01', to: '2025-10-18', tonnes: 1000, by_org: {} } } };
    const t = TM(TOT, 2026, null);
    check('FT1. Тээвэрлэгчийн задаргаа (2026): УБТЗ 400 + МТЗ 50 = 450, хувь нийлбэр 100%',
      t.hasOrgs && t.splitTotal === 450 && t.split[0].tonnes === 400 && t.split[1].tonnes === 50 &&
      Math.abs(t.split[0].pct + t.split[1].pct - 100) < 1e-9 && Math.abs(t.split[0].pct - 400 / 450 * 100) < 1e-9, JSON.stringify(t.split));
    const t9 = TM(TOT, 2026, { from: 9, to: 9 });
    check('FT2. Сарын хүрээ (9-р сар) задаргааг ХАМТ шүүнэ: УБТЗ 300, МТЗ 0 (байгууллага алга болохгүй)',
      t9.split.length === 2 && t9.split[0].tonnes === 300 && t9.split[1].tonnes === 0 && t9.splitTotal === 300);
    check('FT3. «Бүгд» он: 999 + 400 + 50 = 1449', TM(TOT, 'all', null).splitTotal === 1449);
    const w = t.weekly;
    check('FT4. 7 хоног: өмнөх 7 хоногоос 180/200 − 1 = −10.0%; мөн үеэс 1200/1000 − 1 = +20.0%',
      !!w && Math.abs(w.wow + 10) < 1e-9 && Math.abs(w.yoy - 20) < 1e-9, JSON.stringify(w && [w.wow, w.yoy]));
    check('FT5. Хоцорсон тээвэрлэгч (МТЗ 2026-02-01) ил — 7 хоногийн дүнд ороогүй',
      w.stale.length === 1 && w.stale[0].code === 'МТЗ');
    check('FT6. Оны эхнээс өссөн дүнгийн тээвэрлэгчийн хувь: УБТЗ 1000/1200',
      Math.abs(w.ytdOrgs.list[0].pct - 1000 / 1200 * 100) < 1e-9 && w.weekOrgs.list[0].pct === 100);
    const miss = JSON.parse(JSON.stringify(TOT));
    miss.weekly.weeks[0].missing = true;
    miss.weekly.prev_ytd.tonnes = 0;
    const wm = TM(miss, 2026, null).weekly;
    check('FT7. Өмнөх 7 хоног бичлэггүй / өмнөх оны мөн үе 0 → харьцуулалт null (0% эсвэл ∞ зохиохгүй)',
      wm.wow === null && wm.yoy === null);
    check('FT8. by_org алга (хуучин backend) → hasOrgs:false; weekly алга (шүүлттэй хариу) → weekly:null',
      TM({ status: 'ok', months: [] }).hasOrgs === false && TM(null).hasOrgs === false &&
      TM(Object.assign({}, TOT, { weekly: undefined }), 2026).weekly === null);
  }
  const bw = src.match(/\nfunction buildFreightWeekChart\(weeks,dirs,words\)\{([\s\S]*?)\n\}/);
  check('FT9. buildFreightWeekChart тодорхойлогдсон', !!bw);
  if (bw) {
    const BW = new Function('weeks', 'dirs', 'words', bw[1]);
    const wks = [{ week_start: '2026-09-28', week_end: '2026-10-04', missing: true },
      { week_start: '2026-10-05', week_end: '2026-10-11', export_tonnes: 200, domestic_tonnes: 0 },
      { week_start: '2026-10-12', week_end: '2026-10-18', export_tonnes: 100, domestic_tonnes: 80 }];
    const c = BW(wks, [{ key: 'export', label: 'Экспорт', color: '#1' }, { key: 'domestic', label: 'Дотоод', color: '#2' }], {});
    const b = c.bars.find(r => r.tip === '10.12–10.18 — Экспорт: 100 т');
    check('FT9. Hover "10.12–10.18 — Экспорт: 100 т" (HV: нэр — утга), 7 хоног бүрт чиглэл бүр багана',
      !!b && c.bars.filter(r => /^10\.12–10\.18 — /.test(r.tip)).length === 2, JSON.stringify(c.bars.map(r => r.tip)));
    check('FT9. Бичлэггүй 7 хоног — бүдэг тууз + "мэдээлэл алга" (0 багана биш); Y тэнхлэг 0-ээс',
      c.bars.filter(r => /мэдээлэл алга/.test(r.tip)).length === 1 && c.yTicks[0].label === '0');
    const b2 = c.bars.find(r => r.tip === '10.05–10.11 — Экспорт: 200 т'), b1 = b;
    check('FT9. Өндөр утгатайгаа пропорциональ (200 т = 100 т-ийн 2 дахин)',
      !!b2 && Math.abs(+b2.h / +b1.h - 2) < 0.02, b2 && [b2.h, b1.h].join('/'));
  }
  check('FT10. railFreightAll = нэгтгэл (total:true, org=all); салбарын хуудсанд нэгтгэлийн самбар гарахгүй',
    src.includes("railFreightAll:{org:'all',rows:'rail-freight-all',schema:'rail_freight_all',total:true}") &&
    src.includes('if(!fs||!fs.total) return {freightIsTotal:false};') &&
    src.includes('freightChart:chart,freightLegend:legend,...this.buildFreightTotal(dsel,m)};') &&
    /<sc-if value="\{\{ detail\.freightIsTotal \}\}"><sc-if value="\{\{ detail\.freightHasData \}\}">\s*<div data-freight-total="1">/.test(read('index.html')));
  check('FT11. Нэгтгэлийн бүх харагдах текст content.json-д (freight_an.total_*)',
    ['total_wk_title', 'total_orgs_title', 'total_week_chart_title', 'total_split_title', 'total_kpi_week', 'total_kpi_ytd',
      'total_kpi_wow', 'total_kpi_yoy', 'total_stale_note'].every(k => typeof content.site.freight_an[k] === 'string'));
}

/* ─────────── UI. Датасэтийн хуудасны НЭГДСЭН UI стандарт (2026-10-15) ───────────
   Хэрэглэгчийн гомдол: "зорчигчийн галт тэрэгний датаг яагаад ингэж аймшигтай
   харуулж байна, агаарын тээвэр шиг нэг стандарт барь; чарт хүснэгт нэг line-д
   байх таск биелээгүй" — хүснэгт 560/1240px, 3 багана, 104092 (тусгаарлагчгүй),
   198px donut | 964px жагсаалт. Энэ бүлэг (а) форматын цэвэр функцыг гараар
   бодсон утгаар, (б) статик шалгагчийг өөрийг нь (эвдсэн хуулбар дээр УНАХ ёстой)
   шалгана. Харагдацыг өгөгдөлтэй төлөвөөр layout-audit (+fx) шалгана. */
function groupUI() {
  group('UI. Нэгдсэн UI стандарт — хүснэгт · мөр · дараалал');
  const src = dcScript();
  const fm = src.match(/const TABLE_NUM_TYPES=(\[[^\]]*\]);\nfunction fmtTableCell\(v,type\)\{([\s\S]*?)\n\}/);
  check('UI1. fmtTableCell + TABLE_NUM_TYPES тодорхойлогдсон', !!fm);
  if (fm) {
    const f = new Function('TABLE_NUM_TYPES', 'v', 'type', fm[2]).bind(null, eval(fm[1]));
    check('UI1. int → мянгатын тусгаарлагч (104092 → 104,092)', f(104092, 'int') === '104,092', f(104092, 'int'));
    check('UI1. pct → 1 орон + % (2.04 → 2.0%)', f(2.04, 'pct') === '2.0%', f(2.04, 'pct'));
    check('UI1. pctchg → тэмдэгтэй (+7.3% / -13.7%)', f(7.3, 'pctchg') === '+7.3%' && f(-13.7, 'pctchg') === '-13.7%');
    check('UI1. float → 1 орон (352.66 → 352.7)', f(352.66, 'float') === '352.7', f(352.66, 'float'));
    check('UI1. null/NaN тоо → "—" (0 гэж зохиохгүй)', f(null, 'pctchg') === '—' && f(NaN, 'int') === '—');
    check('UI1. Текст/ID багана ХӨНДӨГДӨХГҮЙ (аяллын дугаар 94952 → 94952)', f(94952, 'string') === 94952 && f('OM297', 'string') === 'OM297');
  }
  const { spawnSync } = require('child_process');
  const runChk = (file) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-ui-standard.js')],
    { env: Object.assign({}, process.env, file ? { EH_UI_FILE: file } : {}), encoding: 'utf8' });
  const ok = runChk(null);
  check('UI2. scripts/check-ui-standard.js репо дээр ногоон', ok.status === 0, (ok.stdout || '') + (ok.stderr || ''));
  const html = read('index.html');
  const tmp = path.join(require('os').tmpdir(), 'eh-ui-' + process.pid + '.html');
  const mut = (name, from, to, rule) => {
    if (html.indexOf(from) < 0) { bad('UI3. ' + name + ' — эвдэх мөр олдсонгүй'); return; }
    fs.writeFileSync(tmp, html.replace(from, to));
    const r = runChk(tmp);
    check('UI3. Шалгагч ' + name + '-ийг БАРИНА [' + rule + ']', r.status === 1 && r.stdout.indexOf('[' + rule + ']') >= 0, r.stdout);
  };
  mut('start-aligned мөр', 'class="eh-g-1c eh-row" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;align-items:stretch;"',
    'class="eh-g-1c" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;align-items:start;"', 'ROW1');
  mut('гар хүснэгт', '<div data-eh-table="1"', '<sc-raw-table></sc-raw-table><div data-eh-table="1"', 'TBL0');
  mut('хагас өргөнтэй хүснэгт', 'data-eh-table="1" style="min-width:100%;', 'data-eh-table="1" style="min-width:560px;', 'TBL1');
  mut('тусгаарлагчгүй нүд', '{v:fmtTableCell(c,types[ci])', '{v:c', 'TBL2');
  mut('графикийг хүснэгтийн өмнө', '{{ detail.pvTitle }}', '{{ detail.pvTitleX }}', 'ORD1');
  mut('чанарын үнэлгээг хүснэгтийн өмнө', '{{ detail.pvTitle }}', '<i data-ddq-block="1"></i>{{ detail.pvTitle }}', 'ORD2');
  try { fs.unlinkSync(tmp); } catch (e) { /* алгасна */ }
  check('UI4. Хоосон (бүх 0) цуваа хавтгай "0" шугам зурахгүй — "мэдээлэл алга"',
    /Array\.isArray\(dsSec\.c1d\)&&dsSec\.c1d\.some\(v=>\+v>0\)/.test(src));
  check('UI4. Таамгийн доод хязгаар 0-оос доош орохгүй (Y тэнхлэг 0-ээс)',
    /const lo=all\.map\(\(v,i\)=>Math\.max\(0,/.test(src));
  check('UI5. Эх сурвалжгүй 7 хоногийн карт 4 "—" нүд зурахгүй (wp.hasData-д ороосон)',
    html.indexOf('<sc-if value="{{ detail.wp.hasData }}">') > 0 && /wpNoData:true,hasData:false/.test(src));
  check('UI6. «Салбарын бүтэц» хоосон бол хоосон карт биш, борлуулалтын суваг (зорчигч) тавигдана',
    /showRankAlt:rankEmptyNow&&paxChannelsNow/.test(src) && html.indexOf('<sc-if value="{{ detail.showRankAlt }}">') > 0);
  check('UI7. layout-audit өгөгдөлтэй төлөв (+fx) ба тээврийн хэрэгслийн 4 табыг шалгадаг',
    /route: r \+ '\+fx'/.test(read('tests/layout-audit.js')) && read('tests/layout-audit.js').indexOf("'vehreg/plate'") > 0 &&
    fs.existsSync(path.join(ROOT, 'tests', 'lib', 'feed-fixtures.js')));

  /* RAW — датасэтийн хүснэгт = эх сервисийн ТҮҮХИЙ мөр, БҮХ багана (2026-10-18:
     вагоны хүснэгтэд огноо харагддаггүй байв — зөвхөн станцын нэгтгэл). */
  const fxs = (re) => { const m = src.match(re); return m ? m[1] : null; };
  const d2sB = fxs(/\nfunction datasetRowsToSchema\(json,mFrom,mTo,noteLabel\)\{([\s\S]*?)\n\}/);
  const winB = fxs(/\nfunction dsRowsWindow\(yFrom,yTo,mFrom,mTo\)\{([\s\S]*?)\n\}/);
  const apiM = src.match(/const DS_ROWS_API=(\{[^}]*\});/);
  check('RAW0. datasetRowsToSchema / dsRowsWindow / DS_ROWS_API тодорхойлогдсон', !!(d2sB && winB && apiM));
  if (d2sB && winB && apiM) {
    const D2S = new Function('DS_RAW_TYPES', 'json', 'mFrom', 'mTo', 'noteLabel', d2sB)
      .bind(null, ['date', 'month', 'int', 'float', 'pct', 'pctchg', 'string', 'enum']);
    const WIN = new Function('yFrom', 'yTo', 'mFrom', 'mTo', winB);
    const API = eval('(' + apiM[1] + ')');
    check('RAW1. Вагон, зорчигч, үзлэг гурвуулаа түүхий мөрийн endpoint-тэй',
      API.railWagon === 'rail-wagon' && API.railPax === 'rail-pax' && API.roadInspect === 'road-inspections', JSON.stringify(API));
    const J = { status: 'ok', total: 3, truncated: false,
      columns: [{ key: 'record_date', label: 'Огноо', type: 'date' }, { key: 'station_name', label: 'Өртөөний нэр', type: 'string' },
        { key: 'loaded_covered_domestic', label: 'Ачсан битүү вагон (дотоод)', type: 'int' }, { key: 'x', label: 'X', type: 'weird' }],
      rows: [['2026-09-17', 'Өргөн', 8, 'a'], ['2026-08-02', 'Эрээнцав', 1, 'b'], ['2025-09-30', 'Дархан', 4, 'c']] };
    const S = D2S(J, 1, 12, 'Эх талбар');
    check('RAW2. ОГНОО багана эхэнд, бүх багана шошготойгоо (4)',
      S && S.raw && S.head.join('|') === 'Огноо|Өртөөний нэр|Ачсан битүү вагон (дотоод)|X', S && S.head.join('|'));
    check('RAW2. Төрөл хадгалагдана (date/string/int), танихгүй төрөл → string',
      S && S.types.join(',') === 'date,string,int,string', S && S.types.join(','));
    check('RAW2. Мөр бүр + хоосон төлөвийн нүд (төлөв ЗОХИОХГҮЙ), тоо ТҮҮХИЙгээрээ',
      S && S.rows.length === 3 && S.rows[0].length === 5 && S.rows[0][4] === '' && S.rows[0][2] === 8);
    check('RAW2. Тэмдэглэл = эх талбарын нэр', S && S.notes[2] === 'Эх талбар: loaded_covered_domestic', S && S.notes[2]);
    const S9 = D2S(J, 9, 9, '');
    check('RAW3. Сарын хүрээ 9–9 → 2026-09 ба 2025-09 (2 мөр, ГАРААР)', S9 && S9.rows.length === 2 &&
      S9.rows.map(r => r[0]).join(',') === '2026-09-17,2025-09-30');
    check('RAW4. no_data / багана алга / null → null (нэгтгэлийн хүснэгт хэвээр)',
      D2S({ status: 'no_data', columns: [], rows: [] }) === null && D2S(null) === null && D2S({ status: 'ok', columns: [], rows: [] }) === null);
    const T = D2S(Object.assign({}, J, { total: 12000, truncated: true }), 1, 12, '');
    check('RAW5. Таслагдсан хариу: total 12000, loaded 3, truncated', T.truncated === true && T.total === 12000 && T.loaded === 3);
    const w = WIN(2026, 2026, 9, 9);
    check('RAW6. Цонх: 2026 он, 9-р сар → 2026-09-01…2026-09-30', w.from === '2026-09-01' && w.to === '2026-09-30', JSON.stringify(w));
    const w2 = WIN(2024, 2026, 2, 2);
    check('RAW6. Цонх: 2024–2026, 2-р сар → 2024-02-01…2026-02-28 (сарыг клиент шүүнэ)',
      w2.from === '2024-02-01' && w2.to === '2026-02-28' && w2.mFrom === 2 && w2.mTo === 2, JSON.stringify(w2));
    const wa = WIN('all', 'all', 1, 12);
    check('RAW6. «Бүгд» он → from/to null (сүүлийн мөрүүд)', wa.from === null && wa.to === null);
    check('RAW7. Хүснэгт төлөвгүй үед pill ба «Төлөвөөр» мөр нуугдана',
      html.indexOf('<sc-if value="{{ pr.hasStatus }}">') > 0 && html.indexOf('<sc-if value="{{ detail.pvHasStatus }}">') > 0);
    check('RAW8. EHBackend.fetchDatasetRows → /api/datasets/<key>/rows',
      /function fetchDatasetRows\(key, from, to, limit(, opts)?\)/.test(read('js/erthub-backend.js')) &&
      read('js/erthub-backend.js').indexOf("'/api/datasets/'") > 0);
    /* FL3 × RAW: баганын шүүлт KPI-г хамрах түлхүүр — түүхий мөрийн 0-р багана ОГНОО
       тул датасэт бүр түлхүүр баганаа зарлана; таслагдсан хариу KPI-г хамруулахгүй. */
    const scM = src.match(/const DS_ROWS_SCOPE=(\{[^\n]*\});/);
    const SCP = scM ? eval('(' + scM[1] + ')') : {};
    check('RAW9. FL3 хамрах түлхүүр: вагон=станц, зорчигч=сар (огнооны 7 тэмдэгт), үзлэг=аймаг',
      SCP.railWagon && SCP.railWagon.col === 'station_name' && SCP.railPax && SCP.railPax.col === 'record_date' &&
      SCP.railPax.len === 7 && SCP.roadInspect && SCP.roadInspect.col === 'branch_aimag', scM && scM[1]);
    /* 2026-10-20: таслагдсан үед ачаалсан мөрөөс түлхүүр гаргахгүй хэвээр; харин ЗӨВХӨН хамрах баганыг
       шүүсэн бол түлхүүр = сонгосон утга (мөрөөс хамаарахгүй, RPX30) */
    check('RAW9. pvColScope: buildPreview-тэй ижил __raw түлхүүр, таслагдсан үед мөрөөс түлхүүр гаргахгүй',
      /const schemaKey=sc\.raw\?baseKey\+'__raw':baseKey;\s*const selRaw=/.test(src) && /if\(sc\.truncated\)\{\s*if\(kl\|\|!ks\.every/.test(src));
  }

  /* YY — «Өмнөх оноос»: «Бүгд» он сонгосон үед СҮҮЛИЙН он vs өмнөх он (2026-10-18) */
  const ycB = fxs(/\nfunction yoyCompare\(months,yr,mFrom,mTo,key\)\{([\s\S]*?)\n\}/);
  check('YY0. yoyCompare тодорхойлогдсон', !!ycB);
  if (ycB) {
    const YC = new Function('months', 'yr', 'mFrom', 'mTo', 'key', ycB);
    const M = [{ month: '2025-01', v: 100 }, { month: '2025-02', v: 200 }, { month: '2025-03', v: 50 },
      { month: '2026-01', v: 150 }, { month: '2026-02', v: 100 }, { month: '2026-03', v: 999, partial: true }];
    const a = YC(M, 'all', 1, 12, 'v');
    check('YY1. «Бүгд» → 2026 vs 2025, бүтэн 2 сар: (150+100)/(100+200)−1 = −16.7%',
      a.yoy && a.yoy.year === 2026 && a.yoy.prevYear === 2025 && a.yoy.months === 2 && Math.abs(a.yoy.pct - (250 / 300 - 1) * 100) < 1e-9, JSON.stringify(a));
    const b = YC(M, 'all', 2, 2, 'v');
    check('YY2. Сарын хүрээ 2–2 → зөвхөн 2-р сар: 100/200−1 = −50%', b.yoy && b.yoy.months === 1 && Math.abs(b.yoy.pct + 50) < 1e-9);
    const c = YC(M, 2025, 1, 12, 'v');
    check('YY3. 2025 сонгосон → 2024 алга: yoy null, hasPrevYear false', c.yoy === null && c.hasPrevYear === false && c.year === 2025);
    const d = YC(M, 'all', 3, 3, 'v');
    check('YY4. Дутуу сар (2026-03) харьцуулалтад ОРОХГҮЙ → null, гэхдээ өмнөх он БАЙГАА',
      d.yoy === null && d.hasPrevYear === true);
  }
}

/* DG-P16–P18. Хугацааны мөрийн БҮРДЭЛ — жинхэнэ хөтчөөр хуудас бүрийг фикстурын
   өгөгдөлтэй (?fx=1) зурж, график/диаграм/эрэмбийн жагсаалт БҮР [data-chart-period]
   мөртэй эсэхийг tests/lib/period-probe.js-ээр тулгана. Шинэ карт нэмээд мөрөө
   мартвал энд унана (DG-P8-ийн тоо зөвхөн темплейтийг тоолдог). */
async function groupDGP() {
  group('DG-P. Графикийн хугацааны мөр — бүх хуудсанд (хөтөч)');
  if (!CHROME) { skipped('DG-P16–P18 (браузерын хэсэг)', 'Chrome олдсонгүй'); return; }
  const probe = require(path.join(ROOT, 'tests', 'lib', 'period-probe.js'));
  const conP = readJson('content.json');
  const slugP = (d) => d.sector + '__' + String(d.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const base = '/index.html?fx=1#/';
  const routes = [base, base + '|[data-sector-tab="air"]', base + '|[data-sector-tab="rail"]',
    base + 'browse', base + 'community', base + 'history', base + 'news',
    base + 'vehreg/ops', base + 'vehreg/structure', base + 'vehreg/fuel', base + 'vehreg/plate']
    .concat((conP.site.datasets || []).map((d) => base + 'browse/' + encodeURIComponent(slugP(d))));
  const DECOR = ['ErtHub AI CORE', 'НЭЭЛТТЭЙ ӨГӨГДӨЛ', 'COMMUNITY', 'САЛБАРЫН ТҮҮХ', 'ШИНЭЧЛЭЛ', 'Монголын зам'];
  const run = (rs) => runProbe('async function(d,w){return (' + probe.toString() + ')(d,w,' +
    JSON.stringify(rs) + ',' + JSON.stringify(DECOR) + ')}', 60000 + rs.length * 15000);
  const srv = serve();
  try {
    PROBE_SRC = base;
    const R = await run(routes);
    if (R.__err) { bad('DG-P16. Хугацааны проб ажиллав', R.__err); return; }
    const errs = Object.keys(R).filter((k) => !Array.isArray(R[k])).map((k) => k + ': ' + R[k].__err);
    check('DG-P16. Бүх хуудас ачаалагдав (' + routes.length + ')', errs.length === 0, errs.join(' | '));
    const all = [].concat(...Object.keys(R).filter((k) => Array.isArray(R[k])).map((k) => R[k].map((r) => ({ ...r, route: decodeURIComponent(k) }))));
    const miss = all.filter((r) => !r.ok).map((r) => r.route.replace('/index.html?fx=1#/', '') + ' → ' + r.kind + ' «' + r.title.slice(0, 50) + '»');
    /* Хоосон ногоон БИШ: фикстураар одоо 57 карт зурагддаг — хэт цөөн бол проб эвдэрсэн */
    check('DG-P16. График/жагсаалт хангалттай олон шалгагдав (' + all.length + ' ≥ 50)', all.length >= 50, 'n=' + all.length);
    check('DG-P16. Хугацааны мөргүй график/жагсаалт АЛГА', miss.length === 0, miss.slice(0, 8).join(' | '));
    const junk = all.filter((r) => r.ok && (/undefined|NaN|null/.test(r.period) || !/Хугацаа: /.test(r.period))).map((r) => r.period);
    check('DG-P16. Мөрийн текст «Хугацаа: …», NaN/undefined алга', junk.length === 0, junk.slice(0, 4).join(' | '));
    const rowsOf = (frag) => all.filter((r) => r.route.indexOf(frag) >= 0 && r.ok);
    /* DG-P17. Утгад тохирсон хугацаа: хоногийн цуваа → «N хоног», сарын цуваа → «N сар» */
    const road = rowsOf('road__');
    check('DG-P17. Үзлэг: 30 хоногийн цуваа «хоног»-оор, бусад нь сараар/хоногоор (' + road.length + ' карт)',
      road.length >= 5 && road.some((r) => /· \d+ хоног$/.test(r.period)) && road.some((r) => /· \d+ сар/.test(r.period)),
      road.map((r) => r.period).join(' | '));
    const tot = rowsOf('нэгтгэл');
    check('DG-P17. Ачааны нэгтгэл: 7 хоног / 8 долоо хоног хоногийн мужаар',
      tot.filter((r) => /· \d+ хоног/.test(r.period)).length >= 2, tot.map((r) => r.period).join(' | '));
    const home = rowsOf('#/') .filter((r) => r.route === '/index.html?fx=1#/');
    check('DG-P17. Нүүр: 7 хоногийн тайлан «7 хоног» (нэгтгэлтэй бол «N долоо хоног»), индекс/эрэмбэ сараар',
      home.some((r) => /· (7 хоног|\d+ долоо хоног)$/.test(r.period)) && home.some((r) => /· \d+ сар/.test(r.period)),
      home.map((r) => r.period).join(' | '));

    /* DG-P18. Шалгагч өөрөө: үзлэгийн 30 хоногийн мөрийг хассан хуулбар дээр УНАХ ёстой */
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const broken = src.replace(/[^\n]*\{\{ detail\.ri\.perDaily \}\}[^\n]*\n/, '');
    if (broken === src) { bad('DG-P18. Эвдэх мөр олдлоо', 'perDaily мөр алга'); return; }
    SERVE_OVERRIDE = { '/index.html': broken };
    const roadRoute = routes.find((r) => r.indexOf('road__') >= 0);
    const B = await run([roadRoute]);
    const bRows = Array.isArray(B[roadRoute]) ? B[roadRoute] : [];
    check('DG-P18. Мөр хасагдсан хуулбар дээр проб «хугацаагүй» гэж барина',
      bRows.some((r) => !r.ok), JSON.stringify(B).slice(0, 200));
  } finally {
    SERVE_OVERRIDE = null;
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* DG-P19–P25. АДМИНЫ PREVIEW-ИЙН хугацааны мөр — сайттай ИЖИЛ (2026-10-21).
   Preview нь сайтын картын «Хугацаа: …» мөрийг ижил функцээр (EHGlossary.chartPeriod)
   зурна; хугацаа нь админы ӨӨРИЙН өгөгдлөөс (FEED, ST, SERIES …). Хоёр хэсэг:
   (а) Chrome-гүй — админы эх кодоос функцийг тайрч ГАРААР БОДОХ фикстур дээр, сайтын
       dropPartialMonth/weekSectorReport-оор бодсон мөртэй тулгана;
   (б) хөтөч — нүүр (?fx=1, агаарын таб) ба админы 16 виджетийг нэг фикстураар зурж
       мөр бүрийг тулгана, хугацааны үгийг засахад preview тэр дор шинэчлэгдэнэ. */
async function groupDGA() {
  group('DG-P19. Админы preview-ийн хугацааны мөр = сайтын мөр');
  const G = require(path.join(ROOT, 'js', 'erthub-glossary.js'));
  const adm = adminScript(), site = dcScript();
  const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); return (i < 0 || j < 0) ? null : src.slice(i, j); };
  const parts = [cut(adm, 'function stWeek(mk){', 'function stWeekVal('),
    cut(adm, 'function computeSeries(byYear,latest){', '/* Метрикийн БОДИТ утга'),
    cut(adm, 'function metricSeries(mk){', '/* Метрикийн 7 ХОНОГИЙН'),
    cut(adm, '/* ══════════ ГРАФИКИЙН ХУГАЦАА (DG-P) — preview', 'function previewFor(id,mini){')];
  const dpm = site.match(/\nfunction dropPartialMonth\(counts,year,cov,now\)\{([\s\S]*?)\n\}/);
  const wsr = site.match(/\nfunction weekSectorReport\(w,keys(?:,gaps)?\)\{([\s\S]*?)\n\}/);
  check('DG-P19. Админы хугацааны функцүүд ба сайтын dropPartialMonth/weekSectorReport олдов',
    parts.every(Boolean) && !!dpm && !!wsr, parts.map((p) => !!p).join(','));
  if (!parts.every(Boolean) || !dpm || !wsr) return;
  check('DG-P19. Сайт ба админ НЭГ функцээр (EHGlossary.chartPeriod) бичнэ',
    /function chartPeriodText\(m,T\)\{\s*\/\*[^*]*\*\/\s*return EHGlossary\.chartPeriod\(m,T\);/.test(site) &&
    /EHGlossary\.chartPeriod\(/.test(parts[3]) && /<script src="\.\.\/js\/erthub-glossary\.js"><\/script>/.test(read('admin/index.html')));

  const MONTHS = readJson('content.json').site.months;
  const NOW = Date.UTC(2026, 9, 21, 2, 0);   /* УБ 2026-10-21 10:00 — 10-р сар ДУТУУ */
  const DT = (now) => { class FD extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } } return FD; };
  const mkKit = (env) => new Function('CON', 'REG', 'FEED', 'ST', 'SERIES', 'SERIES_METRIC', 'RAIL', 'INSP', 'ST_METRIC', 'MONTHS', 'Date',
    'valueSpecOf', 'slotsOf', 'slotVal', 'qualityOf', 'sectorParts', 'widgetValueRes', 'headMetric', 'esc', 'EHGlossary',
    parts.join('') + 'return {computeSeries:computeSeries,pvPeriodText:pvPeriodText,pvWeekModel:pvWeekModel,pvD05Share:pvD05Share,' +
    'setMeas:function(m){PV_D05_MEAS=m}};')(
    env.CON || { site: { chart: {} } }, { metrics: {} }, env.FEED, env.ST || { state: 'off' }, env.SERIES || {},
    { 'rail.monthly_passenger_series': 'rail' }, env.RAIL || { state: 'off' }, env.INSP || { state: 'off' },
    { 'air.weekly_pax': ['passengers', 'air'], 'air.weekly_cargo': ['freight_tonnes', 'air'], 'rail.weekly_pax': ['passengers', 'rail'], 'rail.weekly_cargo': ['freight_tonnes', 'rail'] },
    MONTHS, DT(env.now || NOW), env.valueSpecOf || (() => null),
    () => [{ key: 'air', path: 'a' }, { key: 'rail', path: 'r' }], (id, p) => p,
    env.qualityOf || ((p) => (p === 'a' ? 'verified' : 'none')), env.sectorParts || (() => []), () => null,
    env.headMetric || (() => 'air.monthly_flight_series'), String, G);
  const newFeed = () => ({ state: 'ready', months: [], index: [] });
  /* Нислэг: 2026 оны 1,2,4–10-р сар (3-р сар хоосон), сар бүр 15 ба 20-нд нэг нэг нислэг;
     сүүлийн бичлэг 10-20. Гараар: 10-р сар (явагдаж буй) хасагдана → 1–9-р сар,
     сүүлийн бүтэн сар 2026-09, 7 хоног = 10-13…10-19 (10-15 таарна). */
  const fl = (y, m, d) => ({ year: y, month: m, day: d, unixtimestamp: Date.UTC(y, m - 1, d) / 1000, pax: 10, cargo: 1 });
  const rows26 = [1, 2, 4, 5, 6, 7, 8, 9, 10].reduce((a, m) => a.concat([fl(2026, m, 15), fl(2026, m, 20)]), []);
  const FEED = newFeed();
  const K = mkKit({ FEED });
  K.computeSeries({ 2026: rows26 }, { year: 2026, rows: rows26 });
  const t05 = K.pvPeriodText('t05');
  /* Сайтын талаас: ИЖИЛ тоолол → dropPartialMonth → t05Period-ийн дүрэм (>0 сар, хасагдсан бол тэмдэг) */
  const cnt = new Array(12).fill(0); rows26.forEach((f) => { cnt[f.month - 1]++; });
  const DPM = new Function('COVERAGE_DEFAULT', 'counts', 'year', 'cov', 'now', dpm[1]).bind(null, { excludes_current: true });
  const tr = DPM(cnt.slice(0, 10), 2026, null, NOW);
  const siteT05 = G.chartPeriod({ periodKeys: tr.counts.map((v, i) => (v > 0 ? '2026-' + String(i + 1).padStart(2, '0') : null)).filter(Boolean),
    partialDropped: !!tr.partial }, (k, fb) => fb);
  check('DG-P20. t05: явагдаж буй сар ХАСАГДАЖ «дутуу сар хасагдсан» (гараар: 2026-01 — 2026-09 · 9 сар)',
    t05 === 'Хугацаа: 2026-01 — 2026-09 · 9 сар · дутуу сар хасагдсан' && FEED.partialDropped === '2026-10' &&
    FEED.months.length === 8, t05 + ' · ' + FEED.partialDropped + ' · ' + FEED.months.length);
  check('DG-P20. t05: админ = сайт (dropPartialMonth + t05Period-ийн дүрэм)', t05 === siteT05, t05 + ' ≠ ' + siteT05);
  check('DG-P21. i06/r06: харьцуулах цонх 1 — сүүлийн бүтэн сар (сайтын compareWindow)',
    K.pvPeriodText('i06') === 'Хугацаа: 2026-01 — 2026-09 · 9 сар' && K.pvPeriodText('r06') === K.pvPeriodText('i06'),
    K.pvPeriodText('i06'));
  /* 1-р сард: харьцуулах цонх нь ӨМНӨХ он бүтнээрээ — тэр он ачаалагдсан бол л */
  const rowsJan = [fl(2026, 1, 5)], rows25 = [fl(2025, 12, 1)];
  const FJ = newFeed(), KJ = mkKit({ FEED: FJ, now: Date.UTC(2026, 0, 6, 2) });
  KJ.computeSeries({ 2026: rowsJan, 2025: rows25 }, { year: 2026, rows: rowsJan });
  const FJ2 = newFeed(), KJ2 = mkKit({ FEED: FJ2, now: Date.UTC(2026, 0, 6, 2) });
  KJ2.computeSeries({ 2026: rowsJan }, { year: 2026, rows: rowsJan });
  check('DG-P21. 1-р сар: 2025-01 — 2025-12 · 12 сар; өмнөх он алга бол «мэдээлэл алга» (зохиохгүй)',
    KJ.pvPeriodText('i06') === 'Хугацаа: 2025-01 — 2025-12 · 12 сар' && KJ2.pvPeriodText('i06') === 'Хугацаа: мэдээлэл алга' &&
    KJ.pvPeriodText('t05') === 'Хугацаа: мэдээлэл алга', [KJ.pvPeriodText('i06'), KJ2.pvPeriodText('i06'), KJ.pvPeriodText('t05')].join(' | '));

  /* Салбарын нэгтгэл: 3 долоо хоног (дунд нь бичлэггүй) → «3 долоо хоног»; сайтын weekSectorReport-оор ч ижил */
  const wk = (a, b, miss) => ({ week_start: a, week_end: b, missing: !!miss, by_sector: miss ? {} : { air: { value: 5 }, rail: { value: 7 } } });
  const WP = { sectors: ['air', 'rail'], weeks: [wk('2026-09-28', '2026-10-04'), wk('2026-10-05', '2026-10-11', true), wk('2026-10-12', '2026-10-18')] };
  const KS = mkKit({ FEED, ST: { state: 'ready', weekly: { passengers: WP } } });
  const sr = new Function('w', 'keys', 'gaps', wsr[1])(WP, ['air'], null);
  const siteW = G.chartPeriod({ dayFrom: sr.weeks[0].start, dayTo: sr.weeks[sr.weeks.length - 1].end, nWeeks: sr.weeks.length }, (k, fb) => fb);
  const w2 = ['w2p', 'w2pb', 'w2px'].map((id) => KS.pvPeriodText(id));
  check('DG-P22. 02-р хэсэг (зорчигч): нэгтгэлийн бүх долоо хоног — гараар 2026-09-28 — 2026-10-18 · 3 долоо хоног',
    w2.every((t) => t === 'Хугацаа: 2026-09-28 — 2026-10-18 · 3 долоо хоног'), w2.join(' | '));
  check('DG-P22. 02-р хэсэг: админ = сайт (weekSectorReport → chartPeriod)', w2[0] === siteW, w2[0] + ' ≠ ' + siteW);
  const c2 = ['w2c', 'w2cb', 'w2cx'].map((id) => KS.pvPeriodText(id));
  check('DG-P22. Ачааны нэгтгэл алга → flights feed-ийн сүүлийн бүтэн 7 хоног (10-13 — 10-19 · 7 хоног)',
    c2.every((t) => t === 'Хугацаа: 2026-10-13 — 2026-10-19 · 7 хоног'), c2.join(' | '));
  const KV = mkKit({ FEED, ST: { state: 'ready', weekly: { passengers: WP } }, valueSpecOf: (id) => (id === 'w2p' ? { measure: 'Зорчигч' } : null) });
  check('DG-P22. Утгын тохиргоотой үед нэгтгэлийн оронд feed-ийн 7 хоног (сайтын stOn-той ижил)',
    KV.pvPeriodText('w2pb') === 'Хугацаа: 2026-10-13 — 2026-10-19 · 7 хоног', KV.pvPeriodText('w2pb'));

  /* d05 — холбогдсон салбар бүрийн утгын хугацаа; өөр бол салбараар нэрлэнэ */
  const P1 = [{ k: 'air', n: 'Агаар', q: 'verified', v: 56, m: 'air.flight_count_last_month' }, { k: 'road', n: 'Авто', q: 'none', v: 0, m: null }];
  const P2 = P1.concat([{ k: 'rail', n: 'Төмөр зам', q: 'verified', v: 900, m: 'rail.wagon_loading' }]);
  const KD1 = mkKit({ FEED, sectorParts: () => P1 });
  const KD2 = mkKit({ FEED, sectorParts: () => P2, RAIL: { state: 'ready', date: '2026-10-20' } });
  check('DG-P23. d05: агаарын сүүлийн бүтэн сарын утга → «2026-09 · 1 сар»', KD1.pvPeriodText('d05') === 'Хугацаа: 2026-09 · 1 сар', KD1.pvPeriodText('d05'));
  check('DG-P23. d05: өөр хугацаатай салбарыг салбараар нэрлэнэ (нэг мужид шахахгүй)',
    KD2.pvPeriodText('d05') === 'Агаар — Хугацаа: 2026-09 · 1 сар · Төмөр зам — Хугацаа: 2026-10-20 · сүүлийн бүрэн хоног', KD2.pvPeriodText('d05'));
  const K0 = mkKit({ FEED: { state: 'error' }, sectorParts: () => [] });
  const none = ['w2p', 't05', 'i06', 'd05'].map((id) => K0.pvPeriodText(id));
  check('DG-P24. Дата алга → «Хугацаа: мэдээлэл алга» (хугацаа ЗОХИОХГҮЙ)', none.every((t) => t === 'Хугацаа: мэдээлэл алга'), none.join(' | '));
  const nolines = ['hero_fl', 'hero_px', 'ls', 'k04', 'uk', 'u07'].filter((id) => K.pvPeriodText(id) !== '');
  check('DG-P24. Сайт дээр хугацааны мөргүй виджет (hero/ls/k04/uk/u07) preview-д ч мөргүй', nolines.length === 0, nolines.join(','));
  const KW = mkKit({ FEED, CON: { site: { chart: { period_prefix: 'ZZП', scope_months: 'ZZС', period_dropped: 'ZZХ' } } } });
  check('DG-P24. Үг нь content.json site.chart.period_*-ээс (засварлахад preview дагана)',
    KW.pvPeriodText('t05') === 'ZZП: 2026-01 — 2026-09 · 9 ZZС · ZZХ', KW.pvPeriodText('t05'));

  /* DG-P26. d05 + САЛБАРЫН НЭГТГЭЛ (2026-10-22): админы preview = сайтын sectorShareFromTotal +
     buildDonut (НЭГ функц EHGlossary.sectorShare). Гараар бодох фикстур:
       зорчигч (weekly.ytd 2026-01-01…10-18): агаар 100, төмөр зам 300 → 25.0% / 75.0%, нийт 100%
       ачаа (weekly алга → 2026 оны сарын нэгтгэл): агаар 4, төмөр зам 1700 (02-р сар null — тооцохгүй),
         2025-12 (өмнөх он) орохгүй → 4/1704 = 0.2%, 1700/1704 = 99.8%; хугацаа 2026-01 — 2026-02 · 2 сар */
  const mD = site.match(/\n  buildDonut\(activeKey\)\{([\s\S]*?)\n  \}\n  buildGlobe\(\)/);
  const mS = site.match(/\n  sectorShareFromTotal\(keys\)\{([\s\S]*?)\n  \}\n/);
  check('DG-P26. Сайтын buildDonut + sectorShareFromTotal олдов, хоёр тал EHGlossary.sectorShare-ээр',
    !!(mD && mS) && /EHGlossary\.sectorShare\(/.test(mS ? mS[1] : '') && /EHGlossary\.sectorShare\(/.test(parts[3]));
  if (mD && mS) {
    const STAPI = { status: 'ok', sectors: [{ sector: 'air' }, { sector: 'rail' }, { sector: 'road' }],
      months: [{ month: '2025-12', sector: 'air', passengers: 999, passenger_days: 31, freight_tonnes: 999, freight_days: 31 },
        { month: '2026-01', sector: 'air', passengers: 100, passenger_days: 31, freight_tonnes: 4, freight_days: 31 },
        { month: '2026-01', sector: 'rail', passengers: 300, passenger_days: 31, freight_tonnes: 1700, freight_days: 31 },
        { month: '2026-02', sector: 'rail', passengers: 100, passenger_days: 28, freight_tonnes: null, freight_days: 0 }],
      weekly: { passengers: { ytd: { year: 2026, from: '2026-01-01', to: '2026-10-18', by_sector: { air: { value: 100 }, rail: { value: 300 } } } } } };
    const NM = { air: 'Агаар', road: 'Авто', rail: 'Төмөр зам', water: 'Ус' };
    const P4 = ['air', 'road', 'rail', 'water'].map((k) => ({ k, n: NM[k], c: '#' + k, q: k === 'air' ? 'verified' : 'none', v: k === 'air' ? 56 : 0, m: k === 'air' ? 'air.flight_count_last_month' : null }));
    const SEC4 = {}; Object.keys(NM).forEach((k) => { SEC4[k] = { label: NM[k], kpis: [['x', '1']] }; });
    const NE4 = { air: '#air', road: '#road', rail: '#rail', water: '#water' };
    const stx = (p, fb) => fb, CPT = (m, T) => G.chartPeriod(m, T);
    const SHARE = new Function('SECTORS', 'NEON', 'stxt', 'chartPeriodText', 'EHGlossary', 'return function(keys){' + mS[1] + '}')(SEC4, NE4, stx, CPT, G);
    const DON = new Function('SECTORS', 'NEON', 'stxt', 'EHGlossary', 'return function(activeKey){' + mD[1] + '}')(SEC4, NE4, stx, G);
    const siteD = (meas, keys) => DON.call({ state: { d05Measure: meas }, setState() {}, visibleSectorKeys: () => keys, valueFromSpec: () => null,
      kpiVerified: () => false, sectorTotalData: () => STAPI, homeSectorPeriod: () => 'X', sectorShareFromTotal(k) { return SHARE.call(this, k); } }, 'air');
    const admD = (meas, ps) => { const K = mkKit({ FEED, ST: { state: 'ready', weekly: STAPI.weekly, api: STAPI }, sectorParts: () => ps }); K.setMeas(meas);
      return { sh: K.pvD05Share('d05'), per: K.pvPeriodText('d05') }; };
    const cmp = (meas, keys) => { const s = siteD(meas, keys), a = admD(meas, P4.filter((p) => keys.indexOf(p.k) >= 0));
      const sp = s.arcs.map((x) => x.label + ':' + x.pctText).join(','), ap = a.sh ? a.sh.raw.map((r) => r.n + ':' + (r.live ? r.pct.toFixed(1) + '%' : '—')).join(',') : '';
      return { s, a, sp, ap, sum: a.sh ? a.sh.raw.reduce((t, r) => t + r.pct, 0) : 0 }; };
    const X = cmp('passengers', ['air', 'road', 'rail', 'water']);
    check('DG-P26. Зорчигч (оны эхнээс): агаар 25.0%, төмөр зам 75.0%, авто/ус «—», нийлбэр 100% — админ = сайт',
      X.ap === 'Агаар:25.0%,Авто:—,Төмөр зам:75.0%,Ус:—' && X.ap === X.sp && Math.abs(X.sum - 100) < 1e-9, X.ap + ' ≠ ' + X.sp);
    check('DG-P26. Зорчигч: хугацааны мөр «2026-01-01 — 2026-10-18 · 291 хоног», тэмдэглэл — админ = сайт',
      X.a.per === 'Хугацаа: 2026-01-01 — 2026-10-18 · 291 хоног' && X.a.per === X.s.period &&
      X.a.sh.note === '2026 оны эхнээс (01.01–10.18) · зорчигчоор · Авто, Ус — мэдээлэл алга' && X.a.sh.note === X.s.note && X.a.sh.unit === 'зорчигч',
      [X.a.per, X.s.period, X.a.sh && X.a.sh.note, X.s.note].join(' | '));
    const F = cmp('freight_tonnes', ['air', 'road', 'rail', 'water']);
    check('DG-P26. Ачаа (weekly алга → 2026 оны сарын нэгтгэл): 4/1704 = 0.2%, 1700/1704 = 99.8%, «2026-01 — 2026-02 · 2 сар» — админ = сайт',
      F.ap === 'Агаар:0.2%,Авто:—,Төмөр зам:99.8%,Ус:—' && F.ap === F.sp && Math.abs(F.sum - 100) < 1e-9 &&
      F.a.per === 'Хугацаа: 2026-01 — 2026-02 · 2 сар' && F.a.per === F.s.period && F.a.sh.note === F.s.note && /^2026 он \(сарын нэгтгэл\) · ачаагаар \(тонн\)/.test(F.a.sh.note),
      [F.ap, F.sp, F.a.per, F.s.period, F.a.sh && F.a.sh.note, F.s.note].join(' | '));
    const H = cmp('passengers', ['air', 'road', 'rail']);
    check('DG-P26. Нуусан салбар (ус) донутад ч, тэмдэглэлд ч орохгүй — админ = сайт',
      H.ap === 'Агаар:25.0%,Авто:—,Төмөр зам:75.0%' && H.ap === H.sp && H.a.sh.note === H.s.note && !/Ус/.test(H.a.sh.note), H.ap + ' | ' + H.a.sh.note);
    const O = cmp('passengers', ['air', 'road']);
    check('DG-P26. Ганц мэдээтэй салбар 100% → сайттай ижил «зөвхөн … салбар» анхааруулга (зохиомол биш гэдгийг хэлнэ)',
      O.ap === 'Агаар:100.0%,Авто:—' && O.ap === O.sp && O.a.sh.note === O.s.note && /Зөвхөн «Агаар»/.test(O.a.sh.note), O.a.sh.note + ' | ' + O.s.note);
    const N = admD('passengers', P4.filter((p) => p.k === 'road' || p.k === 'water'));
    const KF = mkKit({ FEED, sectorParts: () => P1, ST: { state: 'error', api: null } });
    check('DG-P26. Нэгтгэл алга эсвэл мэдээтэй салбар алга → null (хуучин агаарын зам, тоо зохиохгүй)',
      N.sh === null && KF.pvD05Share('d05') === null && KF.pvPeriodText('d05') === 'Хугацаа: 2026-09 · 1 сар', KF.pvPeriodText('d05'));
    const KT = mkKit({ FEED, ST: { state: 'ready', weekly: STAPI.weekly, api: STAPI }, sectorParts: () => P4,
      CON: { site: { chart: {}, sector_total: { d05_period_ytd: 'ZZ{year}', by_pax: 'ZZP', d05_off: 'ZZ{names}' } } } });
    check('DG-P26. Тэмдэглэлийн үг content.json site.sector_total-оос (засварлахад preview дагана)',
      (KT.pvD05Share('d05') || {}).note === 'ZZ2026 · ZZP · ZZАвто, Ус', (KT.pvD05Share('d05') || {}).note);
  }

  /* (б) Хөтөч: нүүр (агаарын таб) ба админы 16 виджет — ИЖИЛ фикстур */
  if (!CHROME) { skipped('DG-P25 (браузерын хэсэг)', 'Chrome олдсонгүй'); return; }
  const PROBE = `async function(d,w){
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const SRC={w2p:'w2p',w2pb:'w2p',w2px:'w2p',w2c:'w2c',w2cb:'w2c',w2cx:'w2c',t05:'t05',d05:'d05',i06:'i06',r06:'r06'};
    await sleep(4000);
    const tab=d.querySelector('[data-sector-tab="air"]'); if(tab){ tab.click(); await sleep(1500); }
    const site={};
    Object.keys(SRC).forEach(id=>{ const t=d.querySelector('[data-eh-card="'+SRC[id]+'"]'); if(!t){ site[id]=null; return; }
      const q=[].slice.call(d.querySelectorAll('[data-chart-period]')).find(x=>t.compareDocumentPosition(x)&4);
      site[id]=q?q.textContent.trim():null; });
    const pctOf=s=>{ const m=String(s||'').match(/([\\d.]+%)$/); return m?m[1]:'—'; };
    const srt=o=>Object.keys(o).sort().map(k=>k+':'+o[k]);
    const d05={site:null,admin:null,note:null,anote:null};
    const dn=d.querySelector('[data-dg-note="d05"]');
    if(dn){ d05.note=dn.textContent.trim(); let box=dn;
      while(box&&box.querySelectorAll('circle').length<3) box=box.parentElement;
      const o={}; if(box) [].slice.call(box.querySelectorAll('circle')).forEach(c=>{
        const tt=c.getAttribute('data-tip')||(c.querySelector('title')||{}).textContent||''; if(!tt) return;
        const i=tt.indexOf(' — '); if(i>0) o[tt.slice(0,i)]=pctOf(tt); });
      d05.site=srt(o); }
    const fr=w.frameElement; fr.src='/admin/index.html?fx=1';
    let a=null;
    for(let i=0;i<80;i++){ await sleep(250); try{ a=fr.contentDocument; }catch(e){ a=null; }
      if(a&&a.body&&a.body.innerHTML.length>8000&&String(fr.contentWindow.location.href).indexOf('admin')>=0) break; }
    await sleep(3500);
    for(let i=0;i<60&&a.querySelector('.pvfeed');i++) await sleep(500);
    const SEC={hero_fl:'hero',hero_px:'hero',uk:'portal-kpi',ls:'sec-01',w2p:'sec-02',w2pb:'sec-02',w2px:'sec-02',w2c:'sec-02',w2cb:'sec-02',
      w2cx:'sec-02',k04:'sec-04',t05:'sec-05',d05:'sec-05',i06:'sec-06',r06:'sec-06',u07:'sec-07'};
    const go=id=>{ let b,n=0; while((b=a.querySelector('[data-back]'))&&n++<6) b.click();
      const s=a.querySelector('[data-section="'+SEC[id]+'"]'); if(!s) return false; s.click();
      const c=a.querySelector('[data-widget="'+id+'"]'); if(!c) return false; c.click(); return true; };
    const line=()=>{ const e=a.querySelector('#pvhost [data-chart-period]'); return e?e.textContent.trim():''; };
    const admin={};
    Object.keys(SEC).forEach(id=>{ admin[id]=go(id)?line():'NAV'; });
    if(go('d05')){ const o={}; [].slice.call(a.querySelectorAll('#pvhost .pvrow')).forEach(r=>{
        o[(r.querySelector('span')||{}).textContent]=pctOf((r.querySelector('b')||{}).textContent); });
      d05.admin=srt(o); const an=a.querySelector('#pvhost [data-pvd05="note"]'); d05.anote=an?an.textContent.trim():null; }
    const ed={};
    if(go('w2p')){ const f=a.querySelector('.e-fm [data-sf="chart.period_prefix"]');
      ed.field=!!f;
      if(f){ const ov=f.value; f.value='ZZPERZZ'; f.dispatchEvent(new fr.contentWindow.Event('input',{bubbles:true}));
        ed.live=line(); f.value=ov; f.dispatchEvent(new fr.contentWindow.Event('input',{bubbles:true})); ed.back=line(); } }
    ed.dirty=(a.getElementById('dirtyMsg')||{}).textContent||'';
    return {site,admin,ed,d05};
  }`;
  const srv = serve();
  try {
    PROBE_SRC = '/index.html?fx=1#/';
    const R = await runProbe(PROBE, 120000);
    if (R.__err) { bad('DG-P25. Хөтчийн проб ажиллав', R.__err); return; }
    const S = R.site || {}, A = R.admin || {};
    /* d05: сайт ба админ хоёулаа салбарын нэгтгэлийн «оны эхнээс» хувийг (EHGlossary.sectorShare) зурна */
    const same = ['w2p', 'w2pb', 'w2px', 'w2c', 'w2cb', 'w2cx', 't05', 'd05', 'i06', 'r06'];
    const diff = same.filter((id) => !S[id] || S[id] !== A[id]).map((id) => id + ': сайт «' + S[id] + '» · админ «' + A[id] + '»');
    check('DG-P25. Админы preview-ийн мөр = нүүрний картын мөр (10 виджет, ?fx=1)', diff.length === 0, diff.join(' | '));
    check('DG-P25. d05 preview-д нэгтгэлийн оны эхнээс муж («Хугацаа: YYYY-01-01 — YYYY-MM-DD · N хоног»)',
      /^Хугацаа: (\d{4})-01-01 — \1-\d{2}-\d{2} · \d+ хоног$/.test(A.d05 || ''), A.d05);
    /* Донутын хувь ба тэмдэглэл — сайтын картын легенд = админы preview-ийн мөр (ИЖИЛ фикстур) */
    const d5 = R.d05 || {};
    check('DG-P25. d05 донутын хувь, тэмдэглэл: админ = сайт (?fx=1)',
      !!d5.site && d5.site.length > 1 && JSON.stringify(d5.site) === JSON.stringify(d5.admin) && !!d5.note && d5.note === d5.anote,
      JSON.stringify(d5));
    const extra = ['hero_fl', 'hero_px', 'ls', 'k04', 'uk', 'u07'].filter((id) => A[id] !== '');
    check('DG-P25. Хугацааны мөргүй виджет preview-д мөр гаргахгүй (сайттай ижил)', extra.length === 0, extra.map((id) => id + ':' + A[id]).join(' | '));
    const ed = R.ed || {};
    check('DG-P25. «Хугацаа» үг засварлагдана, бичих даруйд preview шинэчлэгдэж буцаахад эргэнэ',
      ed.field === true && /^ZZPERZZ: /.test(ed.live || '') && ed.back === A.w2p && /алга/.test(ed.dirty), JSON.stringify(ed));
  } finally {
    PROBE_SRC = '/admin/index.html';
    srv.close();
  }
}

/* ── RPX. Авто тээврийн зорчигч тээврийн мэдээ (roadPax · Veritech 15401437) ──────────
   Гараар бодох фикстур (нүдээр "зөв харагдана" гэж батлахгүй):
     2025-08 бүтэн 31/31: Хот 250 · Улс 50 = 300 (буцаалт Хот 20 · Улс 10)
     2025-09 бүтэн 30/30: Хот 280 · Улс 50 = 330 (буцаалт Хот 30 · Улс 3)
     2025-10 5/31 өдөр  : Хот 50            =  50 — мэдээ ДУТУУ (90%-иас цөөн өдөр)
     2026-08 бүтэн      : Хот 270 · Улс 60 = 330 (буцаалт Хот 30 · Улс 3)
     2026-09 бүтэн      : Хот 300 · Улс 63 = 363
     2026-10 1–19 (ДУТУУ, дуусаагүй сар): Хот 180 · Улс 20 = 200 (буцаалт Хот 10)
   Нийт 1,573 зорчигч · 106 буцаалт · 146 өдөр; Хот 1,330 · Улс 243.
   YoY: бүтэн хос сар 2 (08, 09) < 3 → гаргахгүй ("few"). */
/* RI. 06-р хэсгийн индекс (i06/r06) — авто тээврийн зорчигч (2026-10-22 хэрэглэгч: «06-р
   хэсгийн индекс графикт авто тээврийг нэм»). Эх сурвалж цонхоор ачаалагддаг тул дутуу
   сарын НИЙТИЙГ бүтэн сартай харьцуулбал худал уналт гарна (2026-08: 21/31 хоног).
   Гараар бодох фикстур (2026, 4 сар):
     01  26/31 хоног · хамрагдсан 2600 → 2600/26×31 = 3100 (дутуу)  → индекс 100 (суурь)
     02  28/28 хоног · 2800                                          → 90.3
     03   0/31 хоног · 12 хожуу билет → null (шугам тасарна, 0 биш)
     04  30/30 хоног · 3100                                          → 100 */
async function groupRI() {
  group('RI. 06-р хэсгийн индекс — авто тээврийн зорчигч');
  const src = dcScript();
  const fm = src.match(/\nfunction roadPaxMonthSeries\(h,year,months\)\{[\s\S]*?\n\}\n/);
  check('RI0. roadPaxMonthSeries тодорхойлогдсон', !!fm);
  if (!fm) return;
  const F = new Function(fm[0] + '\nreturn roadPaxMonthSeries;')();
  const H = { status: 'ok', months: [
    { month: '2026-01', days: 26, days_in_month: 31, passengers: 2700, passengers_covered: 2600 },
    { month: '2026-02', days: 28, days_in_month: 28, passengers: 2800, passengers_covered: 2800 },
    { month: '2026-03', days: 0, days_in_month: 31, passengers: 12, passengers_covered: 0 },
    { month: '2026-04', days: 30, days_in_month: 30, passengers: 3100, passengers_covered: 3100 },
    { month: '2025-12', days: 31, days_in_month: 31, passengers: 9999, passengers_covered: 9999 }] };
  const s = F(H, 2026, 4);
  check('RI1. Дутуу сар = хамрагдсан хоногийн дундаж × сарын хоног (2600/26×31 = 3100), partial',
    s && s[0].v === 3100 && s[0].partial === true && s[0].days === 26 && s[0].dim === 31, JSON.stringify(s && s[0]));
  check('RI2. Бүтэн сар = эх нийт (2800, 3100), partial биш',
    s && s[1].v === 2800 && !s[1].partial && s[3].v === 3100 && !s[3].partial, JSON.stringify(s));
  check('RI3. Хамрагдсан хоног 0 (12 хожуу билет) → null — 0/12 гэж зурахгүй',
    s && s[2].v === null && s.length === 4, JSON.stringify(s && s[2]));
  const idx = s ? s.map((x) => x.v == null ? null : Math.round(x.v / s[0].v * 1000) / 10) : [];
  check('RI4. Индекс 1-р сар = 100: [100, 90.3, null, 100]', JSON.stringify(idx) === '[100,90.3,null,100]', JSON.stringify(idx));
  check('RI5. Өөр он ороогүй, ok бус / хоосон бол null',
    F(H, 2025, 3) === null && F({ status: 'no_data', months: [] }, 2026, 4) === null && F(null, 2026, 4) === null);
  const s2 = F({ status: 'ok', months: [{ month: '2026-01', days: 10, days_in_month: 31, passengers: 1000 }] }, 2026, 1);
  check('RI6. passengers_covered байхгүй (хуучин хариу) бол passengers-ээр: 1000/10×31 = 3100', s2 && s2[0].v === 3100, JSON.stringify(s2));

  const idxSrc = read('index.html'), reg = JSON.parse(read('metric_registry.json'));
  check('RI7. Registry: i06 ба r06-д road бүртгэлтэй',
    reg.widgets.i06.sectors.includes('road') && reg.widgets.r06.sectors.includes('road'));
  check('RI8. road шугам үзлэгийн c1d-ийг БИШ roadPax түүхийг уншина; шугам/эрэмбэ хоёулаа trendI06',
    idxSrc.includes("roadPaxMonthSeries(this._roadPaxAll,cw.year,months)") &&
    /const t=trendI06\(k\), li=lastOf\(t\);/.test(idxSrc) && /const t=trendI06\(k,airR06\)/.test(idxSrc));
  check('RI9. Мэдээгүй сард шугам ТАСАРНА (M), утга нь min/max-д null-гүй',
    idxSrc.includes("if(v==null){ pen=false; return; }") && idxSrc.includes('.filter(v=>v!=null):[60,130]'));
  check('RI10. Дутуу сарын hollow цэг tooltip-тэй (HV)',
    /<sc-for list="\{\{ comparePartialPts \}\}"[\s\S]{0,200}<title>\{\{ cp\.tip \}\}<\/title>/.test(idxSrc));

  if (!CHROME) { skipped('RI11 сайт дээрх авто тээврийн шугам (хөтөч)', 'Chrome олдсонгүй'); return; }
  const probe = async function (d, w) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = f(); if (v) return v; await sleep(200); } return null; };
    const card = () => { const t = d.querySelector('[data-eh-card="i06"][data-eh-field="title"]'); let c = t; while (c && !c.querySelector('svg')) c = c.parentElement; return c; };
    const roadPath = () => { const c = card(); return c && [...c.querySelectorAll('path')].find((p) => (p.getAttribute('stroke') || '').toUpperCase() === '#8CA9E8'); };
    const flat = (p) => { const ys = (p.getAttribute('d').match(/,[\d.]+/g) || []).map((x) => +x.slice(1)); return ys.length < 2 || ys.every((y) => y === ys[0]); };
    await until(() => roadPath() && !flat(roadPath()), 30000);
    const p = roadPath();
    const c = card();
    const out = { has: !!p, d: p ? p.getAttribute('d') : null, flat: p ? flat(p) : null };
    out.tips = c ? [...c.querySelectorAll('circle title')].map((t) => t.textContent) : [];
    const rk = d.querySelector('[data-eh-card="r06"][data-eh-field="title"]'), rc = rk && rk.parentElement;
    out.rank = rc ? [...rc.querySelectorAll('div')].filter((r) => r.children.length >= 4 && /^\d\d$/.test((r.children[0].textContent || '').trim()))
      .map((r) => r.innerText.replace(/\s+/g, ' ').trim()) : [];
    return out;
  };
  const srv = serve();
  const prevSrc = PROBE_SRC;
  PROBE_SRC = '/index.html?fx=1';
  let R;
  try { R = await runProbe('async function(d,w){return (' + probe.toString() + ')(d,w);}', 60000); }
  finally { PROBE_SRC = prevSrc; srv.close(); }
  if (!R || R.__err) { bad('RI11. Нүүрний индекс графикийн probe', JSON.stringify(R)); return; }
  check('RI11. Сайт: авто тээврийн шугам бодит цуваатай (хавтгай 0 биш, NaN-гүй)',
    R.has && R.flat === false && !/NaN|undefined/.test(R.d || ''), JSON.stringify(R).slice(0, 400));
  check('RI12. Сайт: авто тээврийн төгсгөлийн цэг tooltip «Авто тээвэр — N индекс»',
    R.tips.some((t) => /^Авто тээвэр — (\d+-р сар: )?\d+ индекс/.test(t)), JSON.stringify(R.tips));
  const rr = R.rank.find((x) => /Авто тээвэр/.test(x)) || '';
  check('RI13. Сайт: r06 эрэмбэд авто тээвэр хувьтай, «мэдээлэл алга» биш',
    /[+-]\d+(\.\d)?%/.test(rr) && !/мэдээлэл алга/.test(rr), JSON.stringify(R.rank));
}

function groupRPX() {
  group('RPX. Авто тээврийн зорчигч — модель · 7 хоногийн тайлан · график · холболт');
  const src = dcScript();
  const am = src.match(/\nfunction roadPaxAnalysisModel\(all,sel,year,mr\)\{([\s\S]*?)\n\}/);
  const wm = src.match(/\nfunction roadPaxWeeklyModel\(all\)\{([\s\S]*?)\n\}/);
  const bm = src.match(/\nfunction buildRoadPaxWeekBars\(weeks,values,color,words\)\{([\s\S]*?)\n\}/);
  const yoc = src.match(/\nfunction yoyCompare\(months,yr,mFrom,mTo,key\)\{([\s\S]*?)\n\}/);
  const colM = src.match(/const ROAD_PAX_TYPE_COLORS=(\{[^}]*\});/);
  const exM = src.match(/const ROAD_PAX_EXTRA_COLORS=(\[[^\]]*\]);/);
  const crM = src.match(/const ROAD_PAX_COMPLETE_RATIO=([0-9.]+);/);
  const ymM = src.match(/const ROAD_PAX_YOY_MIN=([0-9]+);/);
  check('RPX0. roadPaxAnalysisModel + roadPaxWeeklyModel + buildRoadPaxWeekBars + тогтмолууд тодорхойлогдсон',
    !!(am && wm && bm && yoc && colM && exM && crM && ymM));
  if (!(am && wm && bm && yoc && colM && exM && crM && ymM)) return;
  check('RPX0. Бүтэн сар = 90%+ өдөр, YoY ≥ 3 бүтэн хос сар (ачаа тээвэртэй ижил)', +crM[1] === 0.9 && +ymM[1] === 3);
  const YOC = new Function('months', 'yr', 'mFrom', 'mTo', 'key', yoc[1]);
  const COLORS = eval('(' + colM[1] + ')'), EXTRA = eval(exM[1]);
  const typeColor = (t, i) => COLORS[t] || EXTRA[(i || 0) % EXTRA.length];
  const AM = (all, sel, year, mr) => new Function('ROAD_PAX_COMPLETE_RATIO', 'ROAD_PAX_YOY_MIN', 'yoyCompare', 'roadPaxTypeColor',
    'all', 'sel', 'year', 'mr', am[1])(+crM[1], +ymM[1], YOC, typeColor, all, sel, year, mr);
  const WM = (all) => new Function('roadPaxTypeColor', 'all', wm[1])(typeColor, all);
  const BM = new Function('weeks', 'values', 'color', 'words', bm[1]);
  const H = 'Хот хооронд', U = 'Улс хооронд';
  const mo = (month, days, dim, last, bt, rt) => ({ month, days, days_in_month: dim, last_date: last,
    passengers: Object.values(bt).reduce((a, b) => a + b, 0), refunded: Object.values(rt || {}).reduce((a, b) => a + b, 0),
    by_type: bt, refunded_by_type: rt || {} });
  const ALL = { status: 'ok', types: [H, U], months: [
    mo('2025-08', 31, 31, '2025-08-31', { [H]: 250, [U]: 50 }, { [H]: 20, [U]: 10 }),
    mo('2025-09', 30, 30, '2025-09-30', { [H]: 280, [U]: 50 }, { [H]: 30, [U]: 3 }),
    mo('2025-10', 5, 31, '2025-10-31', { [H]: 50, [U]: 0 }, {}),
    mo('2026-08', 31, 31, '2026-08-31', { [H]: 270, [U]: 60 }, { [H]: 30, [U]: 3 }),
    mo('2026-09', 30, 30, '2026-09-30', { [H]: 300, [U]: 63 }, {}),
    mo('2026-10', 19, 31, '2026-10-19', { [H]: 180, [U]: 20 }, { [H]: 10 })],
    by_route: [{ name: 'Да.Дархан - УБ - Да.Дархан', route_type: H, passengers: 900 }, { name: 'Эрээн - Замын-Үүд', route_type: U, passengers: 243 },
      { name: 'Хө.Мөрөн - УБ - Хө.Мөрөн', route_type: H, passengers: 430 }],
    by_company: [{ name: 'А ХХК', passengers: 1000 }, { name: 'Б ХХК', passengers: 573 }],
    by_channel: [{ name: 'Онлайн', passengers: 1000 }, { name: null, passengers: 3 }, { name: 'Касс', passengers: 570 }],
    by_vehicle: [], by_passenger_type: [{ name: 'Том хүн', passengers: 1500 }, { name: 'Хүүхэд', passengers: 73 }],
    upcoming: { passengers: 47, from: '2026-10-20', to: '2026-10-25' } };
  const m = AM(ALL, null, 'all', null);
  check('RPX1. Нийт 1,573 зорчигч (буцаасныг хассан), 106 буцаалт → 106/1,679 = 6.31%, 146 өдөр, өдөрт 1,573/146',
    m.hasData && m.passengers === 1573 && m.refunded === 106 && m.days === 146 &&
    Math.abs(m.refundPct - 106 / 1679 * 100) < 1e-9 && Math.abs(m.perDay - 1573 / 146) < 1e-9,
    JSON.stringify([m.passengers, m.refunded, m.days]));
  const sumPct = m.byType.reduce((t, x) => t + x.pct, 0);
  check('RPX2. Тээврийн төрөл: Хот 1,330 · Улс 243, хувь нийлбэр 100%, нийлбэр = нийт зорчигч',
    m.byType[0].type === H && m.byType[0].passengers === 1330 && m.byType[1].passengers === 243 &&
    Math.abs(sumPct - 100) < 1e-9 && m.byType.reduce((t, x) => t + x.passengers, 0) === m.passengers, JSON.stringify(m.byType));
  check('RPX3. Дутуу сар: цөөн өдөртэй 2025-10 (5/31) ба дуусаагүй 2026-10 — шошго "*", дунд 9 сар хоосон слот',
    m.partialN === 2 && m.series.labels.includes('25-10*') && m.series.labels[m.series.labels.length - 1] === '26-10*' &&
    m.series.gap.filter(Boolean).length === 9 && m.partialTo === '2026-10-19', JSON.stringify(m.series.labels));
  check('RPX4. YoY: бүтэн хос сар 2 (08, 09) < 3 → «Өмнөх оноос» ГАРАХГҮЙ ("few")',
    m.yoy === null && m.yoyReason === 'few', JSON.stringify([m.yoy, m.yoyReason]));
  const Y3 = AM({ status: 'ok', types: [H], months: ['07', '08', '09'].flatMap((x, i) => [
    mo('2025-' + x, 30, 30, '2025-' + x + '-30', { [H]: 100 }), mo('2026-' + x, 30, 30, '2026-' + x + '-30', { [H]: 110 + i * 10 })]) }, null, 'all');
  check('RPX4. 3 бүтэн хос сар: (110+120+130)/(3×100) − 1 = +20.0%',
    !!Y3.yoy && Math.abs(Y3.yoy.pct - 20) < 1e-9 && Y3.yoy.months === 3, JSON.stringify(Y3.yoy));
  /* FL3 — хүснэгтийн «Тээврийн төрөл» шүүлт: KPI, харьцаа, график, буцаалт, чиглэл ХАМТ */
  const mu = AM(ALL, null, 'all', { keys: new Set([U]) });
  check('RPX5. «Улс хооронд» шүүлт (FL3): зорчигч 243, буцаалт 10+3+3 = 16, төрөл 1, чиглэл 1 (Эрээн)',
    mu.passengers === 243 && mu.refunded === 16 && mu.types.length === 1 && mu.byType[0].pct === 100 &&
    mu.routes.length === 1 && mu.routes[0].name === 'Эрээн - Замын-Үүд' && mu.routeTotal === 243,
    JSON.stringify([mu.passengers, mu.refunded, mu.routes.map(r => r.name)]));
  check('RPX5. Тээвэрлэгч/суваг төрлөөр задрахгүй — шүүлтэд ХАМААРАХГҮЙ (бүх мөр хэвээр)',
    mu.companies.length === 2 && mu.companyTotal === 1573);
  const y26 = AM(ALL, null, 2026);
  check('RPX6. Он 2026: 330 + 363 + 200 = 893; задаргаа сонгосон хүрээний хариуг хүлээнэ (sel=null → pending)',
    y26.passengers === 893 && !y26.hasBreakdown, String(y26.passengers));
  check('RPX7. Эрэмбэ эзлэхүүнээр; нэргүй суваг хаягдахгүй (нийт = 1,573)',
    m.routes[0].passengers === 900 && m.routes[1].passengers === 430 && m.channels.length === 3 &&
    m.channelTotal === 1573 && m.channels.some(c => c.name === ''), JSON.stringify(m.channels));
  check('RPX8. Ирээдүйн (урьдчилж зарсан) билет тусад нь — тайланд ороогүй',
    m.upcoming && m.upcoming.passengers === 47);
  check('RPX9. Түүх алга / no_data / буруу хариу → hasData:false (тоо зохиохгүй)',
    !AM(null).hasData && !AM({ status: 'no_data', months: [] }).hasData && !AM({ status: 'ok' }).hasData);
  check('RPX9. Сонгосон хүрээнд сар алга бол hasData:false, жилүүд буцна (шүүлт харагдсаар)',
    AM(ALL, null, 2024).hasData === false && JSON.stringify(AM(ALL, null, 2024).years) === '[2025,2026]');
  check('RPX9. Шүүлтэд таарах төрөл алга (keys хоосон) → hasData:false',
    AM(ALL, null, 'all', { keys: new Set(['Орон нутаг']) }).hasData === false);

  /* 7 хоногийн тайлан (зурган тайлангийн загвар):
       10-05…10-11: Хот 150 · Улс 50 = 200 · 10-12…10-18: Хот 160 · Улс 20 = 180
       өмнөх 7 хоногоос: 180/200 − 1 = −10.0% (Хот +6.67%, Улс −60%)
       өмнөх оны мөн 7 хоног (бүтэн): Хот 120 · Улс 30 = 150 → +20.0% (Хот +33.3%)
       оны эхнээс 1,000 (Хот 800) — өмнөх оны мөн үе ДУТУУ (84/280 өдөр) → харьцуулахгүй */
  const WK = { status: 'ok', months: ALL.months, weekly: { week_end: '2026-10-18', max_date: '2026-10-19', types: [H, U],
    weeks: [{ week_start: '2026-10-05', week_end: '2026-10-11', missing: false, days: 7, passengers: 200, by_type: { [H]: 150, [U]: 50 } },
      { week_start: '2026-10-12', week_end: '2026-10-18', missing: false, days: 7, passengers: 180, by_type: { [H]: 160, [U]: 20 } }],
    ytd: { year: 2026, from: '2026-01-01', to: '2026-10-18', passengers: 1000, days: 280, by_type: { [H]: 800, [U]: 200 } },
    prev_ytd: { year: 2025, from: '2025-01-01', to: '2025-10-18', passengers: 500, days: 84, by_type: { [H]: 400, [U]: 100 }, comparable: false },
    prev_year_week: { week_start: '2025-10-13', week_end: '2025-10-19', passengers: 150, days: 7, by_type: { [H]: 120, [U]: 30 }, comparable: true } } };
  const w = WM(WK);
  const hx = w && w.perType.find(p => p.type === H), ux = w && w.perType.find(p => p.type === U);
  check('RPX10. 7 хоног: 180; өмнөх 7 хоногоос −10.0%; өмнөх оны мөн 7 хоногоос +20.0%; YTD 1,000',
    !!w && w.total.week === 180 && Math.abs(w.total.wow + 10) < 1e-9 && Math.abs(w.total.yoy - 20) < 1e-9 && w.total.ytd === 1000,
    JSON.stringify(w && w.total));
  check('RPX11. Төрөл бүрээр: Хот +6.67% / +33.3%, Улс −60.0% / −33.3%; цуваа 2 долоо хоног',
    Math.abs(hx.wow - (160 / 150 - 1) * 100) < 1e-9 && Math.abs(hx.yoy - (160 / 120 - 1) * 100) < 1e-9 &&
    Math.abs(ux.wow + 60) < 1e-9 && Math.abs(ux.yoy - (20 / 30 - 1) * 100) < 1e-9 && JSON.stringify(hx.series) === '[150,160]');
  check('RPX12. Өмнөх оны мөн үе ДУТУУ (84/280 өдөр) → оны эхнээс өссөн дүнгийн YoY гаргахгүй (−50% ХУДАЛ уналт биш)',
    w.ytdComparable === false && w.total.ytdYoy === null && hx.ytdYoy === null);
  check('RPX13. 7 хоногийн төрлийн хувь: Хот 160/180, нийлбэр 100%',
    Math.abs(w.weekShares.list[0].pct - 160 / 180 * 100) < 1e-9 &&
    Math.abs(w.weekShares.list.reduce((t, x) => t + x.pct, 0) - 100) < 1e-9);
  const WK2 = JSON.parse(JSON.stringify(WK));
  WK2.weekly.weeks[0].missing = true; WK2.weekly.weeks[0].passengers = null;
  WK2.weekly.prev_year_week.comparable = false;
  const w2 = WM(WK2);
  check('RPX14. Өмнөх 7 хоног бичлэггүй / өмнөх оны мөн 7 хоног дутуу → харьцуулалт null (0% эсвэл ∞ зохиохгүй)',
    w2.total.wow === null && w2.total.yoy === null && w2.perType[0].series[0] === null);
  check('RPX15. weekly алга (шүүлттэй хариу, хуучин backend) → null', WM({ status: 'ok', months: [] }) === null && WM(null) === null);

  const bars = BM(WK2.weekly.weeks, [null, 160], '#3B82F6', { unit: 'зорчигч' });
  const b = bars.bars.find(r => r.tip === '10.12–10.18 — 160 зорчигч');
  check('RPX16. Hover "10.12–10.18 — 160 зорчигч" (HV: нэр — утга), утга баганын дээр',
    !!b && bars.labels.length === 2 && bars.labels[1].label === '160' && bars.labels[0].label === 'мэдээлэл алга', JSON.stringify(bars.bars.map(r => r.tip)));
  check('RPX16. Бичлэггүй 7 хоног — бүдэг тууз + "мэдээлэл алга" (0 багана биш)',
    bars.bars.filter(r => /мэдээлэл алга/.test(r.tip)).length === 1);
  const b3 = BM(WK.weekly.weeks, [80, 160], '#000', {});
  check('RPX16. Өндөр утгатайгаа пропорциональ, Y 0-ээс (160 = 80-ийн 2 дахин)',
    Math.abs(+b3.bars[1].h / +b3.bars[0].h - 2) < 0.02 && Math.abs(+b3.bars[1].y + +b3.bars[1].h - +b3.baseY) < 0.2);

  /* Холболт — шинэ датасэт нэмэхэд ХАМТ өөрчлөгдөх газрууд (CLAUDE.md RAW: backend DATASETS +
     index.html DS_ROWS_API + feed-fixtures) */
  const fxSrc = read('tests/lib/feed-fixtures.js');
  const content = JSON.parse(read('content.json'));
  check('RPX17. roadPax: DATASETS + SOURCES + DS_ROWS_API + DS_ROWS_SCOPE + DS_SCHEMA + API_ENDPOINTS',
    src.includes("name:'Авто тээврийн зорчигч тээврийн мэдээ'") && src.includes("schema:'road_pax',source:'roadPax'") &&
    /roadPax:\{label:/.test(src) && src.includes("roadPax:'road-passengers'") && src.includes("roadPax:{col:'route_type'}") &&
    src.includes('  road_pax:{head:') && src.includes("'/api/sectors/road/passengers/history'"));
  check('RPX18. Фикстурт түүхий мөр (road-passengers) + түүх + 7 хоног (layout-audit/FL11 өгөгдөлтэй төлөв)',
    fxSrc.includes("'road-passengers'") && fxSrc.includes('/api/sectors/road/passengers/history') && /out\.weekly = \{ max_date/.test(fxSrc));
  check('RPX19. content.json: site.datasets-д мөр (индексээр), road_pax_an, ds_schema_road_pax, pv_scope.note_road_pax',
    content.site.datasets.some(d => d.name === 'Авто тээврийн зорчигч тээврийн мэдээ') && !!content.site.road_pax_an &&
    !!content.site.ds_schema_road_pax && !!content.site.pv_scope.note_road_pax);
  check('RPX20. EHBackend.fetchRoadPassengersHistory — /api/sectors/road/passengers/history',
    /function fetchRoadPassengersHistory\(from, to\)[\s\S]*?\/api\/sectors\/road\/passengers\/history/.test(read('js/erthub-backend.js')));
  check('RPX21. Нийслэлийн нийтийн тээвэр эх сурвалжид алга гэдгийг ИЛ хэлнэ (тоо зохиохгүй)',
    /roadPaxCapitalNote/.test(src) && /«Нийслэл»/.test(content.site.road_pax_an.capital_note));
  check('RPX22. Доод «7 хоногийн гүйцэтгэл» (wp) карт 7 хоногийн тайлангаас (төлөвлөгөө эх сурвалжгүй — hasPlan:false)',
    src.includes('if(roadPaxExtra.roadPaxWp) Object.assign(wp,roadPaxExtra.roadPaxWp);') && /const wp=\{wpNoData:false,hasData:true,hasPlan:false,/.test(src));
  check('RPX23. Салбарын ерөнхий «чиг хандлага + бүтэц» мөр гарахгүй (өөрийн самбартай)',
    src.includes('notRoadInspect:!isRoadInspect&&!isFreight&&!isSumTotal&&!isRoadPax,'));
  /* 7 хоногийн графикийн хугацаа — сарын бус өдрийн муж (DG-P) */
  const G = require(path.join(ROOT, 'js/erthub-glossary.js'));
  check('RPX24. EHGlossary.weekSpan: "Хугацаа: 2026-08-24 — 2026-10-18 · 8 долоо хоног"; огноогүй → мэдээлэл алга',
    G.weekSpan('2026-08-24', '2026-10-18', 8).text === 'Хугацаа: 2026-08-24 — 2026-10-18 · 8 долоо хоног' &&
    G.weekSpan('', '2026-10-18', 8).text === 'Хугацаа: мэдээлэл алга');
  /* Салбарын нэгтгэлийн fallback — авто тээвэр билеттэй зорчигчоор */
  const fb = src.match(/\nfunction sectorTotalFallback\(p\)\{([\s\S]*?)\n\}/);
  const ord = src.match(/const SECTOR_TOTAL_ORDER=(\[[^\]]*\]);/);
  if (fb && ord) {
    const FB = new Function('SECTOR_TOTAL_ORDER', 'p', fb[1]);
    const r = FB(eval(ord[1]), { roadPax: ALL });
    const road = r.months.filter(x => x.sector === 'road');
    check('RPX25. sectorTotalFallback: авто тээврийн сар бүрийн зорчигч = roadPax-ийн «Хэвийн» билет (1,573)',
      road.length === 6 && road.reduce((t, x) => t + x.passengers, 0) === 1573 &&
      r.sectors.find(s => s.sector === 'road').has_passengers === true, JSON.stringify(road.map(x => x.passengers)));
  } else check('RPX25. sectorTotalFallback тодорхойлогдсон', false);
  /* Регресс (2026-10-20, бодит өгөгдөл): эх сурвалж цонхоор ачаалагддаг — 2026-08-22…09-15 өдөрт 6–300
     билет (хэвийн 4–9 мянга). Хэсэгчилсэн 7 хоногийг бүтэнтэй харьцуулбал «−97%» ХУДАЛ уналт гарна. */
  const WK3 = JSON.parse(JSON.stringify(WK));
  WK3.weekly.weeks[0].days = 2; WK3.weekly.weeks[0].passengers = 20;
  const w3 = WM(WK3);
  check('RPX27. Өмнөх 7 хоног хэсэгчилсэн (2/7 өдөр мэдээтэй) → «Өмнөх 7 хоногоос» харьцуулахгүй (null)',
    w3.total.wow === null && w3.prevFull === false && w3.partialWeeks === 1 && w3.perType[0].wow === null);
  const WK4 = JSON.parse(JSON.stringify(WK)); WK4.weekly.weeks[1].days = 6;
  check('RPX27. Сүүлийн 7 хоног хэсэгчилсэн → өмнөх оны мөн 7 хоногтой ч харьцуулахгүй', WM(WK4).total.yoy === null);
  const b5 = BM(WK3.weekly.weeks, [20, 160], '#000', { unit: 'зорчигч', partial: '{d}/7 өдөр мэдээтэй' });
  check('RPX28. Хэсэгчилсэн 7 хоногийн багана бүдэг (.35), tooltip-д "2/7 өдөр мэдээтэй"',
    b5.bars[0].op === '.35' && /\(2\/7 өдөр мэдээтэй\)$/.test(b5.bars[0].tip) && b5.bars[1].op === '.88', b5.bars[0].tip);
  const mg = AM(Object.assign({}, ALL, { coverage: { gaps: [{ from: '2026-08-22', to: '2026-09-15', days: 25 }, { from: '2024-01-01', to: '2024-02-01', days: 32 }] } }), null, 2026);
  check('RPX29. Эх сурвалжийн цоорхой сонгосон хугацаанд огтлолцсоныг л нэрлэнэ (2026 → 1 цоорхой)',
    mg.gaps.length === 1 && mg.gaps[0].from === '2026-08-22');
  check('RPX29. Цоорхойн тайлбар ба урьдчилсан билетийн тэмдэглэл (алдаатай алс ирээдүйн огноог нэрлэхгүй)',
    src.includes("T('gap_note',") && !/upcoming_note','[^']*\{to\}/.test(src));
  /* Регресс (статистикч QA 2026-10-20): 2.2 сая мөр — хүснэгт ҮРГЭЛЖ таслагдсан тул «Тээврийн төрөл»-ийн
     шүүлт KPI-д огт хүрдэггүй байв. Хамрах баганыг өөрийг нь шүүсэн бол түлхүүр = сонгосон утга. */
  check('RPX30. Таслагдсан хүснэгтэд хамрах баганын шүүлт KPI-г шүүнэ (түлхүүр = сонгосон утга); өөр багана — хамаарахгүй',
    src.includes("if(kl||!ks.every(k=>String(k)===String(ki))) return none;") &&
    src.includes("keys:new Set([String(selRaw[ki]).trim()])"));
  check('RPX31. Өдрийн дундаж = мэдээтэй өдрийн зорчигч / мэдээтэй өдөр (хуваагч ба хуваагдагч ижил олонлог)',
    src.includes('perDay:days>0?ms.reduce((t,m)=>t+m.paxCovered,0)/days:null'));
  /* Текст бүр content.json-д (T('k','fallback') → site.road_pax_an.k) — дутуу/үхмэл түлхүүргүй */
  const body = (src.split('  buildRoadPaxAnalysis(dsel){')[1] || '').split('  buildDocDetail(){')[0];
  const keys = [...new Set([...body.matchAll(/\bT\('([a-z_0-9.]+)',/g)].map(x => x[1]))];
  const missing = keys.filter(k => content.site.road_pax_an[k] === undefined);
  const dead = Object.keys(content.site.road_pax_an).filter(k => k !== 'unnamed' && !keys.includes(k));
  check('RPX26. buildRoadPaxAnalysis-ийн текст бүр site.road_pax_an-д, үхмэл түлхүүргүй', keys.length > 40 && !missing.length && !dead.length,
    'дутуу: ' + missing.join(',') + ' · үхмэл: ' + dead.join(','));
}

function groupDG() {
  group('DG. Домэйны толь ба графикийн sanity');
  let G = null;
  try { G = require(path.join(ROOT, 'js', 'erthub-glossary.js')); } catch (e) { /* доор bad */ }
  check('DG1. js/erthub-glossary.js ачаалагдана (airFlightKind, ratioSanity, airPaxSplit)',
    !!G && typeof G.airFlightKind === 'function' && typeof G.ratioSanity === 'function' && typeof G.airPaxSplit === 'function');
  if (!G) return;

  /* DG-P. Графикийн хугацаа (periodSpan): ЯГ тооцох боломжтой фикстур.
     2022-01, 2022-02, 2022-05 (3 сар өгөгдөлгүй) → хүрээ 2022-01 — 2022-05 = 5 сар. */
  const P = G.periodSpan(['2022-05', '2022-01', '2022-02'], {});
  check('DG-P1. periodSpan: хүрээ эхнийг/сүүлийнхийг авна, хугацаа өгөгдөлгүй сараар ТАСРААГҮЙ',
    P.from === '2022-01' && P.to === '2022-05' && P.count === 5,
    JSON.stringify(P));
  check('DG-P2. periodSpan текст: «Хугацаа: 2022-01 — 2022-05 · 5 сар»',
    P.text === 'Хугацаа: 2022-01 — 2022-05 · 5 сар', P.text);
  const P1 = G.periodSpan(['2026-08'], {});
  check('DG-P3. Ганц сар → нэг огноо, «1 сар»',
    P1.text === 'Хугацаа: 2026-08 · 1 сар', P1.text);
  check('DG-P4. Хоосон түлхүүр → "мэдээлэл алга" (хугацаа зохиохгүй)',
    G.periodSpan([], {}).count === 0 && /мэдээлэл алга/.test(G.periodSpan(null, {}).text));
  const PP = G.periodSpan(['2026-09', '2026-10'], { partialTo: '2026-10-17' });
  check('DG-P5. Дутуу сар → «дутуу сар (… хүртэл)» тэмдэглэгээ',
    /дутуу сар \(2026-10-17 хүртэл\)$/.test(PP.text), PP.text);
  check('DG-P7. Дутуу сар тоогоор (partialCount) → «дутуу сар», огноогүй; хасагдсан сар → «дутуу сар хасагдсан»',
    G.periodSpan(['2026-09','2026-10'],{partialCount:1}).text === 'Хугацаа: 2026-09 — 2026-10 · 2 сар · дутуу сар' &&
    G.periodSpan(['2026-01'],{dropped:true}).text === 'Хугацаа: 2026-01 · 1 сар · дутуу сар хасагдсан');

  /* DG-P8. Хугацааны мөр БҮХ диаграммд: rail (freight, wagon, pax) + агаар.
     Карт бүр `detail.chartPeriod` / `detail.airPeriod`-оос уншина; эс тэгвэл
     шүүлт солигдоход хугацаа өөрчлөгдөхгүй. */
  const idxP = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nPer = (idxP.match(/data-chart-period="1"/g) || []).length;
  /* 45 = rail freight 4 + wagon 4 + pax 5 + агаар 8 (донут ОУ/ОН, улсын жагсаалт, тээвэрлэгчийн зах зээл,
     ачааны жагсаалт, газрын зураг, treemap, сарын зорчигч, сарын ачаа) + трендийн карт 1
     + үзлэг 6 (нэгтгэл, газрын зураг, аймаг, 30 хоног, шалтгаан, гариг)
     + ачааны нэгтгэл 6 (7 хоногийн тайлан, 2 донут, 8 долоо хоног, тээвэрлэгч ×2 салаа)
     + нүүр 6 (w2p, w2c, t05, d05, i06, r06)
     + салбарын нэгтгэл 5 (7 хоногийн карт, 8 долоо хоног, сараар — хэмжүүр бүрт sc-for; эзлэх хувь, өмнөх оны мөн үе).
     + авто тээврийн зорчигч 10 (7 хоногийн тайлан, төрлийн донут, төрлийн карт (sc-for), сарын график,
     харьцаа, чиглэл, тээвэрлэгч, суваг, ангилал, ТХ). Бүрдлийг DG-P16 браузераар тулгана. */
  check('DG-P8. Хугацааны мөр: 22 + үзлэг 6 + ачааны нэгтгэл 6 + нүүр 6 + салбарын нэгтгэл 5 + авто зорчигч 10 = 55 карт', nPer === 55, 'n=' + nPer);
  check('DG-P8. Тус бүр өгөгдлөөс уншина (chartPeriod / airPeriod биндинг)',
    /chartPeriod:chartPeriodText\(m,T\)/.test(idxP) && /airPeriod:chartPeriodText\(/.test(idxP) &&
    /{{ detail.chartPeriod }}/.test(idxP) && /{{ detail.airPeriod }}/.test(idxP));

  /* DG-P9. Трендийн карт: c1d-ийн БОДИТ бичлэгтэй сарууд (0 = өгөгдөлгүй) → хүрээ нь
     эхний/сүүлийн бодит сараас; дутуу сар хасагдсан бол тэмдэглэгдэнэ. */
  const c1d=[0,5,6,0,7,0];
  const trendKeys=c1d.map((v,i)=>(v>0?'2026-'+String(i+1).padStart(2,'0'):null)).filter(Boolean);
  check('DG-P9. Тренд: 2026-02, 2026-03, 2026-05 бодит → «2026-02 — 2026-05 · 4 сар»',
    G.periodSpan(trendKeys,{}).text === 'Хугацаа: 2026-02 — 2026-05 · 4 сар', G.periodSpan(trendKeys,{}).text);
  check('DG-P9. Тренд: дутуу сар хасагдсан → «дутуу сар хасагдсан» (тоо зохиохгүй)',
    G.periodSpan(trendKeys,{dropped:true}).text === 'Хугацаа: 2026-02 — 2026-05 · 4 сар · дутуу сар хасагдсан');
  check('DG-P9. Тренд: цуваа хоосон → «мэдээлэл алга»',
    /мэдээлэл алга/.test(G.periodSpan([],{}).text));
  /* DG-P10. Агаарын картууд шүүлтийн сарын мужаар хязгаарлагдана (monthFrom..monthTo) */
  check('DG-P10. Агаар: periodKeys шүүлтийн сарын мужаар хязгаарлана',
    /\.filter\(\(_,i\)=>i\+1>=\(filters\.monthFrom\|\|1\)&&i\+1<=\(filters\.monthTo\|\|12\)\)/.test(idxP));
  check('DG-P10. Тренд картын хугацаа: detail.trendPeriod биндинг + c1dYear (агаар ч)',
    /trendPeriod:dsTrendPeriod/.test(idxP) && /{{ detail.trendPeriod }}/.test(idxP) && /SECTORS.air.c1dYear=year/.test(idxP));

  /* DG-P11. Олон дутуу сар (вагон: эх сурвалжийн цоорхой 2025-12 + одоогийн сар) —
     ганц «дутуу сар» гэвэл зөвхөн сүүлийн сар дутуу мэт уншигдана. */
  check('DG-P11. 2 дутуу сар → «2 дутуу сар»; огноотой бол «(сүүлийнх … хүртэл)»',
    G.periodSpan(['2025-12','2026-10'],{partialCount:2}).text === 'Хугацаа: 2025-12 — 2026-10 · 11 сар · 2 дутуу сар' &&
    G.periodSpan(['2025-12','2026-10'],{partialCount:2,partialTo:'2026-10-19'}).text === 'Хугацаа: 2025-12 — 2026-10 · 11 сар · 2 дутуу сар (сүүлийнх 2026-10-19 хүртэл)',
    G.periodSpan(['2025-12','2026-10'],{partialCount:2,partialTo:'2026-10-19'}).text);
  check('DG-P11. partialTo нь СҮҮЛИЙН дутуу сарынх (find биш filter().pop())',
    (idxP.match(/partialTo:\(ms\.filter\(m=>m\.partial\)\.pop\(\)\|\|\{\}\)\.last_date/g) || []).length === 3);
  /* DG-P12. Нэг хоногийн агшин (вагоны «Салбарын бүтэц») — сарын хүрээ биш */
  check('DG-P12. asOf → «Хугацаа: 2026-10-19 · сүүлийн бүрэн хоног»',
    G.periodSpan([],{asOf:'2026-10-19'}).text === 'Хугацаа: 2026-10-19 · сүүлийн бүрэн хоног');
  check('DG-P12. «Салбарын бүтэц» картын хугацаа rankPeriod-оос (агаар + вагоны _rankAsOf)',
    /{{ detail.rankPeriod }}/.test(idxP) && /SECTORS\.rail\._rankAsOf=w\.date/.test(idxP) && /rankPeriod:isAirDetail\?/.test(idxP));
  /* DG-P13. EMP: цуваагүй трендийн картыг утгатай картын хажууд зурахгүй */
  check('DG-P13. Хоосон трендийн карт нуугдана (showTrendCard), мөр нэг баганатай (data-solo)',
    /<sc-if value="{{ detail.showTrendCard }}">/.test(idxP) && /data-solo="{{ detail.trendRankSolo }}"/.test(idxP) &&
    /showTrendCard:dsHasTrend\|\|rankEmptyNow&&!paxChannelsNow/.test(idxP));

  /* DG-P14. Хоногийн муж (7 хоногийн тайлан, 30 хоногийн цуваа) — сарын хүрээ биш.
     2026-10-12..18 = 7 календарийн хоног; сарын зааг: 2026-09-21..10-19 = 29 хоног. */
  check('DG-P14. dayFrom/dayTo → «Хугацаа: 2026-10-12 — 2026-10-18 · 7 хоног»',
    G.periodSpan([], { dayFrom: '2026-10-12', dayTo: '2026-10-18' }).text === 'Хугацаа: 2026-10-12 — 2026-10-18 · 7 хоног',
    G.periodSpan([], { dayFrom: '2026-10-12', dayTo: '2026-10-18' }).text);
  check('DG-P14. Сарын зааг давсан муж: 2026-09-21 — 2026-10-19 = 29 хоног; урвуу дарааллыг эрэмбэлнэ',
    G.periodSpan([], { dayFrom: '2026-10-19', dayTo: '2026-09-21' }).count === 29 &&
    G.periodSpan([], { dayFrom: '2026-10-19', dayTo: '2026-09-21' }).from === '2026-09-21');
  check('DG-P14. Ганц хоног → «1 хоног»; эвдэрсэн огноо → «мэдээлэл алга» (зохиохгүй)',
    G.periodSpan([], { dayFrom: '2026-10-19', dayTo: '2026-10-19' }).text === 'Хугацаа: 2026-10-19 · 1 хоног' &&
    G.periodSpan([], { dayFrom: '2026-10', dayTo: 'x' }).text === 'Хугацаа: мэдээлэл алга');
  check('DG-P14. asOf-ийн үгийг солино (үзлэг: «хоногийн мэдээ» — бүрэн хоног гэж батлахгүй)',
    G.periodSpan([], { asOf: '2026-10-19', words: { day: 'хоногийн мэдээ' } }).text === 'Хугацаа: 2026-10-19 · хоногийн мэдээ');
  /* DG-P14. Долоо хоногийн цуваа (нүүрний 7 хоногийн график нэгтгэлтэй үед, салбарын нэгтгэлийн 8 долоо хоног):
     2026-08-24 (Да) — 2026-10-18 (Ня) = 8 долоо хоног — «56 хоног» биш */
  const cptM = idxP.match(/\nfunction chartPeriodText\(m,T\)\{([\s\S]*?)\n\}/);
  const CPT14 = cptM ? new Function('EHGlossary', 'm', 'T', cptM[1]) : null;
  const tW = (k, fb) => fb;
  check('DG-P14. chartPeriodText(nWeeks) → «Хугацаа: 2026-08-24 — 2026-10-18 · 8 долоо хоног»; nWeeks-гүй бол хоног хэвээр',
    !!CPT14 && CPT14(G, { dayFrom: '2026-08-24', dayTo: '2026-10-18', nWeeks: 8 }, tW) === 'Хугацаа: 2026-08-24 — 2026-10-18 · 8 долоо хоног' &&
    CPT14(G, { dayFrom: '2026-10-12', dayTo: '2026-10-18' }, tW) === 'Хугацаа: 2026-10-12 — 2026-10-18 · 7 хоног' &&
    CPT14(G, { dayFrom: '', dayTo: '2026-10-18', nWeeks: 8 }, tW) === 'Хугацаа: мэдээлэл алга',
    cptM ? CPT14(G, { dayFrom: '2026-08-24', dayTo: '2026-10-18', nWeeks: 8 }, tW) : 'chartPeriodText олдсонгүй');
  /* DG-P15. Шинэ картууд ӨӨРИЙН загвараас уншина (хатуу текст биш) */
  check('DG-P15. Үзлэг: аймаг/шалтгаан = шүүлтийн сарууд эсвэл СҮҮЛИЙН хоног; 30 хоног = byDay муж',
    /ri\.perAim=PM\?perMonths:perLatest/.test(idxP) && /ri\.perDaily=perDays/.test(idxP) &&
    /{{ detail\.ri\.perDaily }}/.test(idxP) && /{{ detail\.ri\.perAim }}/.test(idxP) && /{{ detail\.ri\.perPeriod }}/.test(idxP));
  check('DG-P15. Ачааны нэгтгэл: 7 хоног / оны эхнээс / 8 долоо хоног тус бүр өөрийн муж',
    /perWeek=chartPeriodText\(\{dayFrom:last\.week_start,dayTo:last\.week_end\}/.test(idxP) &&
    /{{ detail\.freightTotPerYtd }}/.test(idxP) && /{{ detail\.freightTotPerWeeks }}/.test(idxP));
  check('DG-P15. Нүүр: 7 хоног = lastFullWeekWindow(0) (нэгтгэлтэй бол долоо хоногийн цуваа), i06/r06 = compareWindow, t05 = зурсан цуваа',
    /const wWin=!stW&&realDaily\?this\.lastFullWeekWindow\(0\):null/.test(idxP) && /nWeeks:stW\.weeks\.length/.test(idxP) && /comparePeriod:chartPeriodText\(cw\.year\?/.test(idxP) &&
    /{{ weekPaxPeriod }}/.test(idxP) && /{{ trendPeriod }}/.test(idxP) && /{{ donut\.period }}/.test(idxP) &&
    (idxP.match(/{{ comparePeriod }}/g) || []).length === 2);
  check('DG-P15. Хугацаанаас чөлөөлсөн элемент бүр ШАЛТГААНтай (data-period-exempt="…")',
    (idxP.match(/data-period-exempt="[^"]{8,}"/g) || []).length === (idxP.match(/data-period-exempt=/g) || []).length);

  check('DG-P6. Текст overrides (words) — монгол үгийг орлуулж болно',
    G.periodSpan(['2024-01'], { words: { prefix: 'Period', months: 'mo' } }).text === 'Period: 2024-01 · 1 mo');

  /* DG2. Нэршлийн normalize: "Орон нутаг" = дотоод; латин/кирилл, зай, том жижиг */
  const K = G.airFlightKind;
  check('DG2. "ОН" / "Орон нутаг" / "орон нутаг " / "Дотоод" → dom',
    ['ОН', 'Орон нутаг', ' орон нутаг ', 'Дотоод', 'дотоодын', 'Domestic'].every(v => K(v) === 'dom'),
    JSON.stringify(['ОН', 'Орон нутаг', 'Дотоод'].map(K)));
  check('DG2. "ОУ" / "Олон улс" / латин "OУ" / "International" → intl',
    ['ОУ', 'Олон улс', 'олон улсын', 'OУ', 'International'].every(v => K(v) === 'intl'));
  check('DG2. Танигдаагүй утга ЧИМЭЭГҮЙ дотоод болохгүй → unknown',
    K('Тодорхойгүй') === 'unknown' && K('') === 'unknown' && K(null) === 'unknown');

  /* DG3. paxSplit: «Төрөл» шүүлтээс үл хамаарна — 3 мөр: ОУ 100 зорчигч, ОН 40, ОН 0 */
  const rows = [
    { ou: 'ОУ', pax: 100, month: 3, dir: '1', region: 'Ази' },
    { ou: 'ОН', pax: 40, month: 3, dir: '0', region: 'Ази' },
    { ou: 'ОН', pax: 0, month: 4, dir: '1', region: 'Ази' },
    { ou: '??', pax: 7, month: 4, dir: '1', region: 'Ази' }
  ];
  const sp = G.airPaxSplit(rows, { dir: 'all', region: 'all', monthFrom: 1, monthTo: 12 });
  check('DG3. paxSplit: ОУ 100 / ОН 40 (+0 зорчигчтай ОН нислэг тоологдоно)',
    sp.intl === 100 && sp.dom === 40 && sp.intlFlights === 1 && sp.domFlights === 2, JSON.stringify(sp));
  check('DG3. paxSplit: танигдаагүй 1 мөр unknown-д (хаягдсангүй, дотоодод нэмэгдсэнгүй)',
    sp.unknown === 7 && sp.unknownFlights === 1);
  const spDep = G.airPaxSplit(rows, { dir: 'dep', region: 'all', monthFrom: 1, monthTo: 12 });
  check('DG3. paxSplit: чиглэл/сарын шүүлт ҮЙЛЧИЛНЭ (dep → ОУ 100, ОН 0)',
    spDep.intl === 100 && spDep.dom === 0, JSON.stringify(spDep));

  /* DG4. Sanity: нийлбэр 100%, ганц ангилал, хоосон, танигдаагүй */
  const S = G.ratioSanity;
  const good = S([{ key: 'i', label: 'ОУ', value: 100 }, { key: 'd', label: 'Дотоод', value: 40 }], { expected: 2 });
  check('DG4. Хоёр ангилалтай → ok, нийлбэр 100%',
    good.ok && Math.abs(good.shares.reduce((t, x) => t + x.pct, 0) - 100) < 1e-9, JSON.stringify(good));
  const single = S([{ key: 'i', label: 'ОУ', value: 100 }, { key: 'd', label: 'Дотоод', value: 0 }], { expected: 2 });
  check('DG4. Ганц ангилал 100% → анхааруулга (single)', !single.ok && single.issues.some(i => i.code === 'single'));
  const empty = S([{ key: 'i', label: 'ОУ', value: 0 }, { key: 'd', label: 'Дотоод', value: 0 }], { expected: 2 });
  check('DG4. Нийт 0 → "empty" (100% донут зурахгүй)', !empty.ok && empty.issues[0].code === 'empty');
  const unk = S([{ key: 'i', label: 'ОУ', value: 5 }, { key: 'd', label: 'Дотоод', value: 5 }], { expected: 2, unknown: 3 });
  check('DG4. Танигдаагүй ангилал → "unknown" анхааруулга', unk.issues.some(i => i.code === 'unknown'));

  /* DG5. Дутуу сар: одоогийн сар = дуусаагүй (hardcode хийгээгүй) */
  const now = Date.UTC(2026, 9, 14, 6, 0, 0); // 2026-10-14 (УБ)
  check('DG5. isCurrentMonth: 2026-10 = одоогийн, 2026-09 = бүтэн',
    G.isCurrentMonth(2026, 10, now) === true && G.isCurrentMonth(2026, 9, now) === false &&
    G.isCurrentMonth(2025, 10, now) === false);

  /* DG6. Trend график: Y тэнхлэг 0-ээс, legend, дутуу цэгийн tooltip */
  const src = dcScript();
  const mt = src.match(/\nfunction buildTrendChart\(data,off(?:,partial(?:,noForecast)?)?\)\{([\s\S]*?)\n\}\n/);
  if (!mt) { bad('DG6. buildTrendChart() задарсангүй'); }
  else {
    const MONTHS = ['1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар', '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'];
    const mk = new Function('MONTHS', 'stxt', 'return function buildTrendChart(data,off,partial,noForecast){' + mt[1] + '}')(MONTHS, (p, x) => x);
    const d9 = [1343, 900, 1043, 1028, 1213, 1555, 1860, 1871, 1433];
    const withP = mk(d9, 0, 559), noP = mk(d9, 0);
    check('DG6. Y тэнхлэг 0-ээс эхэлнэ (дутуу сар 559 багтсан ч 500 биш)',
      withP.yTicks[0].label === '0' && noP.yTicks[0].label === '0',
      JSON.stringify(withP.yTicks.map(t => t.label)));
    check('DG6. Дутуу цэг: legend 3 (Бодит/Хэсэгчилсэн/Таамаг), байхгүй үед 2',
      withP.legend.length === 3 && withP.legend.map(l => l.key).join() === 'actual,partial,forecast' &&
      noP.legend.length === 2 && noP.legend.map(l => l.key).join() === 'actual,forecast',
      JSON.stringify(withP.legend));
    check('DG6. Дутуу цэгийн tooltip: "(1–N хүртэл): 559 · дутуу сар (хэсэгчилсэн)"',
      /\(1–\d+ хүртэл\): 559 · дутуу сар \(хэсэгчилсэн\)/.test(withP.partialLabel), withP.partialLabel);
    check('DG6. Графикийн богино шошго tooltip-ээс богино (баруун ирмэгт багтана)',
      withP.partialShort.length > 0 && withP.partialShort.length < withP.partialLabel.length, withP.partialShort);
    check('DG6. Таамаг ДУТУУ сараас эхлэхгүй: шугам 9 цэг, таамгийн эхлэл = сүүлийн бүтэн сар',
      withP.line.split('L').length === 9 && withP.fcSplitX === noP.fcSplitX, '');
  }

  /* DG7. Хуудасны бүтэц (статик): 2-р мөр 1-р мөртэй ИЖИЛ багана, нэгж хутгагдаагүй */
  const idx = read('index.html');
  const rowGrids = idx.match(/class="eh-trend-rank[^"]*" style="display:grid;grid-template-columns:([^;]+);/g) || [];
  const cols = rowGrids.map(g => g.match(/grid-template-columns:([^;]+);/)[1]);
  check('DG7. Агаарын хуудасны 2 мөр ижил column grid (1.5fr 1fr)',
    cols.length >= 2 && cols.every(c => c === '1.5fr 1fr'), JSON.stringify(cols));
  check('DG7. Тээвэрлэгчийн дэд мөр: зорчигч ба нислэг НЭРЭЭР (хувь = зорчигчийн)',
    /c\[1\]\.toLocaleString\('en-US'\)\+' '\+stxt\('chart\.legend_pax_word','зорчигч'\)\+' · '\+fmtCount\(byCarrierFlights/.test(idx));
  const con = readJson('content.json');
  check('DG7. Гарчигт хэмжигдэхүүн нэрлэгдсэн (зорчигчоор / ОУ нислэг)',
    /зорчигчоор/.test(con.widgets.dint.title) && /зорчигчоор/.test(con.widgets.dstr_air.title) && /ОУ нислэг/.test(con.widgets.dcty.title));
  check('DG7. content.json: "Орон нутаг" → "Дотоод (орон нутаг)" шошго',
    con.site.chart.domestic === 'Дотоод (орон нутаг)');
  check('DG7. Улсын жагсаалт ОУ нислэгээс (ОН нислэг "Тодорхойгүй" улс болж орохгүй)',
    /if\(f\.cntry && airFlightKind\(f\.ou\)==='intl'\)\{\s*byCountry\[f\.cntry\]/.test(idx));
  check('DG7. index.html домэйны толийг ачаална',
    idx.includes('<script src="js/erthub-glossary.js"></script>'));

  /* DG8. Нүүрний share/donut: ганц салбар 100% бол ил анхааруулга, «0.0%» биш «—» (регресс).
     d05 buildDonut-ыг гараар бодох фикстур дээр ажиллуулна: агаар 1000, төмөр зам 500. */
  const mD = idx.match(/\n  buildDonut\(activeKey\)\{([\s\S]*?)\n  \}\n  buildGlobe\(\)/);
  if (!mD) { bad('DG8. buildDonut() задарсангүй'); }
  else {
    const SEC = {
      air: { label: 'Агаар', kpis: [['x', '1,000']] },
      rail: { label: 'Төмөр зам', kpis: [['x', '500']] },
      road: { label: 'Авто зам', kpis: [['x', '9']] }
    };
    const NEON = { air: '#1', rail: '#2', road: '#3' };
    const mkD = new Function('SECTORS', 'NEON', 'stxt', 'EHGlossary',
      'return function(activeKey){' + mD[1] + '}')(SEC, NEON, (p, x) => x, G);
    const ctx = (live) => ({
      visibleSectorKeys: () => ['air', 'rail', 'road'],
      valueFromSpec: () => null,
      homeSectorPeriod: (k) => 'Хугацаа: ' + (k || 'мэдээлэл алга'),
      kpiVerified: (w, k) => live.includes(k)
    });
    const one = mkD.call(ctx(['air']), 'air');
    check('DG8. d05: ганц салбар (агаар) холбогдсон → 100% + ил тайлбар (нэр заасан)',
      one.arcs[0].pct === '100.0' && one.hasNote && /Агаар/.test(one.note) && /БИШ/.test(one.note), JSON.stringify(one.note));
    check('DG8. d05: холбогдоогүй салбар «0.0%» биш «—», tooltip «мэдээлэл алга»',
      one.arcs[1].pctText === '—' && one.arcs[2].pctText === '—' && /мэдээлэл алга/.test(one.arcs[1].tip) && one.arcs[0].pctText === '100.0%',
      JSON.stringify(one.arcs.map(a => [a.pctText, a.tip])));
    const two = mkD.call(ctx(['air', 'rail']), 'air');
    check('DG8. d05: хоёр салбар холбогдвол нийлбэр 100%, тайлбар ГАРАХГҮЙ',
      !two.hasNote && Math.abs(two.arcs.reduce((t, a) => t + parseFloat(a.pct), 0) - 100) < 0.11 && two.arcs[0].pctText === '66.7%',
      JSON.stringify(two.arcs.map(a => a.pct)));
    const none = mkD.call(ctx([]), 'air');
    check('DG8. d05: бүгд холбогдоогүй → «мэдээлэл алга» тайлбар, төв хувь «—» (100% зохиохгүй)',
      none.hasNote && /мэдээлэл алга/.test(none.note) && none.activePctLabel === '—' && none.arcs.every(a => a.pct === '0.0'),
      JSON.stringify(none));
  }
  check('DG8. 7 хоногийн донут/share: ratioSanity + холбогдоогүй сегмент «—», тайлбар хоёр картад (w2pb, w2cb)',
    /shareSanity=[\s\S]{0,90}EHGlossary\.ratioSanity/.test(idx) && /pctText:v>0\?/.test(idx) &&
    idx.includes('data-dg-note="weekPaxShare"') && idx.includes('data-dg-note="weekCargoShare"') &&
    idx.includes('weekPaxShareNote:wPax.shareNote') && idx.includes('weekCargoShareNote:wCargo.shareNote'));
  check('DG8. content.json: status.share_single («{name}»), status.share_empty бүртгэлтэй',
    /\{name\}/.test(con.site.status.share_single || '') && !!con.site.status.share_empty);
}

/* ──────────────────────────────── FL ШҮҮЛТИЙН СТАНДАРТ ──────────────────────────────── */
/* FL. Шүүлтийн баганы утгыг датаас авна (стандартчлахгүй). Лавлагаа: агаарын хүснэгт.
   FL1–FL10 нь туслах функц ба статик холболт; FL11–FL12 нь датасэт БҮРИЙН
   бодит шүүлтийн UI-г хөтчөөр, фикстурын өгөгдөлтэй АВТОМАТ шалгана. */
async function groupFL() {
  group('FL. Шүүлтийн стандарт (датаас утга)');
  let G = null;
  try { G = require(path.join(ROOT, 'js', 'erthub-glossary.js')); } catch (e) { /* доор bad */ }
  check('FL1. erthub-glossary: filterDimensions, missingFilterCols байна',
    !!G && typeof G.filterDimensions === 'function' && typeof G.missingFilterCols === 'function');
  if (!G) return;

  const rows = [
    { type: 'ОУ', dir: 'arr', region: 'Европ' },
    { type: ' ОУ ', dir: 'dep', region: 'Европ' },
    { type: 'ОН', dir: 'dep', region: '' },
    { type: '', dir: 'arr', region: null },
  ];
  const d = G.filterDimensions(rows, ['type', 'dir', 'region']);
  check('FL2. Утгыг датаас авч trim + давхардал/хоосыг хасна',
    JSON.stringify(d.type) === JSON.stringify(['ОН', 'ОУ']), JSON.stringify(d.type));
  check('FL3. Багана бүр бие даасан (dir, region)',
    JSON.stringify(d.dir) === JSON.stringify(['arr', 'dep']) && JSON.stringify(d.region) === JSON.stringify(['Европ']),
    JSON.stringify(d));
  check('FL4. Утгыг стандартчлахгүй (ОН хэвээр, "Орон нутаг" болгохгүй)',
    d.type.indexOf('ОН') !== -1 && d.type.indexOf('Орон нутаг') === -1);
  check('FL5. missingFilterCols стандарт багана дутуу бол тэдгээрийг буцаана',
    JSON.stringify(G.missingFilterCols(['type', 'dir'], ['type', 'dir', 'region'])) === JSON.stringify(['region']));
  check('FL6. Бүх багана байвал дутуу жагсаалт хоосон',
    G.missingFilterCols(['type', 'dir', 'region'], ['type', 'dir']).length === 0);

  /* FL7–FL9. DS_SCHEMA-ийн массив мөр дээр шүүлтийн багана сонгох (гараар бодох фикстур).
     Багана: 0 Станц (мөр бүр өвөрмөц → ID, шүүлт БИШ) · 1 Төрөл (2 утга) · 2 Тоо (int)
     · 3 Ангилал (enum) · 4 Төлөв (сүүлийн, "ok:Хэвийн" → харагдах шошгоор шүүнэ). */
  const head = ['Станц', 'Төрөл', 'Тоо', 'Ангилал', 'Төлөв'];
  const types = ['string', 'string', 'int', 'enum', 'enum'];
  const arows = [
    ['А', 'ачаа', 5, 'x', 'ok:Хэвийн'],
    ['Б', 'ачаа', 3, 'y', 'warn:Анхаарах'],
    ['В', 'зорчигч', 7, 'x', 'ok:Хэвийн'],
    ['Г', ' зорчигч ', 1, 'x', 'ok:Хэвийн'],
  ];
  const fc = G.filterColumns(head, types, arows);
  check('FL7. filterColumns: Төрөл, Ангилал, Төлөв сонгогдоно (ID ба тоо ОРОХГҮЙ)',
    JSON.stringify(fc.map(c => c.index)) === '[1,3,4]', JSON.stringify(fc));
  check('FL7. Төлөвийн утга нь харагдах шошго ("ok:" угтваргүй)',
    JSON.stringify(fc[2] && fc[2].values) === JSON.stringify(['Анхаарах', 'Хэвийн']), JSON.stringify(fc[2]));
  check('FL7. Утгууд датаас (trim, давхардалгүй)',
    JSON.stringify(fc[0] && fc[0].values) === JSON.stringify(['ачаа', 'зорчигч']), JSON.stringify(fc[0]));
  check('FL8. exclude: нэгдсэн шүүлт шүүдэг баганыг хасна',
    JSON.stringify(G.filterColumns(head, types, arows, { exclude: ['Төрөл', 'Төлөв'] }).map(c => c.index)) === '[3]');
  check('FL8. maxDistinct-ээс олон утгатай string багана (чөлөөт текст) орохгүй',
    G.filterColumns(head, types, arows, { maxDistinct: 1 }).every(c => c.index !== 1));
  check('FL8. counts: утга бүрийн мөрийн тоо (ачаа 2, зорчигч 2 — trim-тэй)',
    fc[0] && fc[0].counts['ачаа'] === 2 && fc[0].counts['зорчигч'] === 2, JSON.stringify(fc[0] && fc[0].counts));
  check('FL8. Хоосон мөр → шүүлтийн багана алга',
    G.filterColumns(head, types, []).length === 0);
  const pick = sel => arows.filter(r => G.rowMatchesCols(r, sel)).map(r => r[0]).join('');
  check('FL9. rowMatchesCols: Төрөл=зорчигч → В, Г (trim-тэй таарна)', pick({ 1: 'зорчигч' }) === 'ВГ', pick({ 1: 'зорчигч' }));
  check('FL9. Хоёр баганы AND: зорчигч + x → В, Г; ачаа + x → А', pick({ 1: 'зорчигч', 3: 'x' }) === 'ВГ' && pick({ 1: 'ачаа', 3: 'x' }) === 'А');
  check('FL9. Төлөвийн шошгоор: Анхаарах → Б', pick({ 4: 'Анхаарах' }) === 'Б', pick({ 4: 'Анхаарах' }));
  check('FL9. Хоосон сонголт ("Бүгд") → бүх мөр', pick({}) === 'АБВГ' && pick({ 1: '' }) === 'АБВГ');

  /* FL10. index.html-ийн хүснэгт шүүлтийг ҮНЭХЭЭР ашиглана (статик) */
  const src = dcScript();
  const bp = (src.match(/\n  buildPreview\(dsel,dsRows\)\{([\s\S]*?)\n  \}\n/) || [])[1] || '';
  check('FL10. buildPreview: filterColumns-оор датаас багана гаргана', /\b(EHGlossary|G)\.filterColumns\(/.test(bp));
  check('FL10. buildPreview: мөрийг rowMatchesCols-оор шүүнэ', /EHGlossary\.rowMatchesCols\(/.test(bp));
  check('FL10. Кэшийн түлхүүрт баганын сонголт орно (эс тэгвэл шүүлт солиход хүснэгт хуучнаараа)',
    /cacheKey=[^;]*colSel/.test(bp), (bp.match(/const cacheKey=[^;]*;/) || [''])[0]);
  check('FL10. Темплейт: хүснэгтийн шүүлтэд баганын chip-ийн мөр', /detail\.pvColFilters/.test(read('index.html')));

  /* FL13–FL17. FL дүрэм 3 — баганын шүүлт KPI/графикийг ХАМТ өөрчилнө (2026-10-16,
     хэрэглэгчийн шийдвэр: БҮХ датасэт). Датасэт бүр шүүлтийг ӨӨРИЙН хэмжээсээрээ
     дагана: агаар — нислэг, зорчигч — сар, вагон — станц, үзлэг — аймаг. */
  const fxs = re => (src.match(re) || [])[1];
  /* FL13. Агаарын нислэгийн предикат — хүснэгтийн нүдийг бүтээдэг accessor-оор.
     Фикстур: 3 нислэг; багана 0 Компани, 1 Огноо, 2 Төлөв (сүүлийн = flightType). */
  const afcB = fxs(/\nfunction airFlightColMatch\(sel,cols\)\{([\s\S]*?)\n\}/);
  if (!afcB) bad('FL13. airFlightColMatch() олдсонгүй');
  else {
    const AFC = new Function('sel', 'cols', afcB);
    const cols = [['Компани', 'string', '', f => f.carr], ['Огноо', 'date', '', (f, d) => d], ['Төлөв', 'enum', '', null]];
    const fl = [{ carr: 'МИАТ', year: 2026, month: 1, day: 5, pax: 100, flightType: 'Тогтмол' },
      { carr: ' МИАТ ', year: 2026, month: 2, day: 1, pax: 40, flightType: 'Захиалгат' },
      { carr: 'Хүннү', year: 2026, month: 1, day: 9, pax: 60 }];
    const paxOf = sel => { const p = AFC(sel, cols); return (p ? fl.filter(p) : fl).reduce((t, f) => t + f.pax, 0); };
    check('FL13. Сонголтгүй → предикат null (бүх нислэг, зорчигч 200)', AFC({}, cols) === null && paxOf({}) === 200);
    check('FL13. Компани=МИАТ → 100+40=140 зорчигч (trim-тэй таарна)', paxOf({ 0: 'МИАТ' }) === 140, String(paxOf({ 0: 'МИАТ' })));
    check('FL13. Огноо accessor (f,dateStr) → 2026-01-09 = 60', paxOf({ 1: '2026-01-09' }) === 60, String(paxOf({ 1: '2026-01-09' })));
    check('FL13. Төлөв (сүүлийн) = нислэгийн төрөл, хоосон бол "Тогтмол": Тогтмол → 100+60', paxOf({ 2: 'Тогтмол' }) === 160);
    check('FL13. AND: МИАТ + Захиалгат → 40', paxOf({ 0: 'МИАТ', 2: 'Захиалгат' }) === 40);
  }
  /* FL14. Зорчигч — mr.keys (сарын олонлог) → KPI ба цуваа ХАМТ өөрчлөгдөнө.
     Гараар: 2026-01 100 (бүтэн), 2026-02 50 (дутуу, 5/28 өдөр). */
  const pamB = fxs(/function paxAnalysisModel\(all,sel,year,mr\)\{([\s\S]*?)\n\}/);
  const psgB = fxs(/\nfunction paxSeriesWithGaps\(ms,fullRange\)\{([\s\S]*?)\n\}/);
  if (!pamB || !psgB) bad('FL14. paxAnalysisModel/paxSeriesWithGaps олдсонгүй');
  else {
    const PSG = new Function('ms', 'fullRange', psgB);
    const ycFL = fxs(/\nfunction yoyCompare\(months,yr,mFrom,mTo,key\)\{([\s\S]*?)\n\}/);
    const YCF = new Function('months', 'yr', 'mFrom', 'mTo', 'key', ycFL || 'throw new Error("yoyCompare алга")');
    const PA = (all, year, mr) => new Function('paxSeriesWithGaps', 'yoyCompare', 'all', 'sel', 'year', 'mr', pamB)(PSG, YCF, all, null, year, mr);
    const ALL = { status: 'ok', months: [
      { month: '2026-01', days: 31, days_in_month: 31, trips: 10, passengers: 100, domestic: 80, international: 20 },
      { month: '2026-02', days: 5, days_in_month: 28, trips: 4, passengers: 50, domestic: 50, international: 0 }] };
    const a = PA(ALL, 'all', null), k = PA(ALL, 'all', { from: 1, to: 12, keys: new Set(['2026-01']) });
    check('FL14. Шүүлтгүй: зорчигч 150, цуваа 2 сар', a.pax === 150 && a.series.labels.length === 2, JSON.stringify([a.pax, a.series.labels]));
    check('FL14. keys={2026-01}: KPI 100, ОУ 20%, цуваа 1 сар (26-01)',
      k.hasData && k.pax === 100 && Math.abs(k.intlPct - 20) < 1e-9 && k.series.labels.join(',') === '26-01',
      JSON.stringify([k.pax, k.intlPct, k.series.labels]));
    const k2 = PA(ALL, 'all', { from: 1, to: 12, keys: new Set(['2026-02']) });
    check('FL14. keys={2026-02} (Дутуу сар): KPI 50, дутуу 1', k2.pax === 50 && k2.partialN === 1);
    check('FL14. Таарах сар алга → hasData:false (тоо зохиохгүй)', PA(ALL, 'all', { keys: new Set(['1999-01']) }).hasData === false);
  }
  /* FL15. Вагон — mr.keys (станцын олонлог) → станцын жагсаалт ба нийлбэр. */
  const wamB = fxs(/function wagonAnalysisModel\(all,sel,year,mr\)\{([\s\S]*?)\n\}/);
  if (!wamB) bad('FL15. wagonAnalysisModel олдсонгүй');
  else {
    const ycFL2 = fxs(/\nfunction yoyCompare\(months,yr,mFrom,mTo,key\)\{([\s\S]*?)\n\}/);
    const WA = new Function('yoyCompare', 'all', 'sel', 'year', 'mr', wamB)
      .bind(null, new Function('months', 'yr', 'mFrom', 'mTo', 'key', ycFL2 || 'throw new Error("yoyCompare алга")'));
    const ALL = { status: 'ok', months: [{ month: '2026-01', loaded: 500, unloaded: 360, loaded_domestic: 200, loaded_foreign: 300, days: 31 }],
      by_station: [{ station: 'A', loaded: 300, unloaded: 200 }, { station: 'B', loaded: 200, unloaded: 160 }, { station: 'C', loaded: 0, unloaded: 9 }] };
    const a = WA(ALL, null, 'all', null), k = WA(ALL, null, 'all', { from: 1, to: 12, keys: new Set(['C']) });
    check('FL15. Шүүлтгүй: 3 станц, нийт ачилт 500', a.stations.length === 3 && a.stationTotal === 500);
    check('FL15. keys={C} (Зөвхөн буулгалт): 1 станц, ачилт 0', k.stations.length === 1 && k.stations[0].station === 'C' && k.stationTotal === 0,
      JSON.stringify(k.stations));
  }
  /* FL16. Wiring (статик): агаар KPI/график шүүлттэй мөрөөс, хүснэгт нэгдсэн шүүлтийн мөрөөс
     (эс тэгвэл chip-ийн утгууд өөрөө агшиж, «Бүгд» рүү буцах боломжгүй болно). */
  const arf = fxs(/\n  applyRealFlightsData\(flights,prevFlights,year,filters\)\{([\s\S]*?)\n  \}\n/) || '';
  check('FL16. applyRealFlightsData: airFlightColMatch-аар нислэгийг шүүнэ', /airFlightColMatch\(/.test(arf));
  check('FL16. Хүснэгтийн мөр (sortedFull) нэгдсэн шүүлтийн мөрөөс (filteredU)', /sortedFull=filteredU\./.test(arf));
  /* Регресс (browser-оор илэрсэн): «НИЙТ НИСЛЭГ» нь өөрийн сарын цонхтой (flTypeFilter) тул
     МИАТ сонгоход бусад KPI өөрчлөгдөөд энэ карт 56 хэвээр үлдэж байв. */
  check('FL16. «НИЙТ НИСЛЭГ»-ийн flTypeFilter ч баганын шүүлтийг (colMatch) шалгана',
    /const flTypeFilter=\(f\)=>\{[\s\S]*?colMatch[\s\S]*?return true;/.test(arf));
  check('FL16. Өмнөх оны харьцуулалт (prevAllFiltered) ч баганын шүүлттэй', /prevAllFiltered=[^;]*colMatch/.test(arf));
  const spc = fxs(/\n  setPvColFilter\(schemaKey,ci,v\)\{([\s\S]*?)\n  \}\n/) || '';
  check('FL16. setPvColFilter: агаар дээр recomputeAirData дуудна', /recomputeAirData\(\)/.test(spc));
  const bpv = fxs(/\n  buildPaxAnalysis\(\)\{([\s\S]*?)\n  \}\n/) || '', bwa = fxs(/\n  buildWagonAnalysis\(\)\{([\s\S]*?)\n  \}\n/) || '';
  const bri = fxs(/\n  buildRoadInspectExtra\(\)\{([\s\S]*?)\n  \}\n/) || '';
  check('FL16. Зорчигч/вагон/үзлэгийн анализ pvColScope-ийн keys-ийг ашиглана',
    /pvColScope\(/.test(bpv) && /keys/.test(bpv) && /pvColScope\(/.test(bwa) && /pvColScope\(/.test(bri));
  /* FL17. Идэвхтэй шүүлтийн мөр — текст content.json-д, темплейтэд */
  const con = readJson('content.json'), ps = (con.site || {}).pv_scope || {};
  const need = ['label', 'clear', 'note_air', 'note_rail_pax', 'note_rail_wagon', 'note_road_inspect', 'note_default'];
  check('FL17. content.json site.pv_scope бүртгэлтэй', need.every(k => typeof ps[k] === 'string' && ps[k].length), need.filter(k => !ps[k]).join(','));
  check('FL17. Темплейт: detail.pvScope мөр (цэвэрлэх товчтой)', /detail\.pvScope\.active/.test(read('index.html')) && /detail\.pvScope\.clear\b/.test(read('index.html')));
  /* FL18. Үзлэгийн нэгдсэн шүүлт (riF) нээгдэхэд хүснэгтийн самбар нуугддаг
     (tableFilterOpen) — баганын шүүлтийн мөрүүд riF самбарт гарах ёстой
     (өмнө нь «Төлөв» багана шүүлтгүй үлддэг байв). «Төлөв» багана шүүлтэд
     гарсан бол riF-ийн давхар төлөвийн мөр нуугдана. */
  {
    const idx18 = read('index.html');
    const a = idx18.indexOf('<div data-ri-filter="1"'), b = idx18.indexOf('<sc-if value="{{ detail.ri.period.show }}">');
    const riPanel = a >= 0 && b > a ? idx18.slice(a, b) : '';
    check('FL18. riF самбарт баганын шүүлтийн мөр (detail.pvColFilters + data-fl-col)',
      /<sc-for list="\{\{ detail\.pvColFilters \}\}"/.test(riPanel) && riPanel.includes('data-fl-col="{{ cf.name }}"'));
    check('FL18. riF-ийн төлөвийн мөр «Төлөв» баганын шүүлттэй давхардахгүй (riStatusRow)',
      riPanel.includes('<sc-if value="{{ detail.riStatusRow }}">') &&
      dcScript().includes("riStatusRow:sf!=='all'||!fCols.some(c=>c.index===sc.head.length-1)"));
  }

  /* FL19–FL24. Шүүлтийн ХЭЛБЭР + серверийн facet (2026-10-20 хэрэглэгч: «нэгтгэлийн
     хүснэгтэд шинэ Тээвэрлэгч багана шүүлтэд алга; ачааг min–max-аар; олон утгатай
     текстийг бичиж сонгох»). Шалтгаан: шүүлтийн сонголтыг ачаалсан сүүлийн 5,000
     мөрөөс (148,196-аас) гаргадаг байсан — МТЗ (сүүлийн бичлэг 2026-02-01) тэр
     цонхонд ороогүй тул багана 1 утгатай болж шүүлтээс хасагдаж байв.
     Гараар бодох фикстур: 5 мөр, багана 0 Огноо, 1 Код, 2 Нэр (Код-той 1:1),
     3 Өртөө (14 утга, 16 мөр → хайлт), 4 Тонн (float), 5 ID. */
  {
    const st = ['А1', 'Б2', 'В3', 'Г4', 'Д5', 'Е6', 'Ж7', 'З8', 'И9', 'К10', 'Л11', 'М12', 'Н13', 'О14'];
    const head = ['Огноо', 'Код', 'Нэр', 'Өртөө', 'Тонн', 'ID'];
    const types = ['date', 'string', 'string', 'string', 'float', 'string'];
    const rows = st.map((s, i) => ['2026-10-0' + (1 + i % 9), i < 10 ? 'УБТЗ' : 'МТЗ', i < 10 ? 'Улаанбаатар' : 'Монгол', s, i * 10, 'id' + i, '']);
    /* Өртөө давтагдана (ID биш): А1, Б2 хоёр дахь удаа (УБТЗ, 5 ба 15 тонн) */
    rows.push(['2026-10-01', 'УБТЗ', 'Улаанбаатар', 'А1', 5, 'idx1', ''], ['2026-10-02', 'УБТЗ', 'Улаанбаатар', 'Б2', 15, 'idx2', '']);
    const fc = G.filterColumns(head, types, rows, { ranges: true, dedupe: true, chipMax: 12 });
    check('FL19. Хэлбэр: Код → chips (2 утга), Өртөө → search (14 > 12), Тонн → range; ID ба огноо орохгүй',
      JSON.stringify(fc.map(c => [c.name, c.kind])) === JSON.stringify([['Код', 'chips'], ['Өртөө', 'search'], ['Тонн', 'range']]),
      JSON.stringify(fc.map(c => [c.name, c.kind])));
    check('FL19. dedupe: Нэр нь Кодтой ижил хуваалттай (12/4) → нэг шүүлт; dedupe-гүй бол хоёулаа',
      !fc.some(c => c.name === 'Нэр') && G.filterColumns(head, types, rows).some(c => c.name === 'Нэр'));
    const tr = fc.find(c => c.kind === 'range');
    check('FL19. range: мин 0, макс 130 (датаас)', tr && tr.min === 0 && tr.max === 130, JSON.stringify(tr));
    check('FL19. ranges-гүй (анхдагч) бол тоон багана шүүлтэд орохгүй (FL7-ийн гэрээ)',
      !G.filterColumns(head, types, rows).some(c => c.kind === 'range'));
    /* FL20. Серверийн facet: ачаалсан мөрөнд МТЗ АЛГА ч facet-д байвал сонголтод гарна */
    const loaded = rows.slice(0, 10).concat(rows.slice(14));
    check('FL20. facet-гүй: ачаалсан мөр зөвхөн УБТЗ → Код шүүлтээс хасагдана (засварын өмнөх алдаа)',
      !G.filterColumns(head, types, loaded).some(c => c.name === 'Код'));
    const fz = { code: { kind: 'cat', values: [['УБТЗ', 140000], ['МТЗ', 8000]] }, name: { kind: 'cat', values: [['Улаанбаатар', 140000], ['Монгол', 8000]] },
      ton: { kind: 'range', min: 0, max: 6311.1 } };
    const ff = G.filterColumns(head, types, loaded, { facets: fz, keys: ['record_date', 'code', 'name', 'station', 'ton', 'id'], ranges: true, dedupe: true });
    const fcode = ff.find(c => c.name === 'Код');
    check('FL20. facet-тэй: Код = [МТЗ, УБТЗ], тоо нь бүтэн датаас (8000 / 140000)',
      fcode && JSON.stringify(fcode.values) === '["МТЗ","УБТЗ"]' && fcode.counts['МТЗ'] === 8000, JSON.stringify(fcode));
    check('FL20. facet-тэй: Тонн хүрээ серверийнх (0–6311.1); facet-гүй багана (Өртөө, ID) орохгүй',
      ff.some(c => c.kind === 'range' && c.max === 6311.1) && !ff.some(c => c.name === 'Өртөө' || c.name === 'ID') && !ff.some(c => c.name === 'Нэр'),
      JSON.stringify(ff.map(c => c.name)));
    /* FL21. condMatch — сервертэй ижил дүрэм */
    const pick = sel => rows.filter(r => G.rowMatchesCols(r, sel)).map(r => r[3]).join(',');
    check('FL21. {in:[МТЗ]} → Л11..О14', pick({ 1: { in: ['МТЗ'] } }) === 'Л11,М12,Н13,О14', pick({ 1: { in: ['МТЗ'] } }));
    check('FL21. {in:[А1, Д5]} (олныг сонгох) → А1,Д5,А1', pick({ 3: { in: ['А1', 'Д5'] } }) === 'А1,Д5,А1');
    check('FL21. {min:100} → Л11..О14 (хил оролцоно: Л11 = 100)', pick({ 4: { min: 100 } }) === 'Л11,М12,Н13,О14');
    check('FL21. {min:"20", max:"40"} (бичсэн текст) → В3,Г4,Д5', pick({ 4: { min: '20', max: '40' } }) === 'В3,Г4,Д5');
    check('FL21. Хүрээ + ангилал AND: МТЗ ба ≤ 105 → Л11', pick({ 1: { in: ['МТЗ'] }, 4: { max: 105 } }) === 'Л11');
    check('FL21. Хоосон cond ({in:[]}, {min:""}) = шүүлтгүй', pick({ 1: { in: [] }, 4: { min: '' } }).split(',').length === 16 &&
      !G.condActive({ in: [] }) && !G.condActive({ min: '' }) && G.condActive({ max: 0 }));
    check('FL21. Тоо биш нүд хүрээнд таарахгүй; «1,234» мянгатын тусгаарлагчтай уншигдана',
      !G.condMatch('', { min: 0 }) && !G.condMatch('abc', { max: 5 }) && G.condMatch('1,234', { min: 1000, max: 1234 }));
    /* FL22. Хайлтын санал */
    const sg = G.facetSuggest(['Дархан-I', 'Сайндархан', 'Дархан-II', 'Эрдэнэт'], { 'Дархан-I': 5, 'Сайндархан': 50, 'Дархан-II': 9, 'Эрдэнэт': 1 }, 'дар', ['Дархан-II'], 8);
    check('FL22. facetSuggest: жижиг үсгээр, эхлэлээр таарсан нь түрүүнд, сонгосныг хасна',
      JSON.stringify(sg.list) === '["Дархан-I","Сайндархан"]' && sg.total === 2, JSON.stringify(sg));
    check('FL22. Хоосон текст → мөрийн тоогоор буурах «top values»',
      JSON.stringify(G.facetSuggest(['а', 'б', 'в'], { а: 1, б: 3, в: 2 }, '', [], 2).list) === '["б","в"]');
  }
  /* FL23. Серверийн query (index.html dsSrvParams) — тогтвортой дараалал, кодлогдсон */
  {
    const m = dcScript().match(/\nfunction dsSrvParams\(sel\)\{([\s\S]*?)\n\}/);
    if (!m) bad('FL23. dsSrvParams() олдсонгүй');
    else {
      const P = new Function('sel', m[1]);
      check('FL23. in (эрэмбэлж, кодлож) + min/max; хоосон/хуучин хэлбэр алгасна',
        P({ org_code: { in: ['УБТЗ', 'МТЗ'] }, export_tonnes: { min: '10', max: '' }, x: 'хуучин', y: { in: [] } }) ===
          'min.export_tonnes=10&in.org_code=' + encodeURIComponent('МТЗ') + '&in.org_code=' + encodeURIComponent('УБТЗ'),
        P({ org_code: { in: ['УБТЗ', 'МТЗ'] }, export_tonnes: { min: '10', max: '' } }));
      check('FL23. Сонголтгүй → хоосон (серверийн шүүлтгүй хүсэлт)', P({}) === '' && P(null) === '');
    }
    const src = dcScript();
    check('FL24. dsRawSchema: facet дэмждэг үед л серверийн шүүлт, бичих явцад 350мс хүлээнэ',
      /const ps=fz\[wk\]\?dsSrvParams\(/.test(src) && /setTimeout\(\(\)=>\{ this\._dsRowsPend=null;/.test(src));
    check('FL24. Сонголтын түлхүүр — түүхий мөрөнд баганын ТҮЛХҮҮР (шүүсэн хариунд индекс шилждэг)',
      src.includes("const colId=ci=>sc.raw&&sc.keys?sc.keys[ci]:String(ci);"));
  }
  await groupFLCoverage(G);
  await groupFLFacetLive();
}

/* FL25. Регресс — ЯГ хэрэглэгчийн гүйлгээ, жинхэнэ хөтчөөр (?fx=1): нэгтгэлийн
   хүснэгтийн эхний хуудас (50 мөр, таслагдсан) зөвхөн УБТЗ. «Тээвэрлэгч» шүүлтэд
   МТЗ гарч, сонгоход серверээс МТЗ-ийн мөр ирнэ; «Дотоод (тонн)» доод 1300 →
   зөвхөн МТЗ (1322 / 1388.1); «Ачааны нэр» нь chip-ийн хана биш бичиж хайх. */
async function groupFLFacetLive() {
  if (!CHROME) { skipped('FL25 серверийн facet шүүлт (хөтөч)', 'Chrome олдсонгүй'); return; }
  const ds = flDatasets(read('index.html'));
  const it = ds.find((d) => d.schemaKey === 'rail_freight_all');
  if (!it) { bad('FL25. rail_freight_all датасэт олдсонгүй'); return; }
  const probe = async function (d, w, slug) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = f(); if (v) return v; await sleep(150); } return null; };
    w.location.hash = '#/browse/' + slug;
    const table = () => d.querySelector('[data-eh-table]');
    const body = () => { const t = table(); return t && t.children[1] ? [...t.children[1].children] : []; };
    const head = () => [...table().children[0].querySelectorAll('button')].map((b) => b.textContent.replace(/[↑↓]/g, '').trim());
    if (!await until(() => body().length > 0 && head().includes('Тээвэрлэгч'), 20000)) return { __err: 'хүснэгт зурагдсангүй' };
    const fb = [...d.querySelectorAll('button')].find((b) => b.textContent.includes('▽'));
    if (fb) fb.click();
    if (!await until(() => d.querySelector('[data-fl-col="Тээвэрлэгч"]'), 8000)) return { __err: 'Тээвэрлэгч шүүлт алга', cols: [...d.querySelectorAll('[data-fl-col]')].map((e) => e.getAttribute('data-fl-col')) };
    const oi = head().indexOf('Тээвэрлэгч');
    const orgs = () => body().map((r) => r.children[oi] && r.children[oi].textContent.trim());
    const out = { cols: [...d.querySelectorAll('[data-fl-col]')].map((e) => e.getAttribute('data-fl-col')) };
    out.firstMtz = orgs().filter((x) => x === 'МТЗ').length;
    out.firstN = body().length;
    out.chips = [...d.querySelectorAll('[data-fl-col="Тээвэрлэгч"] button')].map((b) => b.textContent.trim());
    out.cargoSearch = !!d.querySelector('[data-fl-col="Ачааны нэр"] input[data-fl-search]');
    [...d.querySelectorAll('[data-fl-col="Тээвэрлэгч"] button')].find((b) => /^МТЗ/.test(b.textContent.trim())).click();
    await until(() => body().length && orgs().every((x) => x === 'МТЗ'), 6000);
    out.afterMtz = orgs();
    d.querySelector('[data-fl-clear]').click();
    await until(() => orgs().some((x) => x === 'УБТЗ'), 6000);
    /* 8 тоон багана > PV_RANGE_TOP (6) — эхлээд нуугдсан хэсэг */
    out.rangeHidden = !d.querySelector('[data-fl-min="Дотоод (тонн)"]');
    const more = d.querySelector('[data-fl-range-more]');
    if (more) { more.click(); await sleep(300); }
    const inp = d.querySelector('[data-fl-min="Дотоод (тонн)"]');
    out.hasRange = !!inp;
    if (inp) {
      inp.value = '1300'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      const ti = head().indexOf('Дотоод (тонн)');
      await until(() => body().length && orgs().every((x) => x === 'МТЗ'), 6000);
      out.afterRange = body().map((r) => r.children[ti].textContent.trim());
      d.querySelector('[data-fl-clear]').click();
      await sleep(400);
    }
    const s = d.querySelector('[data-fl-col="Ачааны нэр"] input[data-fl-search]');
    if (s) {
      s.value = 'цем'; s.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(400);
      const sug = [...d.querySelectorAll('[data-fl-col="Ачааны нэр"] button')].find((b) => /^Цемент/.test(b.textContent.trim()));
      out.sugg = !!sug;
      if (sug) {
        sug.click();
        const ci = head().indexOf('Ачааны нэр');
        await until(() => body().length && body().every((r) => r.children[ci].textContent.trim() === 'Цемент'), 6000);
        out.afterCargo = [...new Set(body().map((r) => r.children[ci].textContent.trim()))];
      }
    }
    return out;
  };
  const srv = serve();
  const prevSrc = PROBE_SRC;
  PROBE_SRC = '/index.html?fx=1';
  let R;
  try {
    R = await runProbe('async function(d,w){return (' + probe.toString() + ')(d,w,' + JSON.stringify(it.slug) + ');}', 60000);
  } finally { PROBE_SRC = prevSrc; srv.close(); }
  if (!R || R.__err) { bad('FL25. Серверийн facet шүүлтийн probe', JSON.stringify(R)); return; }
  check('FL25. Эхний хуудас (таслагдсан) МТЗ-гүй ч «Тээвэрлэгч» шүүлтэд МТЗ гарна (facet бүтэн датаас)',
    R.firstMtz === 0 && R.firstN > 0 && R.chips.some((c) => /^МТЗ/.test(c)) && R.chips.some((c) => /^УБТЗ/.test(c)), JSON.stringify(R));
  check('FL25. Давхар багана (Тээвэрлэгчийн нэр, Байгууллага) тусдаа шүүлт болохгүй',
    !R.cols.includes('Тээвэрлэгчийн нэр') && !R.cols.includes('Байгууллага'), JSON.stringify(R.cols));
  check('FL25. МТЗ сонгоход серверээс зөвхөн МТЗ-ийн мөр (8) ирнэ',
    R.afterMtz.length === 8 && R.afterMtz.every((x) => x === 'МТЗ'), JSON.stringify(R.afterMtz));
  check('FL25. Тоон хүрээ 6-аас олон бол товчилно («+N бусад»-аар дэлгэнэ)', R.rangeHidden === true && R.hasRange === true);
  check('FL25. «Дотоод (тонн)» доод 1300 → зөвхөн 1,322 / 1,388.1 (МТЗ)',
    R.hasRange && R.afterRange.length === 8 && R.afterRange.every((v) => v === '1,322' || v === '1,388.1'), JSON.stringify(R.afterRange));
  check('FL25. «Ачааны нэр» бичиж хайх: «цем» → Цемент санал → зөвхөн Цемент',
    R.cargoSearch && R.sugg && JSON.stringify(R.afterCargo) === '["Цемент"]', JSON.stringify([R.cargoSearch, R.sugg, R.afterCargo]));
}

/* FL11–FL12. Шүүлтийн бүрдэл АВТОМАТ: датасэт БҮРИЙН хүснэгт (DS_SCHEMA ба
   tableSchema()/paxTableSchema()) дээрх ангилалтай багана бүр сайт дээр
   шүүлтийн мөр болж ГАРЧ БАЙГААГ жинхэнэ хөтчөөр, фикстурын өгөгдөлтэй
   (?fx=1, tests/lib/feed-fixtures.js) шалгана. Өмнө нь missingFilterCols()-ийг
   шинэ датасэт нэмэх бүрд гараар ажиллуулах ёстой байв — мартвал шүүлтгүй
   багана чимээгүй гардаг.
   Хүлээгдэх багана = EHGlossary.filterColumns(head, types, rows) — exclude-ГҮЙ,
   хуудасны ЯГ ашигласан мөр дээр (spy). Харагдах = [data-fl-col] мөрүүд.
   PV_COL_EXCLUDE-ээр хасах нь зөвхөн доорх жагсаалтад шалтгаантай бүртгэгдсэн
   үед зөвшөөрөгдөнө — эс тэгвэл «хасчихаад мартсан» багана FL11-ээр унана. */
const FL_EXCLUDE_OK = {
  /* Агаарын нэгдсэн шүүлт (isAirDetail) ОУ/Дотоод, чиглэл, бүсийг шүүдэг;
     «Төлөв»-ийн шошго нь «Нислэгийн төрөл»-ийн утга — давхардуулахгүй. */
  air: ['ОУ/Дотоод', 'Чиглэл', 'Бүс нутаг', 'Төлөв'],
  /* «Салбарын код» = «Салбар»-ын техникийн код (air/rail) — ижил шүүлтийг давхардуулахгүй */
  sector_total: ['Салбарын код'],
  /* Цагийн тэмдэг (огноо + цаг) — ангилал биш; хугацааг нэгдсэн шүүлт (он/сар) шүүнэ */
  road_pax: ['Хөдлөх цаг', 'Төлөв өөрчлөгдсөн цаг']
};

/* DATASETS → [{name, sector, schemaKey, slug}] (index.html-ийн datasetSlug-тай ижил
   томьёо; content.json → site.datasets нэрийг индексээр давхарлана). */
function flDatasets(idx) {
  const block = idx.slice(idx.indexOf('const DATASETS=['));
  const arr = block.slice(0, block.indexOf('\n];'));
  const out = arr.split(/\n\s*\{sector:/).slice(1).map((chunk) => {
    const m = chunk.match(/^'(\w+)',name:'((?:[^'\\]|\\.)*)'/);
    const sm = chunk.match(/\bschema:'(\w+)'/);
    return m && { sector: m[1], name: m[2].replace(/\\'/g, "'"), schemaKey: sm ? sm[1] : m[1] };
  }).filter(Boolean);
  try {
    const c = readJson('content.json').site.datasets;
    if (Array.isArray(c)) c.forEach((o, i) => { if (o && o.name && out[i]) out[i].name = o.name; });
  } catch (e) { /* content.json-гүй ч ажиллана */ }
  out.forEach((d) => { d.slug = encodeURIComponent(d.sector + '__' + String(d.name).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')); });
  return out;
}

/* Хөтчийн доторх probe: filterColumns-ийг ороож (spy) хуудас ямар мөр дээр
   шүүлт бодсоныг барина, датасэт бүр рүү очиж «Шүүлт»-ийг нээгээд
   [data-fl-col]-ийг уншина. */
async function flCoverageProbe(d, w, list, warm) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const G = w.EHGlossary;
  if (!G) return { __err: 'EHGlossary алга' };
  const orig = G.filterColumns;
  let calls = [];
  G.filterColumns = function (head, types, rows, opts) {
    calls.push({ head: (head || []).slice(), types: (types || []).slice(), rows: rows || [],
      exclude: (opts && opts.exclude) || [], opts: opts || {} });
    return orig.apply(this, arguments);
  };
  const domHead = () => {
    const t = d.querySelector('[data-eh-table]');
    if (!t || !t.firstElementChild) return null;
    return [...t.firstElementChild.querySelectorAll('button')].map((b) => b.textContent.replace(/[↑↓]/g, '').trim());
  };
  const out = [];
  let opened = false;
  /* buildPreview нь шүүлтийн баганыг схемээр кэшлэдэг (_pvDimCache). Spy-аас
     ӨМНӨ зурагдсан датасэт (анхдагч dsIndex) кэшээс уншигдаж spy-д харагдахгүй
     тул эхлээд өөр датасэт рүү очиж кэшийг солино. */
  if (warm) { w.location.hash = '#/browse/' + warm; await sleep(1500); }
  for (const it of list) {
    calls = [];
    w.location.hash = '#/browse/' + it.slug;
    let last = null, dh = null, stable = 0;
    const t0 = Date.now();
    /* Өгөгдөл (фикстур) ирж хүснэгт тогтворжих хүртэл: толгой = spy-ийн head,
       мөртэй, 1.5 сек өөрчлөгдөхгүй. Зорчигч 3 → 11 багана болж солигддог. */
    while (Date.now() - t0 < 25000) {
      await sleep(300);
      if (!opened) {
        const fb = [...d.querySelectorAll('button')].find((b) => b.textContent.includes('▽'));
        if (fb) { fb.click(); opened = true; stable = 0; continue; }
      }
      const dh2 = domHead(), last2 = calls[calls.length - 1] || null;
      const same = dh2 && last2 && JSON.stringify(dh2) === JSON.stringify(last2.head) && last2.rows.length > 0 &&
        last2 === last && JSON.stringify(dh2) === JSON.stringify(dh);
      dh = dh2; last = last2;
      stable = same ? stable + 1 : 0;
      if (stable >= 5) break;
    }
    out.push({ slug: it.slug, name: it.name, schemaKey: it.schemaKey, domHead: dh,
      head: last ? last.head : null, rows: last ? last.rows.length : 0, exclude: last ? last.exclude : [],
      /* Хуудасны ЯГ тохиргоо (facet, тоон хүрээ, давхар баганыг нэгтгэх), зөвхөн exclude-гүй */
      /* Тоон хүрээ (range) нь ангилал биш — FL11 ангилалтай баганын бүрдлийг шалгана (хүрээ FL25) */
      exp: last ? orig(last.head, last.types, last.rows, Object.assign({}, last.opts, { exclude: [] })).filter((c) => c.kind !== 'range').map((c) => c.name) : [],
      domCols: [...d.querySelectorAll('[data-fl-col]')].map((e) => e.getAttribute('data-fl-col')),
      panel: !!d.querySelector('.eh-fl-row') });
  }
  G.filterColumns = orig;
  return { list: out };
}

/* Probe-ийн үр дүнг дүгнэнэ → [{name, missing:[багана], why}] */
function flCoverageGaps(G, res) {
  return res.list.map((r) => {
    const ok = FL_EXCLUDE_OK[r.schemaKey] || [];
    const want = r.exp.filter((c) => !(ok.indexOf(c) !== -1 && r.exclude.indexOf(c) !== -1));
    return { name: r.name, schemaKey: r.schemaKey, missing: G.missingFilterCols(r.domCols, want), panel: r.panel };
  });
}

async function groupFLCoverage(G) {
  if (!CHROME) { skipped('FL11–FL12 шүүлтийн бүрдэл (хөтөч)', 'Chrome олдсонгүй'); return; }
  const idx = read('index.html');
  const ds = flDatasets(idx);
  const src = dcScript();
  const dsBlock = (src.match(/\nconst DS_SCHEMA=\{([\s\S]*?)\n\};/) || [])[1] || '';
  const schemaKeys = [...dsBlock.matchAll(/\n {2}(\w+):\{head:/g)].map((m) => m[1]);
  check('FL11. DATASETS ба DS_SCHEMA уншигдав', ds.length >= 4 && schemaKeys.length >= 4,
    JSON.stringify({ ds: ds.map((d) => d.schemaKey), schemaKeys }));
  const unused = schemaKeys.filter((k) => !ds.some((d) => d.schemaKey === k));
  check('FL11. DS_SCHEMA-ийн схем бүр датасэтэд холбогдсон (шалгалтаас мултрах схем алга)',
    unused.length === 0, 'холбогдоогүй: ' + unused.join(', '));

  const run = async (list, override) => {
    const warm = (ds.find((x) => x.schemaKey !== list[0].schemaKey) || {}).slug || '';
    const srv = serve();
    const prevSrc = PROBE_SRC, prevOv = SERVE_OVERRIDE;
    PROBE_SRC = '/index.html?fx=1';
    SERVE_OVERRIDE = override || null;
    try {
      return await runProbe('async function(d,w){return (' + flCoverageProbe.toString() + ')(d,w,' +
        JSON.stringify(list) + ',' + JSON.stringify(warm) + ');}', 40000 + list.length * 30000);
    } finally { PROBE_SRC = prevSrc; SERVE_OVERRIDE = prevOv; srv.close(); }
  };

  const R = await run(ds);
  if (!R || R.__err || !Array.isArray(R.list)) { bad('FL11. Шүүлтийн бүрдлийн probe', R && R.__err); return; }
  R.list.forEach((r) => {
    check('FL11. ' + r.name + ': фикстурын өгөгдөлтэй хүснэгт зурагдав',
      r.rows > 0 && !!r.domHead && JSON.stringify(r.domHead) === JSON.stringify(r.head),
      r.rows ? 'хүснэгтийн толгой buildPreview-ийнхтэй таарахгүй: ' + JSON.stringify(r.domHead) + ' ≠ ' + JSON.stringify(r.head)
        : 'мөр алга — tests/lib/feed-fixtures.js-д энэ датасэтийн feed-ийн фикстур нэм');
  });
  const gaps = flCoverageGaps(G, R);
  gaps.forEach((g) => check('FL11. ' + g.name + ': ангилалтай багана бүр шүүлтэд санал болгогдоно',
    g.missing.length === 0,
    g.missing.map((c) => '«' + c + '» багана шүүлтэд алга').join('; ') +
      (g.panel ? '' : ' (хүснэгтийн «Шүүлт» самбар нээгдсэнгүй)') +
      ' — FL стандарт: buildPreview-ийн pvColFilters-д гарах ёстой, эсвэл нэгдсэн шүүлт шүүдэг бол PV_COL_EXCLUDE + FL_EXCLUDE_OK-д шалтгаантай бүртгэ'));
  check('FL11. Ядаж нэг датасэт баганын шүүлттэй (DOM уншилт хоосон биш)',
    R.list.some((r) => r.domCols.length > 0), JSON.stringify(R.list.map((r) => [r.schemaKey, r.domCols])));
  Object.keys(FL_EXCLUDE_OK).forEach((k) => {
    const r = R.list.find((x) => x.schemaKey === k);
    const stale = r ? FL_EXCLUDE_OK[k].filter((c) => (r.head || []).indexOf(c) === -1) : FL_EXCLUDE_OK[k];
    check('FL11. FL_EXCLUDE_OK.' + k + ': хасагдсан багана бүр хүснэгтэд байна (хуучирсан бүртгэл алга)',
      stale.length === 0, stale.join(', '));
  });

  /* FL12. Эвдэрсэн хуулбар: хүлээгдэх баганатай датасэтийн нэг баганыг
     PV_COL_EXCLUDE-ээр (FL_EXCLUDE_OK-д бүртгэлгүй) нууна → FL11 тэр
     датасэт + баганыг НЭРЛЭЖ унах ёстой. Шалгалт өөрөө хоосон болохоос хамгаална. */
  const victim = R.list.find((r) => !FL_EXCLUDE_OK[r.schemaKey] && r.domCols.length > 0);
  if (!victim) { bad('FL12. Эвдэрсэн хуулбарт тохирох датасэт алга', JSON.stringify(R.list.map((r) => r.schemaKey))); return; }
  const col = victim.domCols[0];
  const broken = idx.replace('const PV_COL_EXCLUDE={', 'const PV_COL_EXCLUDE={' + victim.schemaKey + ':[' + JSON.stringify(col) + '],');
  check('FL12. Эвдэрсэн хуулбар бэлтгэгдэв', broken !== idx);
  const RB = await run(ds.filter((x) => x.schemaKey === victim.schemaKey), { '/index.html': broken });
  const gb = RB && Array.isArray(RB.list) ? flCoverageGaps(G, RB) : [];
  check('FL12. Хасаад бүртгээгүй багана → «' + victim.name + '»: «' + col + '» гэж нэрлэж унана',
    gb.length === 1 && gb[0].missing.length === 1 && gb[0].missing[0] === col,
    JSON.stringify(RB && RB.__err ? RB : gb));
}

/* ─────────── AF. Агаарын нэгдсэн шүүлтийн текст → content.json ─────────── */
/* Шүүлтийн блок (isAirDetail/showAirFilters) өмнө нь "Нэгдсэн шүүлт — …",
   "ачаалж байна…", "Бүгд", "Явсан/Ирсэн/Дотоодын", " он · … сар" текстийг
   хатуу кодлосон байв — админ засаж чаддаггүй байсан. Утга солигдоход
   сайтын гаралт ӨӨРЧЛӨГДӨХ ёстой (F/G бүлгийн загвар). */
async function groupAF() {
  group('AF. Агаарын шүүлтийн текст (content.json → сайт)');
  const idx = read('index.html'), con = readJson('content.json');
  const d = con.site.detail || {};
  const keys = ['all', 'loading', 'air_year_word', 'air_month_word', 'air_type_dom', 'air_dir_dep', 'air_dir_arr'];
  check('AF1. content.json site.detail шинэ 7 түлхүүр бүртгэлтэй',
    keys.every(k => typeof d[k] === 'string' && d[k].length), JSON.stringify(keys.filter(k => !d[k])));
  keys.forEach(k => check('AF1. stxt(\'detail.' + k + '\') кодод уншигдана', idx.includes("stxt('detail." + k + "'")));

  /* AF2. Темплейтийн шүүлтийн блок: хатуу монгол үг үлдээгүй (зөвхөн {{ }}) */
  const a = idx.indexOf('<sc-if value="{{ detail.showAirFilters }}">');
  const blk = idx.slice(a, idx.indexOf('<div class="eh-g4 eh-g-2c"', a));
  const hard = (blk.match(/>([^<>{}]*[А-Яа-яӨөҮүЁё][^<>{}]*)</g) || []).map(x => x.slice(1, -1).trim()).filter(Boolean);
  check('AF2. Шүүлтийн блокт хатуу монгол текст алга', hard.length === 0, hard.join(' | '));
  check('AF2. Толгой = sections.sec-01 (шинэ давхар түлхүүр нэмээгүй)',
    blk.includes('{{ sSec01 }}') && /sSec01:this\.stxt\('sections\.sec-01'/.test(idx) &&
    !/"nav_filter_head"|air_filter_head/.test(JSON.stringify(con)));

  /* AF3. Unit: buildAirFilters() — content-ийн утга солигдоход чип/дүгнэлт солигдоно */
  const m = idx.match(/\n  buildAirFilters\(dsel\)\{([\s\S]*?)\n  \}\n  \/\* Вагоны датасэтийн/);
  if (!m) { bad('AF3. buildAirFilters() задарсангүй'); return; }
  const build = (content) => {
    const stxt = (p, fb) => { const v = content[p]; return v == null || v === '' ? fb : v; };
    const self = {
      _flightsYears: [2025, 2026], _airRegions: ['Ази'],
      state: { airType: 'all', airDir: 'all', airRegion: 'all', airYearLoading: false, airYFrom: '2026', airYTo: '2026', airMFrom: '1', airMTo: '12' },
      airRange() { return { yFrom: 2026, yTo: 2026, mFrom: 3, mTo: 5, avail: [2025, 2026], allYears: false }; },
      setAirYearRange() {}, setAirRangeField() {}, setState() {}, applyAirRange() {}, setAirFilter() {}
    };
    return new Function('stxt', 'return function(dsel){' + m[1] + '}')(stxt).call(self, { sector: 'air' });
  };
  const lbl = (r) => r.airTypeChips.map(c => c.label).join('|') + '#' + r.airDirChips.map(c => c.label).join('|') +
    '#' + r.airRegionChips.map(c => c.label).join('|') + '#' + r.airYearChips[0].label + '#' + r.airRangeUi.summary;
  const base = build({});
  check('AF3. Анхны утга ХЭВЭЭР: Бүгд|Олон улсын|Дотоодын # Бүгд|Явсан|Ирсэн',
    lbl(base) === 'Бүгд|Олон улсын|Дотоодын#Бүгд|Явсан|Ирсэн#Бүгд|Ази#Бүгд#2026 он · 3–5 сар', lbl(base));
  const alt = build({ 'detail.all': 'ALL', 'chart.intl': 'INTL', 'detail.air_type_dom': 'DOM', 'detail.air_dir_dep': 'DEP',
    'detail.air_dir_arr': 'ARR', 'detail.air_year_word': 'YR', 'detail.air_month_word': 'MO' });
  check('AF3. content утга солигдоход ШҮҮЛТИЙН чипүүд ДАГАЖ солигдоно (бүх 5 "Бүгд", ОУ, ОН, чиглэл, дүгнэлт)',
    lbl(alt) === 'ALL|INTL|DOM#ALL|DEP|ARR#ALL|Ази#ALL#2026 YR · 3–5 MO', lbl(alt));

  /* AF4. DOM: солигдсон content.json-ийг сайт жинхэнэ хуудсанд харуулна (ХОЁР тал: сайт) */
  if (!CHROME) { skipped('AF4 (DOM)', 'Chrome олдсонгүй'); return; }
  const slug = (x) => x.sector + '__' + String(x.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const air = (con.site.datasets || []).find(x => x.sector === 'air');
  if (!air) { skipped('AF4', 'агаарын датасэт алга'); return; }
  const mod = JSON.parse(JSON.stringify(con));
  Object.assign(mod.site.detail, { all: 'AF-ALL', loading: 'AF-LOAD', air_dir_dep: 'AF-DEP', air_dir_arr: 'AF-ARR', air_type_dom: 'AF-DOM' });
  mod.site.sections['sec-01'] = 'AF-HEAD';
  const srv = serve();
  SERVE_OVERRIDE = { '/content.json': JSON.stringify(mod) };
  try {
    PROBE_SRC = '/index.html#/browse/' + encodeURIComponent(slug(air));
    const R = await runProbe(`async function(d,w){
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      await sleep(7000);
      const b=[...d.querySelectorAll('button')].find(x=>/Шүүлт/.test(x.innerText)&&x.innerText.length<20);
      if(!b) return {__err:'Шүүлт товч алга'};
      b.click(); await sleep(1500);
      return {text:d.body.innerText};
    }`, 120000);
    if (R.__err) skipped('AF4', R.__err + ' — feed ирсэнгүй байж болно');
    else if (!/AF-HEAD/.test(R.text) && !/AF-DEP/.test(R.text)) skipped('AF4', 'агаарын шүүлт зурагдсангүй (feed ирсэнгүй) — худал FAIL гаргахгүй');
    else {
      ['AF-HEAD', 'AF-ALL', 'AF-DEP', 'AF-ARR', 'AF-DOM'].forEach(t =>
        check('AF4. Сайт дээр "' + t + '" харагдана', R.text.indexOf(t) >= 0));
    }
  } finally {
    SERVE_OVERRIDE = null; PROBE_SRC = '/admin/index.html'; srv.close();
  }
}

/* ── DA. ДАТА АНАЛИСТЫН ТУЛГАЛТ — "алга" гэсэн мэдэгдэл бүр нотолгоотой ──
   2026-10-16: зорчигчийн хуудсанд 2025 сонгоход «Өмнөх оноос — өмнөх оны
   өгөгдөл алга» гарч, хэрэглэгч "2025 дата байхад яагаад алга" гэж асуув.
   Тестүүд (PA5) энэ төлөвийг "зөв" гэж баталдаг байсан — загварын дотоод
   шалтгааныг л шалгаж, (1) карт АЛЬ оныг хэлж буй, (2) өмнөх он ЭХ
   СУРВАЛЖИД үнэхээр алга уу эсвэл бидний таталт дутуу уу гэдгийг огт
   асуудаггүй байв. Ижил УБТЗ-ийн вагоны түүх 2023-аас эхэлдэг атал
   зорчигчийнх 2025-аас — энэ зөрүүг хэн ч тулгаагүй.
   DA1 — статик: "өмнөх … алга" текст бүр хугацааг ({year}/{from}) нэрлэнэ.
   DA2 — амьд (portal.mrt.gov.mn, хүрэхгүй бол SKIP): нэг эх сурвалжийн
         датасэтүүдийн түүхийн эхлэл зөрвөл tests/lib/known-coverage-gaps.js-д
         бүртгэлтэй байх ёстой, эс бөгөөс УНАНА.
   DA3 — амьд: бодит түүхийн он БҮРээр «Өмнөх оноос» картын текстийг бодож,
         YoY-гүй бол АЛЬ он алга, түүх хэзээнээс гэдгийг нэрлэсэн эсэх. */
async function groupDA() {
  group('DA. Дата аналистын тулгалт (хамрах хүрээ · "алга" мэдэгдэл)');
  const C = readJson('content.json');
  /* DA1 */
  const claims = [];
  (function walk(o, p) {
    for (const k in o) {
      const v = o[k], q = p ? p + '.' + k : k;
      if (typeof v === 'string') {
        if (/өмнөх оны[^"]{0,40}(дата|өгөгдөл)[^"]{0,10}алга/i.test(v) && !/\{(year|from|month)\}/.test(v)) claims.push(q + ' = ' + v);
      } else if (v && typeof v === 'object') walk(v, q);
    }
  })(C, '');
  check('DA1. "өмнөх оны өгөгдөл алга" төрлийн текст бүр ХУГАЦААГ нэрлэнэ ({year}/{from})', claims.length === 0, claims.join(' | '));

  /* DA4. Агаарын k04 «НИЙТ НИСЛЭГ»-ийн YoY (кэйс #6, 2026-10-16): өмнөх оны мөн сар
     байхгүй гурван шалтгааныг нэг хатуу текстээр "алга" гэдэг, ачаалалт унасан ([])
     эсвэл 0 нислэгтэй сард pctDelta(…,0) → "0.0%" (өөрчлөлтгүй мэт) ХУДАЛ гаргадаг байв. */
  const apB = (dcScript().match(/\nfunction airPrevCompare\(prevYear,availYears,prevSrc,prevCount\)\{([\s\S]*?)\n\}/) || [])[1];
  if (!apB) bad('DA4. airPrevCompare() олдсонгүй');
  else {
    const AP = new Function('prevYear', 'availYears', 'prevSrc', 'prevCount', apB);
    const F = [{ month: 9 }];
    check('DA4. 4 төлөв: feed-д он алга / [] ачаалагдсангүй / 0 нислэг / харьцуулж болно',
      AP(2024, [2026, 2025], undefined, null) === 'no_year' &&
      AP(2025, [2026, 2025], undefined, null) === 'not_loaded' &&
      AP(2025, [2026, 2025], [], 0) === 'not_loaded' &&
      AP(2025, ['2026', '2025'], F, 0) === 'zero' &&
      AP(2025, [2026, 2025], F, 12) === 'ok');
    const src = dcScript();
    check('DA4. k04: зөвхөн "ok" үед хувь (pctDelta), бусад үед "0.0%" ЗОХИОХГҮЙ',
      /flDelta=flPrevWhy==='ok'\?pctDelta\(flCount,flPrevCount\):\{s:'',dir:'flat'\}/.test(src) &&
      !/'харьцуулах өгөгдөл алга \(өмнөх оны мөн сарын дата алга\)'/.test(src));
    const ch = (C.site || {}).chart || {};
    check('DA4. Шалтгаан бүрийн текст content.json-д, ОН-ыг нэрлэнэ ({year}; zero нь {month} ч)',
      ['prev_no_year', 'prev_not_loaded', 'prev_zero'].every(k => /\{year\}/.test(ch[k] || '')) && /\{month\}/.test(ch.prev_zero || ''));
  }

  /* DA2/DA3 — амьд */
  const BASE = 'https://portal.mrt.gov.mn';
  const EP = { railPax: '/api/sectors/rail/passengers/history', railWagon: '/api/sectors/rail/wagon-loading/history' };
  const VOL = { railPax: 'passengers', railWagon: 'loaded' };
  /* Нэг эх сурвалж (УБТЗ / Veritech) — хамрах хүрээ ижил байх ёстой бүлгүүд */
  const SIBLINGS = [['railPax', 'railWagon']];
  const hist = {};
  for (const k of Object.keys(EP)) {
    try {
      const r = await fetch(BASE + EP[k], { signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j && j.status === 'ok' && Array.isArray(j.months) && j.months.length) hist[k] = j;
    } catch (e) { /* SKIP доор */ }
  }
  if (!hist.railPax || !hist.railWagon) {
    skipped('DA2/DA3. Амьд түүхийн тулгалт', 'portal.mrt.gov.mn хүрэхгүй');
    return;
  }
  /* Түүхийн БОДИТ эхлэл: медиан сарын 5%-иас бага "сүнс" сарыг тооцохгүй
     (үзлэгийн түүхэнд 2019-07 = 1 мөр гэх мэт эх сурвалжийн огнооны алдаа). */
  const realFrom = (k) => {
    const ms = hist[k].months.map(m => ({ m: String(m.month).slice(0, 7), v: +m[VOL[k]] || 0 })).sort((a, b) => a.m < b.m ? -1 : 1);
    const vs = ms.map(x => x.v).sort((a, b) => a - b), med = vs[Math.floor(vs.length / 2)] || 0;
    const f = ms.find(x => x.v >= med * 0.05);
    return f ? f.m : null;
  };
  const GAPS = require('./lib/known-coverage-gaps.js');
  const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  const unexplained = [], warn = [];
  for (const grp of SIBLINGS) {
    const froms = grp.map(k => ({ k, f: realFrom(k) })).filter(x => x.f);
    const earliest = froms.reduce((a, b) => (a.f <= b.f ? a : b));
    for (const x of froms) {
      if (monthsBetween(earliest.f, x.f) < 12) continue;
      const g = GAPS.find(e => e.dataset === x.k && e.from === x.f);
      if (!g) unexplained.push(x.k + ' түүх ' + x.f + '-аас, харин ' + earliest.k + ' ' + earliest.f + '-аас');
      else if (!g.sourceChecked) warn.push(x.k + ': ' + g.next);
    }
  }
  check('DA2. Нэг эх сурвалжийн датасэтүүдийн түүхийн эхлэлийн зөрүү (≥12 сар) known-coverage-gaps.js-д бүртгэлтэй',
    unexplained.length === 0, unexplained.join(' | ') + ' — эх сурвалжаас шалгаад tests/lib/known-coverage-gaps.js-д бүртгэ');
  /* DA2b. Бүртгэл ХУУЧРАХГҮЙ: бичлэгийн `from` = порталын одоогийн бодит эхлэл.
     2026-10-16: 2023 нөхөгдсөний дараа "2024-01" бичлэг үлдэж, тест анзаараагүй,
     WARN чимээгүй алга болсон — нээлттэй ажил мартагдах эрсдэл. */
  const stale = GAPS.filter(g => hist[g.dataset] && realFrom(g.dataset) !== g.from)
    .map(g => g.dataset + ': бүртгэлд ' + g.from + ', портал одоо ' + realFrom(g.dataset) + '-аас');
  check('DA2b. Бүртгэлийн бичлэг бүр порталын ОДООГИЙН түүхийн эхлэлтэй таарна (хуучирсан бичлэг алга)',
    stale.length === 0, stale.join(' | ') + ' — known-coverage-gaps.js-ийг шинэчил эсвэл устга');
  /* DA2c. Хөрш датасэтүүд ХОЁУЛАА ижил оноос эхэлсэн ч эх сурвалж түүнээс ЭРТ
     өгөгдөлтэй байж болно (зорчигч 2022 = 5 131 мөр) — sibling тулгалт үүнийг
     харахгүй. sourceRows-д порталын эхлэлээс ӨМНӨХ он байвал нээлттэй гэж WARN. */
  GAPS.forEach(g => {
    const earlier = Object.keys(g.sourceRows || {}).filter(y => +y < +String(g.from).slice(0, 4) && +g.sourceRows[y] > 0);
    if (earlier.length) warn.push(g.dataset + ': эх сурвалжид ' + earlier.map(y => y + ' (' + g.sourceRows[y] + ' мөр)').join(', ') +
      ' байна, порталд алга — ' + g.next);
  });
  /* sourceChecked:false бичлэг бүр WARN — хамгийн ЭРТ эхэлдэг датасэт (хөрш тулгалт
     юу ч олохгүй) ба sourceRows-д эрт он үлдээгүй үед ч нээлттэй ажил чимээгүй алга
     болохгүй (2026-10-16: зорчигч 2021 нөхөгдсөний дараа 2020 шалгаагүй ч WARN алга болов). */
  GAPS.filter(g => !g.sourceChecked && !warn.some(w => w.startsWith(g.dataset + ':')))
    .forEach(g => warn.push(g.dataset + ': эх сурвалжийн эхлэл батлагдаагүй — ' + g.next));
  warn.forEach(w => console.log('  WARN  DA2. Эх сурвалжаас шалгаагүй/нөхөөгүй хамрах хүрээ — ' + w));
  check('DA2. Бүртгэлийн бичлэг бүр шалтгаан, дараагийн алхам, кэйсийн баримттай (reason/next/case)',
    GAPS.every(g => g.reason && g.next && g.case && fs.existsSync(path.join(ROOT, g.case))), JSON.stringify(GAPS.map(g => g.case)));

  /* DA3 */
  const src = dcScript();
  const fx = (re) => { const m = src.match(re); return m && m[1]; };
  const paxB = fx(/function paxAnalysisModel\(all,sel,year,mr\)\{([\s\S]*?)\n\}/);
  const wagB = fx(/function wagonAnalysisModel\(all,sel,year,mr\)\{([\s\S]*?)\n\}/);
  const yrtB = fx(/\nfunction yoyReasonText\(m,T\)\{([\s\S]*?)\n\}/);
  if (!paxB || !wagB || !yrtB) { bad('DA3. paxAnalysisModel/wagonAnalysisModel/yoyReasonText олдсонгүй'); return; }
  const psgB = fx(/\nfunction paxSeriesWithGaps\(ms,fullRange\)\{([\s\S]*?)\n\}/);
  const PSG = new Function('ms', 'fullRange', psgB || '');
  const ycB = fx(/\nfunction yoyCompare\(months,yr,mFrom,mTo,key\)\{([\s\S]*?)\n\}/);
  const YC = new Function('months', 'yr', 'mFrom', 'mTo', 'key', ycB || 'throw new Error("yoyCompare алга")');
  const MODELS = { railPax: [(a, s, y, r) => new Function('paxSeriesWithGaps', 'yoyCompare', 'all', 'sel', 'year', 'mr', paxB)(PSG, YC, a, s, y, r), 'pax_an'],
    railWagon: [new Function('yoyCompare', 'all', 'sel', 'year', 'mr', wagB).bind(null, YC), 'wagon_an'] };
  const YRT = new Function('m', 'T', yrtB);
  const badTxt = [];
  for (const k of Object.keys(MODELS)) {
    const [M, blk] = MODELS[k], TC = (C.site || {})[blk] || {};
    const T = (key, fb) => (TC[key] != null ? TC[key] : fb);
    const years = [...new Set(hist[k].months.map(m => +String(m.month).slice(0, 4)))];
    for (const y of years) {
      const m = M(hist[k], null, y, null);
      if (!m.hasData || m.yoy) continue;
      const t = YRT(m, T);
      if (m.yoyReason === 'no_prev_year' && !(t.includes(String(y - 1)) && t.includes(m.historyFrom))) badTxt.push(k + ' ' + y + ': ' + t);
      if (/\{(year|from)\}/.test(t)) badTxt.push(k + ' ' + y + ': орлуулаагүй ' + t);
    }
  }
  check('DA3. Бодит түүхийн он бүрт «Өмнөх оноос» тайлбар АЛЬ он алга + түүхийн эхлэлийг нэрлэнэ', badTxt.length === 0, badTxt.join(' | '));
}

/* ──────────────────────────────── ST САЛБАРЫН НЭГТГЭЛ ──────────────────────────────── */
/* ST. Салбарын нэгтгэл (sectorTotal — backend gold.sector_daily_total, migrations/022):
   нийтлэг хэмжүүр (зорчигч, ачаа тонн) дээр салбар хоорондын харьцаа; нүүрний d05 донут
   ЭНДЭЭС (төмөр зам гардаггүй байсан регресс); «Нийтийн тээвэр» нүүрнээс нуугдсан.
   Гараар бодох фикстур:
     2025-09  агаар зорчигч 100 · ачаа 2      | төмөр зам 300 · 1000
     2026-09  агаар 120 · 3                   | төмөр зам 270 · 1100
     2026-10  агаар 50 · 1 (18/31 өдөр, ДУТУУ) | төмөр зам 40 · 600 (18/31)
   → 2026: зорчигч 480 (агаар 170 = 35.42%), ачаа 1704
   → өмнөх оны мөн үе = ЗӨВХӨН 9-р сар (10-р сар дутуу): агаар +20%, төмөр зам −10%,
     нийт 390/400 = −2.5%; ачаа 1103/1002 = +10.08% */
function groupST() {
  group('ST. Салбарын нэгтгэл — модель · fallback · d05 · холболт');
  const src = dcScript();
  const idx = read('index.html');
  const a = src.indexOf('/* ── САЛБАРЫН НЭГТГЭЛ (sectorTotal)'), b = src.indexOf('/* Зорчигчийн сарын график — ОН/ОУ-ийг ЭЭЛЖ');
  check('ST0. Модулийн блок олдов (sectorTotalModel … sectorDonutArcs)', a > 0 && b > a);
  if (!(a > 0 && b > a)) return;
  const NEON = { air: '#A', rail: '#R', road: '#D' };
  const L = new Function('NEON', src.slice(a, b) + '\nreturn {sectorTotalModel,sectorTotalFallback,airMonthlyFromFlights,sectorWeeklyView,buildSectorStackChart,sectorDonutArcs,stPct,SECTOR_TOTAL_ORDER};')(NEON);
  const mo = (month, sector, pax, ft, days, dim) => ({ month, sector, days_in_month: dim, passengers: pax, freight_tonnes: ft,
    passenger_days: days, freight_days: days, passenger_last: null, freight_last: null });
  const API = { status: 'ok',
    sectors: [{ sector: 'air', name: 'Агаарын тээвэр', has_passengers: true, has_freight: true, passengers_last: '2026-10-18', freight_last: '2026-10-18' },
      { sector: 'road', name: 'Авто тээвэр', has_passengers: false, has_freight: false },
      { sector: 'rail', name: 'Төмөр зам', has_passengers: true, has_freight: true, passengers_last: '2026-10-18', freight_last: '2026-10-17' }],
    months: [mo('2025-09', 'air', 100, 2, 30, 30), mo('2025-09', 'rail', 300, 1000, 30, 30),
      mo('2026-09', 'air', 120, 3, 30, 30), mo('2026-09', 'rail', 270, 1100, 30, 30),
      mo('2026-10', 'air', 50, 1, 18, 31), mo('2026-10', 'rail', 40, 600, 18, 31)] };
  const m = L.sectorTotalModel(API, 2026, { from: 1, to: 12 });
  const P = m.measures.passengers, F = m.measures.freight_tonnes;
  const air = P.bySec.find(s => s.key === 'air'), road = P.bySec.find(s => s.key === 'road');
  check('ST1. 2026: зорчигч 480 (агаар 170 = 35.42%), ачаа 1704; эх сурвалжгүй авто — null (0 биш)',
    m.hasData && P.total === 480 && air.value === 170 && Math.abs(air.pct - 170 / 480 * 100) < 1e-9 && F.total === 1704 &&
    road.value === null && road.pct === null, JSON.stringify([P.total, air, road, F.total]));
  const yA = P.yoy.find(y => y.key === 'air'), yR = P.yoy.find(y => y.key === 'rail');
  check('ST2. Өмнөх оны мөн үе ЗӨВХӨН бүтэн сараар (9-р сар; 10-р сар дутуу): агаар +20%, төмөр зам −10%, нийт −2.5%',
    JSON.stringify(yA.months) === '[9]' && Math.abs(yA.pct - 20) < 1e-9 && Math.abs(yR.pct + 10) < 1e-9 && Math.abs(P.yoyPct + 2.5) < 1e-9 &&
    Math.abs(F.yoyPct - (1103 / 1002 - 1) * 100) < 1e-9, JSON.stringify([yA, yR, P.yoyPct, F.yoyPct]));
  check('ST3. Сарын цуваа: 2 сар, сүүлийн нь дутуу (бүдэг), авто зам хэсэггүй',
    P.series.length === 2 && P.series[1].partial && !P.series[0].partial && P.series[1].parts.every(p => p.key !== 'road'),
    JSON.stringify(P.series.map(s => [s.month, s.partial, s.parts.length])));
  const mAll = L.sectorTotalModel(API, 'all', null);
  check('ST4. «Бүгд» он: хамгийн сүүлийн он (2026) vs 2025 — «жил сонгоно уу» гэж «—» үлдээхгүй (YY стандарт)',
    mAll.measures.passengers.yoyYear === 2026 && Math.abs(mAll.measures.passengers.yoyPct + 2.5) < 1e-9 && mAll.measures.passengers.total === 880);
  const mK = L.sectorTotalModel(API, 2026, { from: 1, to: 12, keys: new Set(['Төмөр зам']) });
  check('ST5. FL3: хүснэгтийн «Салбар» шүүлт (Төмөр зам) KPI/харьцуулалтыг хамт шүүнэ',
    mK.measures.passengers.total === 310 && Math.abs(mK.measures.passengers.yoyPct + 10) < 1e-9 && mK.sectors.length === 1 && mK.allSectors.length === 3);
  const m10 = L.sectorTotalModel(API, 2026, { from: 10, to: 10 });
  check('ST6. Зөвхөн дутуу сар (10) сонговол харьцуулалт «—» (дутуу сарыг бүтэн мэт харьцуулахгүй)',
    m10.hasData && m10.measures.passengers.yoyPct === null && m10.measures.passengers.total === 90);
  /* Регресс (2026-10-21, chart-stat-qa): авто тээвэр 2025-08-аас л — 8-р сараар л харьцуулагдана.
       2025-08 авто 1000 | 2026-08 авто 500  (−50%)
       2025-08/09 агаар 100/100, төмөр зам 300/300 | 2026-08/09 агаар 110/120, төмөр зам 330/270
     → нийт % = зөвхөн 8–9 сартай агаар + төмөр зам: 830/800 = +3.75%
       (авто 8-р сараар хольбол 1330/1800 = −26.1% — худал) */
  const API2 = { status: 'ok', sectors: API.sectors,
    months: [mo('2025-08', 'air', 100, null, 31, 31), mo('2025-08', 'rail', 300, null, 31, 31), mo('2025-08', 'road', 1000, null, 31, 31),
      mo('2025-09', 'air', 100, null, 30, 30), mo('2025-09', 'rail', 300, null, 30, 30),
      mo('2026-08', 'air', 110, null, 31, 31), mo('2026-08', 'rail', 330, null, 31, 31), mo('2026-08', 'road', 500, null, 31, 31),
      mo('2026-09', 'air', 120, null, 30, 30), mo('2026-09', 'rail', 270, null, 30, 30), mo('2026-09', 'road', 600, null, 30, 30)] };
  const P2 = L.sectorTotalModel(API2, 2026, { from: 1, to: 12 }).measures.passengers;
  const yD = P2.yoy.find(y => y.key === 'road');
  check('ST6a. Өмнөх оноос: богино цонхтой салбар (авто, зөвхөн 8-р сар) нийт %-д ОРОХГҮЙ — нийт +3.75%, авто өөрийн мөрөнд −50%',
    Math.abs(P2.yoyPct - 3.75) < 1e-9 && JSON.stringify(P2.yoySectors) === '["air","rail"]' && Math.abs(yD.pct + 50) < 1e-9,
    JSON.stringify([P2.yoyPct, P2.yoySectors, yD]));
  check('ST7. Эх сурвалж алга / no_data → hasData:false (тоо зохиохгүй)',
    !L.sectorTotalModel(null, 'all').hasData && !L.sectorTotalModel({ status: 'no_data', sectors: [], months: [] }, 'all').hasData);

  /* Fallback — backend endpoint deploy болохоос өмнө салбарын датасэтүүдээс */
  const am = L.airMonthlyFromFlights([{ year: 2026, month: 9, day: 1, pax: 10, cargoKg: 500, mailKg: 500 }, { year: 2026, month: 9, day: 2, pax: 5 }]);
  check('ST8. ИНЕГ feed → сарын агаар: зорчигч 15, ачаа (ачаа + шуудан) 1 т, 2 өдөр, сүүлийн 09-02',
    am.length === 1 && am[0].passengers === 15 && am[0].freight_tonnes === 1 && am[0].days === 2 && am[0].last === '2026-09-02', JSON.stringify(am));
  const fb = L.sectorTotalFallback({ air: am,
    railPax: { status: 'ok', months: [{ month: '2026-09', days: 30, passengers: 270 }] },
    railFreight: { status: 'ok', months: [{ month: '2026-09', days: 30, tonnes: 1100, last_date: '2026-09-30' }] } });
  const fr = fb.sectors.find(s => s.sector === 'rail'), fd = fb.sectors.find(s => s.sector === 'road');
  check('ST9. Fallback = backend-ийн ижил хэлбэр: сар × салбар, зорчигчийн сүүлийн бичлэг САРЫН нарийвчлалтай (огноо зохиохгүй), weekly null',
    fb.status === 'ok' && fb.source === 'fallback' && fb.weekly === null && fb.months.length === 2 &&
    fr.passengers_last === '2026-09' && fr.freight_last === '2026-09-30' && !fd.has_passengers && !fd.has_freight &&
    L.sectorTotalModel(fb, 2026, null).measures.passengers.total === 285, JSON.stringify(fb.sectors));
  check('ST9. Fallback: салбарын эх сурвалж алга бол no_data', L.sectorTotalFallback({}).status === 'no_data');

  /* 7 хоногийн тайлан (backend weekly) */
  const W = { week_end: '2026-10-18', sectors: ['air', 'rail'], comparable: ['rail'], yoy_cur: 600, yoy_prev: 500, stale: [],
    weeks: [{ week_start: '2026-10-05', week_end: '2026-10-11', missing: false, value: 200, by_sector: { air: { value: 50, days: 7 }, rail: { value: 150, days: 7 } } },
      { week_start: '2026-10-12', week_end: '2026-10-18', missing: false, value: 180, by_sector: { air: { value: 60, days: 7 }, rail: { value: 120, days: 7 } } }],
    ytd: { year: 2026, value: 1000, by_sector: { air: { value: 400 }, rail: { value: 600 } } }, prev_ytd: { year: 2025 } };
  const v = L.sectorWeeklyView(W, m.allSectors);
  check('ST10. 7 хоног: өмнөх 7 хоногоос −10%, өмнөх оны мөн үеэс +20% (зөвхөн харьцуулах салбараар), агаар 33.3%',
    Math.abs(v.wow + 10) < 1e-9 && Math.abs(v.yoy - 20) < 1e-9 && Math.abs(v.weekSlices.list[0].pct - 60 / 180 * 100) < 1e-9 &&
    v.ytdSlices.total === 1000 && v.weekSlices.list[0].name === 'Агаарын тээвэр', JSON.stringify([v.wow, v.yoy]));
  const wm = JSON.parse(JSON.stringify(W)); wm.weeks[0].missing = true;
  check('ST10. Өмнөх 7 хоног бичлэггүй бол харьцуулалт «—» (0-тэй харьцуулахгүй); weekly алга → null',
    L.sectorWeeklyView(wm, m.allSectors).wow === null && L.sectorWeeklyView(null) === null);

  /* График — Y 0-ээс, дутуу/бичлэггүй хугацаа, tooltip (HV) */
  const ch = L.buildSectorStackChart([
    { label: 'a', tipLabel: '2026-09', total: 100, parts: [{ name: 'Агаар', color: '#1', value: 60, complete: true }, { name: 'Төмөр', color: '#2', value: 40, complete: false, days: 9, dim: 30 }] },
    { label: 'b', tipLabel: '2026-10', missing: true, total: 0, parts: [] }], { unit: 'зорчигч' });
  check('ST11. Давхарласан багана: Y тэнхлэг 0-ээс, дутуу хэсэг бүдэг/тасархай + «дутуу (9/30)», бичлэггүй — «мэдээлэл алга» тууз',
    ch.yTicks[0].label === '0' && ch.bars.length === 3 && ch.bars[1].op === '.42' && ch.bars[1].dash === '3 2' &&
    /^2026-09 — Төмөр: 40 зорчигч · дутуу \(9\/30\)/.test(ch.bars[1].tip) && ch.bars[2].tip === '2026-10 — мэдээлэл алга' &&
    /^2026-09 — Агаар: 60 зорчигч · нийт 100 зорчигч$/.test(ch.bars[0].tip), JSON.stringify(ch.bars.map(x => x.tip)));
  check('ST12. Эзлэх хувь: 0-ээс их боловч 0.05%-иас бага бол «<0.1%», 0.0% биш; донутад зөвхөн >0 хэсэг',
    L.stPct(0.0015) === '<0.1%' && L.stPct(12.34) === '12.3%' && L.stPct(null) === '—' &&
    L.sectorDonutArcs([{ name: 'A', color: '#1', value: 0, pct: 0 }, { name: 'B', color: '#2', value: 5, pct: 100 }], 'т').length === 1);

  /* d05 — нүүрний «Салбарын харьцаа» (регресс: төмөр зам ОГТ гардаггүй байв) */
  const mD = idx.match(/\n  buildDonut\(activeKey\)\{([\s\S]*?)\n  \}\n  buildGlobe\(\)/);
  const mS = idx.match(/\n  sectorShareFromTotal\(keys\)\{([\s\S]*?)\n  \}\n/);
  check('ST13. buildDonut + sectorShareFromTotal олдов', !!(mD && mS));
  if (mD && mS) {
    const SEC = { air: { label: 'Агаарын тээвэр', kpis: [['x', '1,000']] }, rail: { label: 'Төмөр зам', kpis: [['x', '500']] },
      road: { label: 'Авто зам', kpis: [['x', '9']] }, water: { label: 'Ус, далайн тээвэр', kpis: [['x', '1']] } };
    const NE = { air: '#1', rail: '#2', road: '#3', water: '#4' };
    const st = (p, x) => x;
    /* DG-P: index.html-ийн chartPeriodText-тэй ижил (periodSpan) — донутын хугацааны мөрийг шалгана */
    const GL = require(path.join(ROOT, 'js', 'erthub-glossary.js'));
    const CPT = (m) => GL.periodSpan((m && m.periodKeys) || [], { dayFrom: m && m.dayFrom, dayTo: m && m.dayTo, partialTo: m && m.partialTo, partialCount: m && m.partialN }).text;
    const SHARE = new Function('SECTORS', 'NEON', 'stxt', 'sectorTotalModel', 'chartPeriodText', 'EHGlossary', 'return function(keys){' + mS[1] + '}')(SEC, NE, st, L.sectorTotalModel, CPT, GL);
    const D = new Function('SECTORS', 'NEON', 'stxt', 'EHGlossary', 'return function(activeKey){' + mD[1] + '}')(SEC, NE, st, require(path.join(ROOT, 'js', 'erthub-glossary.js')));
    const apiW = Object.assign({}, API, { weekly: { passengers: { ytd: { year: 2026, from: '2026-01-01', to: '2026-10-18', by_sector: { air: { value: 100 }, rail: { value: 300 } } } } } });
    const ctx = (api, meas) => ({ state: { d05Measure: meas }, setState() {}, visibleSectorKeys: () => ['road', 'rail', 'air', 'water'],
      valueFromSpec: () => null, kpiVerified: (w, k) => k === 'air', sectorTotalData: () => api, homeSectorPeriod: () => 'Хугацаа: KPI',
      sectorShareFromTotal(keys) { return SHARE.call(this, keys); } });
    const d = D.call(ctx(apiW, 'passengers'), 'road');
    const pct = k => (d.arcs.find(x => x.label === SEC[k].label) || {}).pctText;
    check('ST13. d05 (weekly YTD): төмөр зам 75.0%, агаар 25.0% — авто, ус «—»; «зөвхөн агаар 100%» тайлбар ГАРАХГҮЙ',
      pct('rail') === '75.0%' && pct('air') === '25.0%' && pct('road') === '—' && pct('water') === '—' && !/100% гарч/.test(d.note),
      JSON.stringify(d.arcs.map(x => [x.label, x.pctText])) + ' ' + d.note);
    check('ST14. d05: хугацаа + хэмжүүр нэрлэгдсэн, мэдээгүй салбар жагсаагдсан; идэвхтэй (авто) мэдээгүй бол төвд хамгийн том салбар',
      /2026 оны эхнээс \(01\.01–10\.18\)/.test(d.note) && /зорчигчоор/.test(d.note) && /Авто зам, Ус, далайн тээвэр — мэдээлэл алга/.test(d.note) &&
      d.activeName === 'Төмөр зам' && d.activePctLabel === '75%' && d.hasMeasure && d.measureChips.length === 2, d.note + ' | ' + d.activeName);
    check('ST13. d05 хугацааны мөр (DG-P) = нэгтгэлийн оны эхнээс муж: «2026-01-01 — 2026-10-18 · 291 хоног»',
      d.period === 'Хугацаа: 2026-01-01 — 2026-10-18 · 291 хоног', d.period);
    const dF = D.call(ctx(API, 'freight_tonnes'), 'rail');
    check('ST15. d05 «Ачаа» (weekly алга → сүүлийн оны сарын нэгтгэл): төмөр зам 1700/1704 т',
      (dF.arcs.find(x => x.label === 'Төмөр зам') || {}).pct === (1700 / 1704 * 100).toFixed(1) && /2026 он/.test(dF.note) && /ачаагаар/.test(dF.note),
      JSON.stringify(dF.arcs.map(x => [x.label, x.pct])) + ' ' + dF.note);
    const dL = D.call(Object.assign(ctx(null, 'passengers'), { sectorTotalData: () => null }), 'air');
    check('ST16. Нэгтгэл алга → хуучин зам (registry/KPI) хэвээр, хэмжүүрийн чип гарахгүй',
      !dL.hasMeasure && dL.arcs.find(x => x.label === 'Агаарын тээвэр').pctText === '100.0%');
  }

  /* Холболт ба «Нийтийн тээвэр» салбар хасагдсан (2026-10-21) */
  check('ST17. «Нийтийн тээвэр» салбар бүрмөсөн хасагдсан; нүүрний таб/зурвас/донут/диверг homeSectorKeys()-ээр',
    /const HOME_HIDDEN_SECTORS=\[\];/.test(src) && !/\n  public:\{ label:/.test(src) && /function buildDiverging\(activeKey\)\{\n  const keys=homeSectorKeys\(\);/.test(src) &&
    src.includes('return (keys||homeSectorKeys()).filter(') && src.includes('sectorIcons:homeSectorKeys().map(') &&
    /const keys=homeSectorKeys\(\);\n    \/\*[^\n]*\*\/\n    const key=keys\.indexOf\(this\.state\.activeSector\)>=0/.test(src));
  check('ST18. SECTORS.total — enumerable биш (нүүрний 5 салбарт 6 дахь болж орохгүй), каталог/API-д уншигдана',
    /Object\.defineProperty\(SECTORS,'total',\{enumerable:false/.test(src) && /total:'#6C7BFF'/.test(src) && /total:'📊'/.test(src));
  check('ST19. Датасэт ↔ эх сурвалж ↔ API ↔ түүхий мөр ↔ FL3 холбогдсон',
    /source:'sectorTotal',bind:\{freq:'lastRecord'\},alsoSectors:\['air','rail','road'\]/.test(src) &&
    /sectorTotal:\{label:'[^']+', load:app=>app\.loadSectorTotal\(\)\}/.test(src) &&
    src.includes("['total','GET','/api/sectors/total/history',") && src.includes("sectorTotal:'sector-total'") &&
    src.includes("sectorTotal:{col:'sector_name'}") && src.includes("sector_total:['Салбарын код']") &&
    src.includes("(d.alsoSectors||[]).indexOf(filter)>=0") &&
    /function fetchSectorTotal\(from, to\)[\s\S]*?\/api\/sectors\/total\/history/.test(read('js/erthub-backend.js')));
  const fx = read('tests/lib/feed-fixtures.js');
  check('ST20. Фикстур (?fx=1): /api/sectors/total/history + sector-total түүхий мөр (layout-audit, FL11)',
    fx.includes("'/api/sectors/total/history'") && fx.includes("key === 'sector-total'"));
  /* Харагдах текст бүр content.json-д (text-coverage) */
  const C = readJson('content.json'), TC = (C.site || {}).sector_total || {};
  const ma = src.indexOf('  /* ── Салбарын нэгтгэл (SOURCES.sectorTotal)'), mb = src.indexOf('    base.stYoyJustify=');
  const body = src.slice(ma, mb);
  const missing = [];
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  for (const mm of body.matchAll(/(?:\bT\(|stxt\('sector_total\.)'([a-z_0-9.]+)'/g)) {
    /* динамик зам ('table_head.'+i) — массив, 7 багана */
    if (mm[1].endsWith('.')) { const arr = get(TC, mm[1].slice(0, -1)); if (!Array.isArray(arr) || arr.length !== 7) missing.push(mm[1] + '[7]'); continue; }
    if (get(TC, mm[1]) == null) missing.push(mm[1]);
  }
  check('ST21. Салбарын нэгтгэлийн бүх текст content.json → site.sector_total-д', ma > 0 && mb > ma && missing.length === 0, missing.join(', '));
  check('ST22. content.json: site.datasets-д нэгтгэлийн мөр (sector:"total"), pv_scope.note_sector_total',
    (C.site.datasets || []).some(x => x.sector === 'total') && !!(C.site.pv_scope || {}).note_sector_total);
}

/* ──────────────────────────────── WK 7 ХОНОГИЙН ТАЙЛАН (нэгтгэлээс) ──────────────────────────────── */
/* WK. Нүүрний 02-р хэсэг «7 хоногийн тайлан» (w2p/w2c, w2pb/w2cb, w2px/w2cx) салбарын
   нэгтгэлийн weekly-ээс (2026-10-20). Регресс: донут агаарыг 100% гэж, төмөр замыг
   «мэдээлэл алга» гэж харуулдаг байв. Гараар бодох фикстур (зорчигч):
     10.05–10.11  агаар 100 · төмөр зам 300  = 400
     10.12–10.18  агаар 150 · төмөр зам 350  = 500   → өмнөх 7 хоногоос +25.0%
     оны эхнээс   агаар 1000 · төмөр зам 3000 = 4000 ; өмнөх он 900 + 2300 = 3200 → +25.0%
     донут        агаар 150/500 = 30.0% · төмөр зам 70.0% · авто «—»
     мөр          агаар 150 (+50.0%) · төмөр зам 350 (+16.7%)
   Ачаа: агаар 1 т, төмөр зам 9999 т → агаар 0.01% → «<0.1%» (0.0% биш). */
function groupWK() {
  group('WK. 7 хоногийн тайлан — салбарын нэгтгэлээс (агаар + төмөр зам)');
  const src = dcScript();
  const idx = read('index.html');
  const a = src.indexOf('/* ── САЛБАРЫН НЭГТГЭЛ (sectorTotal)'), b = src.indexOf('/* Зорчигчийн сарын график — ОН/ОУ-ийг ЭЭЛЖ');
  const mB = src.match(/\n    const fmtWeekVal=\(n\)=>\{[\s\S]*?\n    const wPax=buildWeek\(/);
  const mT = src.match(/\n  weekSectorTotal\(wt,widgetId\)\{([\s\S]*?)\n  \}\n/);
  const mA = src.match(/\nfunction weekAxis\(vals\)\{[\s\S]*?\n\}\n/);
  check('WK0. weekSectorReport · weekSectorTotal · buildWeek · weekAxis олдов', a > 0 && b > a && !!(mB && mT && mA));
  if (!(a > 0 && b > a && mB && mT && mA)) return;
  const NEON = { air: '#A', rail: '#R', road: '#D', water: '#W', public: '#P' };
  const L = new Function('NEON', src.slice(a, b) + '\nreturn {weekSectorReport,stPct};')(NEON);
  const wk = (s, e, air, rail, extra) => Object.assign({ week_start: s, week_end: e, missing: false, value: (air || 0) + (rail || 0),
    by_sector: { air: { value: air, days: 7 }, rail: { value: rail, days: 7 } } }, extra || {});
  const PAX = { sectors: ['air', 'rail'], comparable: ['air', 'rail'], stale: [], week_end: '2026-10-18',
    weeks: [wk('2026-10-05', '2026-10-11', 100, 300), wk('2026-10-12', '2026-10-18', 150, 350)],
    ytd: { year: 2026, by_sector: { air: { value: 1000 }, rail: { value: 3000 } } },
    prev_ytd: { year: 2025, by_sector: { air: { value: 900 }, rail: { value: 2300 } } } };
  const CARGO = { sectors: ['air', 'rail'], comparable: ['air', 'rail'], stale: ['rail'], week_end: '2026-10-18',
    weeks: [wk('2026-10-05', '2026-10-11', 2, 9000), wk('2026-10-12', '2026-10-18', 1, 9999)],
    ytd: { year: 2026, by_sector: { air: { value: 40 }, rail: { value: 400000 } } },
    prev_ytd: { year: 2025, by_sector: { air: { value: 40 }, rail: { value: 400000 } } } };
  const API = { status: 'ok', sectors: [], months: [{}], weekly: { passengers: PAX, freight_tonnes: CARGO } };

  /* 1) Цэвэр функц */
  const r = L.weekSectorReport(PAX, ['air', 'rail']);
  check('WK1. weekSectorReport: нийт 500, өмнөх 7 хоногоос +25%, оны эхнээс 4000, өмнөх оны мөн үе +25%, мөр 150/350',
    r.total === 500 && Math.abs(r.wow - 25) < 1e-9 && r.ytd === 4000 && Math.abs(r.yoy - 25) < 1e-9 &&
    r.bySector.air.value === 150 && Math.abs(r.bySector.air.wow - 50) < 1e-9 && Math.abs(r.bySector.rail.wow - (350 / 300 - 1) * 100) < 1e-9 &&
    JSON.stringify(r.weeks.map(x => x.value)) === '[400,500]', JSON.stringify(r));
  const r1 = L.weekSectorReport(PAX, ['air']);
  check('WK2. Зөвхөн бүртгэлтэй салбараар (агаар): нийт 150, оны эхнээс 1000, мөн үе 1000/900',
    r1.total === 150 && r1.ytd === 1000 && Math.abs(r1.yoy - (1000 / 900 - 1) * 100) < 1e-9 && !r1.bySector.rail);
  const pc = Object.assign({}, PAX, { comparable: ['rail'] });
  const r2 = L.weekSectorReport(pc, ['air', 'rail']);
  check('WK3. Өмнөх оны мөн үе ЗӨВХӨН comparable салбараар (төмөр зам 3000/2300)',
    Math.abs(r2.yoy - (3000 / 2300 - 1) * 100) < 1e-9 && JSON.stringify(r2.yoyKeys) === '["rail"]');
  const pm = JSON.parse(JSON.stringify(PAX)); pm.weeks[0].missing = true; pm.weeks[1].by_sector.rail = null;
  const r3 = L.weekSectorReport(pm, ['air', 'rail']);
  check('WK4. Бичлэггүй долоо хоног / салбар → null (0 зохиохгүй), харьцуулалт «—»',
    r3.weeks[0].value === null && r3.total === null && r3.wow === null && r3.bySector.rail.value === null);
  check('WK5. weekly алга / салбар weekly-д алга → null (хуучин зам)',
    L.weekSectorReport(null, ['air']) === null && L.weekSectorReport(PAX, ['road']) === null);
  /* Авто тээвэр (2026-10-21) — эх сурвалж цонхоор: цоорхойтой долоо хоног бүтэн мэт нийлэхгүй.
       10.05–10.11  агаар 100 · төмөр зам 300 · авто 50 (цоорхой 10.07–10.09) → null
       10.12–10.18  агаар 150 · төмөр зам 350 · авто 600            → 1100, авто wow «—» */
  const wkR = (s, e, air, rail, road) => ({ week_start: s, week_end: e, missing: false, value: air + rail + road,
    by_sector: { air: { value: air, days: 7 }, rail: { value: rail, days: 7 }, road: { value: road, days: 7 } } });
  const PAXR = Object.assign({}, PAX, { sectors: ['air', 'rail', 'road'],
    weeks: [wkR('2026-10-05', '2026-10-11', 100, 300, 50), wkR('2026-10-12', '2026-10-18', 150, 350, 600)],
    ytd: { year: 2026, from: '2026-01-01', to: '2026-10-18', by_sector: { air: { value: 1000 }, rail: { value: 3000 }, road: { value: 9000 } } } });
  const GAPS = { road: [{ from: '2026-10-07', to: '2026-10-09' }] };
  const rG = L.weekSectorReport(PAXR, ['air', 'rail', 'road'], GAPS);
  check('WK5a. Авто тээврийн цоорхойтой долоо хоног → null («—»), дараагийн бүтэн долоо хоног 1100; авто wow «—»; gapKeys/ytdGapKeys = road',
    rG.weeks[0].value === null && rG.weeks[1].value === 1100 && rG.total === 1100 && rG.wow === null &&
    rG.bySector.road.value === 600 && rG.bySector.road.prev === null && rG.bySector.road.wow === null &&
    JSON.stringify(rG.gapKeys) === '["road"]' && JSON.stringify(rG.ytdGapKeys) === '["road"]' && rG.ytd === 13000, JSON.stringify(rG));
  const rN = L.weekSectorReport(PAXR, ['air', 'rail', 'road'], null);
  check('WK5b. Цоорхойгүй үед авто тээвэр нийлбэрт орно: 450 → 1100 (+144.4%), gapKeys хоосон',
    rN.weeks[0].value === 450 && rN.total === 1100 && Math.abs(rN.wow - (1100 / 450 - 1) * 100) < 1e-9 && rN.gapKeys.length === 0);

  /* 2) buildWeek — сайтын бодит код, гараар бодох фикстур дээр */
  const WSTAT = (x) => [['Оны эхнээс', 'count'], ['Өмнөх 7 хоног', 'pct'], ['Өмнөх оны мөн үе', 'pct'], [x, 'count']];
  const WD = (x) => ({ unit: 'мянган', total: '—', bar: [], color: '#B',
    donut: { labels: ['Агаарын тээвэр', 'Авто тээвэр', 'Төмөр зам'], data: [0, 0, 0], colors: ['#1', '#2', '#3'] },
    stats: WSTAT(x), plan: { label: '', pct: 0 } });
  const SECTORS = { air: { label: 'Агаарын тээвэр' }, road: { label: 'Авто зам' }, rail: { label: 'Төмөр зам' },
    water: { label: 'Ус, далайн тээвэр' }, public: { label: 'Нийтийн тээвэр' } };
  const GLYPH = { air: 'a', road: 'd', rail: 'r', water: 'w', public: 'p' };
  const SECTOR_DELTA = { pax: ['road', 'rail', 'air', 'water'].map(k => [k, '—', '', 0]), cargo: ['road', 'rail', 'air', 'water'].map(k => [k, '—', '', 0]) };
  const weekAxis = new Function(mA[0] + '\nreturn weekAxis;')();
  const G = require(path.join(ROOT, 'js', 'erthub-glossary.js'));
  const mk = new Function('WEEK_LABELS', 'weekAxis', 'stxt', 'EHChart', 'EHGlossary', 'SECTORS', 'GLYPH', 'NEON', 'SECTOR_DELTA', 'stPct', 'weeklyAir', 'chartPeriodText',
    'return function(){' + mB[0].replace(/\n    const wPax=buildWeek\($/, '') + '\nreturn buildWeek;}');
  const wst = new Function('weekSectorReport', 'return function(wt,widgetId){' + mT[1] + '}')(L.weekSectorReport);
  const REGQ = { w2p: ['air', 'rail'], w2pb: ['air', 'rail'], w2px: ['air', 'rail'], w2c: ['air', 'rail'], w2cb: ['air', 'rail'], w2cx: ['air', 'rail'] };
  const ctx = (api, regq, spec) => ({
    valueSpecRaw: () => spec || null, lastFullWeekWindow: () => null, weekFlightsSum: () => null, txt: () => '',
    planQuality: () => ({ quality: 'none', label: 'мэдээлэл алга' }), sectorHidden: () => false,
    sectorQuality: (id, k) => ((regq[id] || []).includes(k) ? { quality: 'verified' } : { quality: 'none', label: 'мэдээлэл алга' }),
    sectorTotalData: () => api, weekSectorTotal: wst });
  const AIR = { pax: 1234, cargo: 5, paxDeltaPct: 5, cargoDeltaPct: -2, dailyPax: [1, 2, 3, 4, 5, 6, 7], dailyCargo: [1, 1, 1, 1, 1, 1, 1],
    dailyLabels: ['10.12', '10.13', '10.14', '10.15', '10.16', '10.17', '10.18'] };
  /* DG-P: сайтын chartPeriodText (нэгтгэлд долоо хоногийн цуваа → «N долоо хоног») */
  const cptWK = read('index.html').match(/\nfunction chartPeriodText\(m,T\)\{([\s\S]*?)\n\}/);
  const CPTWK = (m, T) => new Function('EHGlossary', 'm', 'T', cptWK[1])(G, m, T);
  const BW = (api, regq, air, spec) => mk(['x'], weekAxis, (p, x) => x, { accessor: () => (f) => f.pax }, G, SECTORS, GLYPH, NEON, SECTOR_DELTA, L.stPct, air, CPTWK)
    .call(ctx(api, regq, spec));
  const P = BW(API, REGQ, AIR)('pax', WD('Тээвэрлэгч'), 'w2p', 'w2px');
  const sh = k => P.share.find(x => x.label === k), dl = k => P.delta.find(x => x.label === SECTORS[k].label);
  check('WK6. Нийт дүн = агаар + төмөр зам (500), нэгж «хүн», тайлбар долоо хоног + салбаруудыг нэрлэнэ',
    P.total === '500' && P.unit === 'хүн' && /10\.12–10\.18/.test(P.airOnlyNote) && /Агаарын тээвэр \+ Төмөр зам/.test(P.airOnlyNote), P.total + ' | ' + P.airOnlyNote);
  check('WK7. Донут/share (регресс): агаар 30.0%, төмөр зам 70.0%, авто «—»; «зөвхөн агаар 100%» тайлбар ГАРАХГҮЙ',
    sh('Агаарын тээвэр').pctText === '30.0%' && sh('Төмөр зам').pctText === '70.0%' && sh('Авто тээвэр').pctText === '—' &&
    sh('Төмөр зам').tip === 'Төмөр зам — 350 (70.0%)' && P.shareNote === '', JSON.stringify(P.share.map(x => [x.label, x.pctText])) + ' ' + P.shareNote);
  check('WK8. Статистик: оны эхнээс 4.0K, өмнөх 7 хоног +25.0%, өмнөх оны мөн үе +25.0%; тээвэрлэгч — нэгтгэлд алга',
    P.stats[0].v === '4.0K' && P.stats[1].v === '+25.0%' && P.stats[2].v === '+25.0%' && P.stats[2].mockTag === '' &&
    /мэдээлэл алга/.test(P.stats[3].mockTag), JSON.stringify(P.stats));
  check('WK9. Харьцуулалтын мөр: төмөр зам 350 (+16.7%), агаар 150 (+50.0%) — нийт дүнтэй нэг цонх; авто «мэдээлэл алга»',
    dl('rail').value === '350' && dl('rail').delta === '+16.7%' && dl('air').value === '150' && dl('air').delta === '+50.0%' &&
    /мэдээлэл алга/.test(dl('road').mockTag) && dl('rail').mockTag === '', JSON.stringify(P.delta.map(x => [x.label, x.value, x.delta, x.mockTag])));
  check('WK10. Багана = 8 хүртэлх долоо хоногийн нийт: утга, огноо (Да), tooltip «хүрээ — утга нэгж», тэнхлэгт «долоо хоногийн эхний өдөр»',
    JSON.stringify(P.bars.map(x => [x.label, x.value])) === '[["10.05","400"],["10.12","500"]]' &&
    P.bars[1].tip === '10.12–10.18 — 500 хүн' && P.bars[1].isPeak && /долоо хоногийн эхний өдөр/.test(P.base) && /дундаж 450/.test(P.avgRef.label),
    JSON.stringify(P.bars) + ' ' + P.base);
  check('WK10. Хугацааны мөр (DG-P) = баганын долоо хоногууд: «· 2 долоо хоног» (хоногийн тоо биш)',
    /^Хугацаа: \d{4}-10-05 — \d{4}-10-18 · 2 долоо хоног$/.test(P.period), P.period);
  const P1 = BW(API, Object.assign({}, REGQ, { w2p: ['air'], w2px: ['air'] }), AIR)('pax', WD('Тээвэрлэгч'), 'w2p', 'w2px');
  check('WK11. Бүртгэлээс төмөр замыг салгавал (w2p/w2px) нийт = агаар 150, мөр «мэдээлэл алга» — админ ба сайт нэг дүрэм',
    P1.total === '150' && /мэдээлэл алга/.test(P1.delta.find(x => x.label === 'Төмөр зам').mockTag) && /Зөвхөн агаар/.test(P1.airOnlyNote),
    P1.total + ' ' + P1.airOnlyNote);
  const C = BW(API, REGQ, AIR)('cargo', WD('Чиглэл'), 'w2c', 'w2cx');
  check('WK12. Ачаа: агаар 1/10000 т → «<0.1%» (0.0% биш), нэгж «тонн», дутуу салбарыг тайлбарт нэрлэнэ',
    C.share[0].pctText === '<0.1%' && C.unit === 'тонн' && C.total === '10.0K' && /Төмөр зам — сүүлийн 7 хоногийн мэдээ дутуу/.test(C.airOnlyNote),
    JSON.stringify(C.share.map(x => x.pctText)) + ' ' + C.airOnlyNote);
  const O = BW(null, REGQ, AIR)('pax', WD('Тээвэрлэгч'), 'w2p', 'w2px');
  check('WK13. Нэгтгэл алга → ЯГ хуучин агаарын зам: 1.2K, өдрийн 7 багана, агаар 100% + ил тайлбар',
    O.total === '1.2K' && O.bars.length === 7 && O.bars[0].label === '10.12' && O.share[0].pctText === '100.0%' && /100%/.test(O.shareNote) &&
    O.stats[1].v === '+5.0%' && /Зөвхөн агаар/.test(O.airOnlyNote), JSON.stringify([O.total, O.bars.length, O.shareNote]));
  check('WK14. Нэгтгэл алга ч бүртгэлд төмөр зам verified → «+0.0%» ЗОХИОХГҮЙ, «0 · мэдээлэл алга»',
    O.delta.find(x => x.label === 'Төмөр зам').delta === '—' && /мэдээлэл алга/.test(O.delta.find(x => x.label === 'Төмөр зам').mockTag),
    JSON.stringify(O.delta));
  const S = BW(API, REGQ, AIR, { dataset: 'air_flights', measure: 'pax' })('pax', WD('Тээвэрлэгч'), 'w2p', 'w2px');
  check('WK15. Утгын тохиргоо (агаарын хэмжигдэхүүн) сонгосон бол нэгтгэлийн горим ИДЭВХГҮЙ (хуучин зам)',
    S.bars.length === 7 && !/долоо хоногийн эхний өдөр/.test(S.base));

  /* 3) Админы preview — сайттай НЭГ эх сурвалж, нэг дүрэм */
  const adm = adminScript();
  const sa = adm.indexOf('var ST={state:'), sb = adm.indexOf('/* Сайтын sectorSummaryToSeries()-ийн толь');
  const fA = adm.match(/\nfunction loadSectorTotalWeekly\(\)\{[\s\S]*?\n\}\n[\s\S]*?\nfunction stWeeklySeries\(id\)\{[\s\S]*?\n\}\n/);
  check('WK16. Админ: нэгтгэлийг ачаална (loadSectorTotalWeekly), 4 метрик ST_METRIC-д', sa > 0 && !!fA &&
    /Promise\.all\(\[loadFeed\(\),[^\]]*loadSectorTotalWeekly\(\)\]\)/.test(adm) && /'rail\.weekly_pax':\['passengers','rail'\]/.test(adm) &&
    /'rail\.weekly_cargo':\['freight_tonnes','rail'\]/.test(adm));
  if (sa > 0 && fA) {
    const decl = adm.slice(sa, adm.indexOf('\n', adm.indexOf("'road.weekly_pax':['passengers','road']")) + 1);
    const env = new Function('parts', 'spec', decl + fA[0] +
      '\nfunction sectorParts(){return parts}\nfunction valueSpecOf(){return spec}\nST.weekly=arguments[2];ST.gaps=arguments[3]||null;ST.state="ready";' +
      '\nreturn {stWeek:stWeek,stWeekVal:stWeekVal,stWeeklySeries:stWeeklySeries};');
    const parts = [{ k: 'air', q: 'verified', m: 'air.weekly_pax' }, { k: 'rail', q: 'verified', m: 'rail.weekly_pax' }, { k: 'road', q: 'none', m: null }];
    const E = env(parts, null, API.weekly);
    const ser = E.stWeeklySeries('w2p');
    const lastRail = E.stWeekVal(API.weekly.passengers.weeks[1], 'rail');
    check('WK17. Админы preview = сайт: багана [400, 500] (10.05, 10.12), төмөр зам 350 — ижил фикстур',
      JSON.stringify(ser) === JSON.stringify([{ label: '10.05', v: 400 }, { label: '10.12', v: 500 }]) && lastRail === 350, JSON.stringify(ser));
    /* Эх сурвалжийн цоорхой — сайтын weekSectorReport(gaps)-тэй ИЖИЛ: 10.05 долоо хоног цоорхойд орвол алгасна */
    const E3 = env(parts.slice(0, 1), null, API.weekly, { air: [{ from: '2026-10-07', to: '2026-10-08' }] });
    check('WK18a. Админ: цоорхойтой долоо хоног preview-д ч алгасагдана (сайттай ижил); road.weekly_pax ST_METRIC-д',
      E3.stWeekVal(API.weekly.passengers.weeks[0], 'air') === null && E3.stWeekVal(API.weekly.passengers.weeks[1], 'air') === 150 &&
      /'road\.weekly_pax':\['passengers','road'\]/.test(adm) && /fetchRoadPassengersHistory/.test(fA[0]));
    const E2 = env(parts.slice(0, 1), null, API.weekly);
    check('WK18. Админ: төмөр замын слотыг салгавал багана ӨӨРЧЛӨГДӨНӨ [100, 150]; утгын тохиргоотой бол нэгтгэлийн цуваа алга',
      JSON.stringify(E2.stWeeklySeries('w2p').map(x => x.v)) === '[100,150]' && env(parts, { measure: 'pax' }, API.weekly).stWeeklySeries('w2p') === null);
  }
  /* 4) Бүртгэл — гурван виджетийн бүлэг төмөр замтай */
  const R = readJson('metric_registry.json');
  const ok = (id, k, m) => { const s = (R.widgets[id].sectors || {})[k]; return !!s && s.quality === 'verified' && s.metric === m; };
  check('WK19. Registry: w2p/w2px/w2pb.rail = rail.weekly_pax, w2c/w2cx/w2cb.rail = rail.weekly_cargo (verified), авто зорчигч road.weekly_pax (2026-10-21), авто ачаа none; метрик тодорхойлолттой, салбар хооронд нэмэгдэнэ (additive — админы grain анхааруулга гарахгүй)',
    ['w2p', 'w2px', 'w2pb'].every(id => ok(id, 'rail', 'rail.weekly_pax')) && ['w2c', 'w2cx', 'w2cb'].every(id => ok(id, 'rail', 'rail.weekly_cargo')) &&
    ['w2p', 'w2px', 'w2pb'].every(id => ok(id, 'road', 'road.weekly_pax')) && R.widgets.w2cb.sectors.road.quality === 'none' && !R.widgets.w2pb.sectors.other &&
    R.metrics['rail.weekly_pax'].unit === R.metrics['air.weekly_pax'].unit && R.metrics['rail.weekly_cargo'].unit === R.metrics['air.weekly_cargo'].unit &&
    ['air.weekly_pax', 'air.weekly_cargo', 'rail.weekly_pax', 'rail.weekly_cargo', 'road.weekly_pax'].every(k => R.metrics[k].additive === true));
  const CJ = readJson('content.json');
  check('WK20. content.json: site.week.axis_weeks / sectors_note ({from},{to},{names}) / stale_note, ui.preview.weekly',
    /\{from\}/.test(CJ.site.week.sectors_note || '') && /\{names\}/.test(CJ.site.week.sectors_note) && /\{names\}/.test(CJ.site.week.stale_note || '') &&
    !!CJ.site.week.axis_weeks && !!CJ.ui.preview.weekly);
  check('WK21. Темплейт: 7 хоногийн багана бүрт <title> tooltip (HV)', (idx.match(/barGrow \.6s var\(--ease\) both;"><title>\{\{ wb\.tip \}\}<\/title>/g) || []).length === 2);
}

/* ──────────────────────────────── АЖИЛЛУУЛАХ ──────────────────────────────── */
console.log('ErtHub — систем тест');
(async () => {
  /* --only=Z — нэг бүлгийг хурдан давтах (хөгжүүлэлтийн үед). Commit-ийн
     өмнө ЗААВАЛ бүтнээр нь ажиллуулна. */
  if (process.argv.includes('--only=BE')) { await groupBE(); }
  else if (process.argv.includes('--only=VIS')) { await groupVIS(); }
  else if (process.argv.includes('--only=HV')) { await groupHV(); }
  else if (process.argv.includes('--only=OD')) { await groupOD(); }
  else if (process.argv.includes('--only=FM')) { await groupFM(); }
  else if (process.argv.includes('--only=G')) { await groupG(); await groupG3(); await groupG4(); }
  else if (process.argv.includes('--only=G4')) { await groupG4(); }
  else if (process.argv.includes('--only=AI')) { await groupAI(); }
  else if (process.argv.includes('--only=VR')) { await groupVR(); }
  else if (process.argv.includes('--only=I')) { groupI(); }
  else if (process.argv.includes('--only=AX')) { groupAX(); }
  else if (process.argv.includes('--only=N')) { await groupN(); }
  else if (process.argv.includes('--only=Y')) { await groupY(); }
  else if (process.argv.includes('--only=F')) { await groupF(); }
  else if (process.argv.includes('--only=I2')) { await groupI2(); }
  else if (process.argv.includes('--only=I3')) { await groupI3(); }
  else if (process.argv.includes('--only=SP')) { groupSP(); }
  else if (process.argv.includes('--only=HS')) { groupHS(); }
  else if (process.argv.includes('--only=DG')) { groupDG(); await groupDGP(); await groupDGA(); }
  else if (process.argv.includes('--only=FL')) { await groupFL(); }
  else if (process.argv.includes('--only=AF')) { await groupAF(); }
  else if (process.argv.includes('--only=UI')) { groupUI(); }
  else if (process.argv.includes('--only=FR')) { groupFR(); }
  else if (process.argv.includes('--only=ST')) { groupST(); }
  else if (process.argv.includes('--only=WK')) { groupWK(); }
  else if (process.argv.includes('--only=RPX')) { groupRPX(); }
  else if (process.argv.includes('--only=RI')) { await groupRI(); }
  else if (process.argv.includes('--only=DA')) { await groupDA(); }
  else if (process.argv.includes('--only=Z')) { await groupZ(); await groupZ2(); await groupZ3(); await groupZ4(); await groupZ5(); }
  else {
  groupA(); groupB(); await groupC(); groupD(); groupE(); await groupF(); await groupG(); await groupG3(); await groupG4(); await groupH();
  groupI(); groupAX(); await groupI2(); await groupI3(); await groupI4(); await groupJ(); await groupK(); await groupL(); await groupM(); await groupN(); await groupO(); groupP(); groupQ(); groupR(); await groupS(); await groupU(); await groupW(); await groupX(); await groupY(); await groupZ(); await groupZ2(); await groupZ3(); await groupZ4(); await groupZ5(); await groupBE(); await groupAI(); await groupVR(); await groupOD(); await groupFM(); groupSP(); groupHS(); groupDG(); await groupFL(); groupUI(); groupFR(); groupST(); await groupDGP(); await groupDGA(); groupWK(); groupRPX(); await groupRI(); await groupDA(); await groupAF(); await groupHV(); await groupVIS();
  }

  console.log('\n' + '═'.repeat(62));
  console.log('НИЙТ:  PASS ' + pass + '  ·  FAIL ' + fail + '  ·  SKIP ' + skip);
  if (failures.length) {
    console.log('\nУНАСАН ТЕСТ:');
    failures.forEach(f => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
})();

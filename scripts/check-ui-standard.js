#!/usr/bin/env node
'use strict';
/* ErtHub — UI СТАНДАРТЫН СТАТИК ШАЛГАГЧ (секундын, браузергүй).

   Яагаад: "датасэт бүрийг агаарын тээврийн хүснэгт шиг харуул", "нэг мөрийн
   чарт/карт ижил өндөртэй" гэсэн шаардлагыг хэрэглэгч хуудас, таск бүрт дахин
   дахин хэлэх болсон (2026-10-15: зорчигчийн галт тэрэгний хүснэгт 560/1240px,
   198px donut | 964px жагсаалт). Дүрэм зөвхөн CLAUDE.md-д бичигдсэн байхад
   шинэ хуудас/датасэт нэмэх бүрд мартагдаж байв — энэ скрипт commit бүрд
   (CI `checks` job) зөрчлийг ШУУД унагана.

   Дүрмүүд (CLAUDE.md → "UI стандарт (UI) — ЗААВАЛ"):
     TBL0  index.html-д гараар бичсэн <table>/<sc-raw-table> БАЙХГҮЙ — датасэтийн
           хүснэгт бүр buildPreview() → detail.pv* нэг бүрэлдэхүүнээр зурагдана.
     TBL1  Хүснэгтийн дотор хайрцаг [data-eh-table] min-width:100% (картын өргөнийг
           дүүргэнэ), багана нь minmax(Npx,1fr).
     TBL2  Нүд бүр fmtTableCell()-ээр (тоо мянгатын тусгаарлагчтай, баруун зэрэгцүүлэлт).
     TBL3  DS_SCHEMA-ийн баганын төрөл зөвхөн зөвшөөрөгдсөн жагсаалтаас.
     ROW1  Карт зэрэгцүүлдэг мөр (зөвхөн fr баганатай, ≥2 багана) align-items:start
           БИШ — stretch (+ class="eh-row"). Зориудын үл хамаарал: data-row-ok="шалтгаан".
     ORD1  Датасэтийн хуудасны дараалал: KPI → «…-ийн жагсаалт» хүснэгт → график
           (вагон/зорчигчийн графикийн блок хүснэгтийн ДАРАА).
     ORD2  Чанарын үнэлгээ (data-ddq-block) хүснэгт ба бүх графикийн ДАРАА — хамгийн сүүлд.

   Ашиглалт: node scripts/check-ui-standard.js   (алдаатай бол exit 1) */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/* EH_UI_FILE — тест (tests/run.js UI бүлэг) зориуд эвдсэн хуулбар дээр шалгагчийг өөрийг нь шалгана */
const html = fs.readFileSync(process.env.EH_UI_FILE || path.join(ROOT, 'index.html'), 'utf8').split('\r\n').join('\n');
const lines = html.split('\n');
const errs = [];
const bad = (rule, line, msg) => errs.push({ rule, line, msg });
const lineOf = (idx) => html.slice(0, idx).split('\n').length;

/* TBL0 — гараар бичсэн хүснэгт */
lines.forEach((l, i) => {
  if (/<sc-raw-table\b|<table\b/i.test(l) && !/data-table-ok=/.test(l)) {
    bad('TBL0', i + 1, 'гараар бичсэн хүснэгт — датасэтийн хүснэгт бүр detail.pv* стандарт бүрэлдэхүүнээр (агаарын хүснэгт шиг) байх ёстой');
  }
});

/* TBL1 — хүснэгт картын өргөнийг дүүргэнэ */
const tblBox = lines.findIndex((l) => /data-eh-table=/.test(l));
if (tblBox < 0) bad('TBL1', 0, '[data-eh-table] хайрцаг олдсонгүй (layout-audit table-underfill үүгээр шалгадаг)');
else if (!/min-width:100%/.test(lines[tblBox])) bad('TBL1', tblBox + 1, '[data-eh-table] нь min-width:100% биш — цөөн баганатай хүснэгт хагас өргөнд унжина');
if (!/grid-template-columns:'\+colWidths\.map\(w=>'minmax\('\+w\+'px,1fr\)'\)/.test(html)) {
  bad('TBL1', 0, 'buildPreview-ийн багана minmax(Npx,1fr) биш — хүснэгт картын өргөнийг дүүргэхгүй');
}

/* TBL2 — нүдний формат */
if (!/cells:r\.slice\(0,-1\)\.map\(\(c,ci\)=>\(\{v:fmtTableCell\(c,types\[ci\]\)/.test(html)) {
  bad('TBL2', 0, 'хүснэгтийн нүд fmtTableCell()-ээр форматлагдахгүй байна (104092 → 104,092)');
}

/* TBL3 — баганын төрөл */
const TYPES = ['int', 'float', 'pct', 'pctchg', 'date', 'month', 'string', 'enum'];
const ds = html.slice(html.indexOf('const DS_SCHEMA={'));
const dsBlock = ds.slice(0, ds.indexOf('\n};'));
let m; const re = /types:\[([^\]]*)\]/g;
while ((m = re.exec(dsBlock))) {
  m[1].split(',').map((t) => t.trim().replace(/'/g, '')).filter(Boolean).forEach((t) => {
    if (TYPES.indexOf(t) < 0) bad('TBL3', lineOf(html.indexOf(dsBlock) + m.index), 'DS_SCHEMA-д танигдаагүй баганын төрөл «' + t + '» (зөвшөөрөгдсөн: ' + TYPES.join(', ') + ')');
  });
}

/* ROW1 — карт зэрэгцүүлдэг мөр stretch байх */
const frOnly = (cols) => {
  const toks = []; let depth = 0, cur = '';
  for (const ch of cols) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && depth === 0) { if (cur) toks.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) toks.push(cur);
  return toks.length >= 2 && toks.every((t) => /^(\d*\.?\d+fr|minmax\(0,\s*\d*\.?\d+fr\))$/.test(t));
};
lines.forEach((l, i) => {
  if (!/display:grid/.test(l) || !/align-items:start/.test(l) || /data-row-ok=/.test(l)) return;
  const c = l.match(/grid-template-columns:([^;"]+)/);
  if (c && frOnly(c[1].trim())) {
    bad('ROW1', i + 1, 'карт зэрэгцүүлдэг мөр align-items:start — нэг мөрийн картууд ИЖИЛ өндөртэй байх ёстой (stretch + class="eh-row", урт жагсаалт → eh-fill-scroll)');
  }
});

/* ORD1 — дараалал: хүснэгт → график */
const pvAt = html.indexOf('{{ detail.pvTitle }}');
['data-wagon-charts', 'data-pax-charts', 'data-sector-charts'].forEach((k) => {
  const at = html.indexOf(k + '="1"');
  if (at < 0) bad('ORD1', 0, k + ' блок олдсонгүй');
  else if (pvAt < 0 || at < pvAt) bad('ORD1', lineOf(at), k + ' нь датасэтийн хүснэгтийн ӨМНӨ байна — дараалал KPI → хүснэгт → график (агаар шиг)');
});
/* ORD2 — чанарын үнэлгээ хамгийн сүүлд: хүснэгт ба БҮХ графикийн дараа */
const tpl = html.slice(0, Math.max(0, html.indexOf('<script type="text/x-dc"')) || html.length); // зөвхөн темплейт — JS тайлбар дахь {{ }}-ийг тоолохгүй
const dqAt = tpl.indexOf('data-ddq-block="1"');
if (dqAt < 0) bad('ORD2', 0, 'data-ddq-block блок олдсонгүй');
else {
  ['{{ detail.pvTitle }}', 'data-wagon-charts="1"', 'data-pax-charts="1"', 'data-sector-charts="1"', '{{ detail.dstrTitle }}', '{{ detail.daiTitle }}'].forEach((k) => {
    const at = tpl.lastIndexOf(k);
    if (at > dqAt) bad('ORD2', lineOf(dqAt), 'чанарын үнэлгээ «' + k + '»-ийн ӨМНӨ байна — дараалал KPI → хүснэгт → график → чанарын үнэлгээ');
  });
}

if (!errs.length) {
  console.log('UI стандарт: OK (TBL0–TBL3, ROW1, ORD1–ORD2)');
  process.exit(0);
}
errs.forEach((e) => console.log('  ✗ [' + e.rule + '] index.html' + (e.line ? ':' + e.line : '') + ' — ' + e.msg));
console.log('\nUI стандарт: ' + errs.length + ' зөрчил. Дүрэм: CLAUDE.md → "UI стандарт (UI) — ЗААВАЛ"');
process.exit(1);

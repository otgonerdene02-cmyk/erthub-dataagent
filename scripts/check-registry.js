#!/usr/bin/env node
// Нүүр хуудасны виджет бүр metric_registry.json-д ямар нэг бүртгэлтэй эсэхийг
// шалгана. metric_registry.json ГАНЦААРАА үнэний эх сурвалж — өмнө нь
// known_incomplete.json гэдэг хоёр дахь файлтай байсан ч энэ нь "хоёр
// vнэний эх сурвалж" зөрчил vvсгэсэн тул нэгтгэсэн (mock виджет ч энд
// quality:"mock" гэж шууд бүртгэгдэнэ, тусдаа файл шаардахгүй).
//
// Виджетийн "бvрэн жагсаалт" эх сурвалж нь content.json (page:"Нvvр" гэсэн
// талбараар шvvнэ) — index.html-ээс val()/applyRealFlightsData хэрэглээг
// автоматаар мэдрэх нь найдвартай бvтэц шинжлэл шаардах тул (олон янзын
// холболтын хэлбэр: val(), SECTORS шууд унших, RECENT+bindCard, TREND+
// compareWindow) хийгдэхгvй байна.
//
// Дvрэм:
//   1) registry-д огт байхгvй                → АЛДАА (exit 1)
//   2) registry-д байгаа, quality:"mock"      → мэдээлэл (exit 0)
//   3) registry-д байгаа, quality:"verified"  → OK (exit 0)
//   4) registry-д байгаа боловч content.json-ий Нvvр хуудсанд олдохгvй
//      (хуучирсан бичлэг) → АНХААРУУЛГА (exit 1)
//
// Ашиглалт: node scripts/check-registry.js
'use strict';
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const content = JSON.parse(fs.readFileSync(path.join(repoRoot, 'content.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'metric_registry.json'), 'utf8'));

const homeWidgets = Object.entries(content.widgets)
  .filter(([, w]) => w.page === 'Нүүр')
  .map(([id]) => id);

const widgets = registry.widgets || {};
const registryWidgets = Object.keys(widgets);

// Виджетийн бичлэгийн хэлбэр өөр өөр байж болно (top-level metric+sectors
// массив; sectors обьект дотор салбар тус бүрийн quality; эсвэл valid:false
// блоклогдсон) — иймд нэг "quality" шошго тооцоолж мэдээлнэ, гэхдээ
// шийдвэр (missing эсэх) үүнээс хамаарахгүй.
function describeQuality(w) {
  if (w.valid === false) return 'blocked';
  if (typeof w.quality === 'string') return w.quality;
  if (w.sectors && !Array.isArray(w.sectors)) {
    const quals = Object.values(w.sectors).map((s) => s.quality);
    const verifiedN = quals.filter((q) => q === 'verified').length;
    return 'mixed (' + verifiedN + '/' + quals.length + ' verified)';
  }
  if (w.metric) return 'verified';
  return 'unknown';
}

const missing = homeWidgets.filter((id) => !registryWidgets.includes(id));
const stale = registryWidgets.filter((id) => !homeWidgets.includes(id));
const present = homeWidgets.filter((id) => registryWidgets.includes(id));

let ok = true;

if (missing.length) {
  ok = false;
  console.error('');
  console.error('REGISTRY-Д БҮРТГЭГДЭЭГҮЙ ' + missing.length + ' ВИДЖЕТ:');
  for (const id of missing) console.error('  - ' + id);
  console.error('');
  console.error('Verified эсвэл mock — аль нь ч байсан metric_registry.json-д');
  console.error('ямар нэг бичлэгтэй байх ёстой (mock бол {"quality":"mock",');
  console.error('"metric":null,"would_need":"..."}).');
}

if (present.length) {
  console.log('Бүртгэгдсэн ' + present.length + ' виджет:');
  for (const id of present) {
    console.log('  - ' + id + ': ' + describeQuality(widgets[id]));
  }
}

if (stale.length) {
  ok = false;
  console.error('');
  console.error('REGISTRY-Д БАЙГАА БОЛОВЧ content.json-ий Нүүр хуудсанд ОЛДСОНГҮЙ ' + stale.length + ':');
  for (const id of stale) console.error('  - ' + id);
  console.error('');
  console.error('Виджет нэр өөрчлөгдсөн эсвэл устгагдсан байж болзошгүй — шалгана уу.');
}

if (ok) {
  console.log('');
  console.log('OK: ' + homeWidgets.length + ' Нүүр хуудасны виджет бүгд registry-д бүртгэлтэй.');
  process.exit(0);
} else {
  process.exit(1);
}

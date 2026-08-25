#!/usr/bin/env node
// Нүүр хуудасны виджет бүр metric_registry.json-д ямар нэг бүртгэлтэй эсэхийг
// шалгана (verified ч, mock ч — ямар ч төлөвтэй байсан хамаагүй, ЗӨВХӨН
// БҮРТГЭГДЭЭГҮЙ байх нь алдаа). H4 үед k04/ls код дээр бодитоор холбогдсон
// хойно registry-д бүртгэхээ мартсан тохиолдол давтагдахаас сэргийлж үүсгэв.
//
// Виджетийн "бүрэн жагсаалт" эх сурвалж нь content.json (page:"Нүүр" гэсэн
// талбараар шүүнэ) — index.html-ээс val()/applyRealFlightsData хэрэглээг
// автоматаар мэдрэх нь найдвартай бүтэц шинжлэл шаардах тул (олон янзын
// холболтын хэлбэр: val(), SECTORS шууд унших, RECENT+bindCard, TREND+
// compareWindow) хийгдэхгүй байна — оронд нь "үүрэг хүлээсэн бүх виджет
// эцэст нь registry-д ямар нэг бичлэгтэй байх ёстой" гэсэн энгийн, гэхдээ
// бүрэн шалгагдах боломжтой дүрмийг ашиглав.
//
// scripts/known_incomplete.json — зориудаар одоохондоо бүртгэгдээгүй
// (эх сурвалжгүй mock) виджетүүдийн жагсаалт. Дүрэм 3:
//   1) registry-д байхгүй + known_incomplete-д байхгүй → АЛДАА (exit 1)
//   2) registry-д байхгүй + known_incomplete-д байгаа   → мэдээлэл (exit 0)
//   3) known_incomplete-д байгаа + registry-д ч бүртгэгдсэн → АНХААРУУЛГА
//      (known_incomplete.json-оос хасаагүй нь хуучирсан гэсэн үг)
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

const registryWidgets = Object.keys(registry.widgets || {});

const knownIncompletePath = path.join(__dirname, 'known_incomplete.json');
const knownIncompleteRaw = fs.existsSync(knownIncompletePath)
  ? JSON.parse(fs.readFileSync(knownIncompletePath, 'utf8'))
  : { widgets: {} };
const knownIncomplete = knownIncompleteRaw.widgets || {};

// Бүртгэлийн бүрэн бүтэн байдал: reason/would_need хоосон бол алдаа
// (тодорхойгүй бол "тодорхойгүй" гэж бичих ёстой, хоосон биш).
const malformed = Object.entries(knownIncomplete).filter(
  ([, v]) => !v.reason || !v.would_need
);

const missingAll = homeWidgets.filter((id) => !registryWidgets.includes(id));
const missing = missingAll.filter((id) => !(id in knownIncomplete));
const expectedIncomplete = missingAll.filter((id) => id in knownIncomplete);
const stale = registryWidgets.filter((id) => !homeWidgets.includes(id));
const nowRegistered = Object.keys(knownIncomplete).filter((id) => registryWidgets.includes(id));

let ok = true;

if (missing.length) {
  ok = false;
  console.error('');
  console.error('REGISTRY-Д БҮРТГЭГДЭЭГҮЙ, ЗОРИУДААР ҮЛДЭЭГДЭЭГҮЙ ' + missing.length + ' ВИДЖЕТ:');
  for (const id of missing) console.error('  - ' + id);
  console.error('');
  console.error('Verified эсвэл mock — аль нь ч байсан metric_registry.json-д');
  console.error('ямар нэг бичлэгтэй байх ёстой, эсвэл зориуд үлдээж байгаа бол');
  console.error('scripts/known_incomplete.json-д {reason, would_need}-тэй нэм.');
}

if (malformed.length) {
  ok = false;
  console.error('');
  console.error('known_incomplete.json дутуу бичлэгтэй ' + malformed.length + ':');
  for (const [id] of malformed) console.error('  - ' + id + ' (reason/would_need дутуу — "тодорхойгүй" гэж ч болно, хоосон болохгүй)');
}

if (expectedIncomplete.length) {
  console.log('Мэдэгдэж буй, зориудаар үлдээсэн ' + expectedIncomplete.length + ' виджет (алдаа биш):');
  for (const id of expectedIncomplete) {
    console.log('  - ' + id + ': ' + knownIncomplete[id].reason);
  }
}

if (nowRegistered.length) {
  ok = false;
  console.error('');
  console.error('АНХААРУУЛГА: known_incomplete.json-д байгаа боловч registry-д аль хэдийн бүртгэгдсэн ' + nowRegistered.length + ':');
  for (const id of nowRegistered) console.error('  - ' + id + ' — known_incomplete.json-оос хас (хуучирсан).');
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
  console.log('OK: ' + homeWidgets.length + ' Нүүр хуудасны виджет бүгд registry эсвэл known_incomplete.json-д бүртгэлтэй.');
  process.exit(0);
} else {
  process.exit(1);
}

#!/usr/bin/env node
// check-cyrillic.js-ийн олсон "mixed-token" зөрчлийг АВТОМАТААР засах туслах
// скрипт — зөвхөн Латин "v"/"V" -> Кирилл "ү"/"Ү" сольдог, учир нь бодит
// сешнд илэрсэн бараг бүх тохиолдол яг энэ нэг загвартай байсан (Кирилл
// "ү" бичихдээ Латин "v" дарагдсан).
//
// АЮУЛГҮЙ БАЙДЛЫН 2 ХЯЗГААРЛАЛТ:
//   1) Токен дотор "v"/"V"-с ӨӨР Латин үсэг үлдвэл (жиш. "Vue", "view",
//      "val" гэх мэт Кирилл үгтэй зайгүй наалдсан бол) тэр токеныг
//      ЗАСАХГүй, зөвхөн мэдэгдэнэ — учир нь тэр тохиолдол манай бодит
//      алдааны загвартай тохирохгүй.
//   2) Код өргөтгөлтэй файлд (.html/.js/.css) зөвхөн "//" коммент мөрөнд
//      хамаарна. ЭНЭ ХЯЗГААРЛАЛТ ЧУХАЛ: анхны хувилбар үүнийг хийдэггүй
//      байсан бөгөөд өөрийгөө шалгах явцад ЯГ ӨӨРИЙН, Латин v/V агуулсан
//      Кирилл-муж regex литералыг "холимог токен" гэж буруу таарч, дотор
//      нь байсан v/V-г ч ялгалгүй Кирилл "ү/Ү" болгож ЭВДСЭН байсан.
//      Тиймээс код мөрөнд хэзээ ч автоматаар бүү хүр — comment мөрөнд
//      л хамаарна.
//
// Ашиглалт: node scripts/autofix_v.js <file>
'use strict';
const fs = require('fs');
const path = process.argv[2];
if (!path) {
  console.error('Ашиглалт: node scripts/autofix_v.js <file>');
  process.exit(1);
}
const CODE_EXT = new Set(['.html', '.js', '.css']);
const isCode = CODE_EXT.has(require('path').extname(path).toLowerCase());

let s = fs.readFileSync(path, 'utf8');
let fixed = 0;
const skipped = [];

const lines = s.split(/(\r?\n)/); // keep line endings as separate elements
for (let i = 0; i < lines.length; i += 2) {
  const line = lines[i];
  if (isCode && !line.trim().startsWith('//')) continue; // код мөрөнд бүү хүр
  lines[i] = line.replace(/[A-Za-zЀ-ӿ]+/g, (tok) => {
    const hasLatin = /[A-Za-z]/.test(tok);
    const hasCyr = /[Ѐ-ӿ]/.test(tok);
    if (!hasLatin || !hasCyr) return tok;
    const nonVLatin = tok.replace(/[vVЀ-ӿ]/g, '');
    if (nonVLatin.length > 0) {
      skipped.push(tok);
      return tok;
    }
    fixed++;
    return tok.replace(/v/g, 'ү').replace(/V/g, 'Ү');
  });
}
s = lines.join('');

fs.writeFileSync(path, s);
console.log('autofixed', path, '(' + fixed + ' токен засав)');
if (skipped.length) {
  console.log('АЛГАССАН (гараар шалгана уу):', [...new Set(skipped)].join(', '));
}

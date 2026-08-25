#!/usr/bin/env node
// Кирилл текст дотор Латин үсэг буруу орсон газрыг олно. Хоёр төрлийн
// алдааг илрүүлнэ:
//   1) Нэг үг дотор Латин ба Кирилл үсэг холилдсон — Латин үсэг Кирилл
//      "ү" эсвэл "ө"-гийн оронд бичигдэх нь энд хамгийн олонтаа тохиолддог.
//   2) Кирилл өгүүлбэрийн дунд ганцаараа зогсож буй, зөвхөн ижил нэг
//      Латин үсгээс (нэг эсвэл давхардсан хоёр) тогтсон богино токен —
//      Кирилл эгшгийн оронд буруу Латин үсэг дарагдсан тохиолдол байж
//      болно. Хувилбарын дугаар шиг (жиш нь тоотой зэрэгцсэн) бол алгасна.
//
// Ийм төрлийн алдаа нэг сешний турш гурван удаа давтагдсаны дараа механик
// шалгалт хэрэгтэй болсныг харуулсан тул энэ скриптийг бичив.
//
// Ашиглалт:
//   node scripts/check-cyrillic.js                 — өгөгдмөл файлуудыг шалгана
//   node scripts/check-cyrillic.js <file1> <file2>  — зөвхөн заасан файлуудыг шалгана
// Commit message шалгахдаа мессежийг файлд бичээд тэр файлыг дамжуулна.
//
// Алдаа олдвол мөрийг хэвлээд exit 1. Олдоогүй бол exit 0.
'use strict';
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function defaultFiles() {
  const fixed = ['index.html', 'content.json', 'metric_registry.json'];
  const mdFiles = fs.readdirSync(repoRoot).filter((f) => f.toLowerCase().endsWith('.md'));
  return [...fixed, ...mdFiles].map((f) => path.join(repoRoot, f));
}

const allowlistPath = path.join(__dirname, 'check-cyrillic-allowlist.txt');
const allowlist = new Set();
if (fs.existsSync(allowlistPath)) {
  for (const line of fs.readFileSync(allowlistPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#')) allowlist.add(t);
  }
}

const args = process.argv.slice(2);
const targets = (args.length ? args.map((a) => path.resolve(a)) : defaultFiles()).filter((f) =>
  fs.existsSync(f)
);

// Кирилл блок [Ѐ-ӿ] (U+0400–U+04FF) — Орос болон Монгол нэмэлт үсэг
// (Өө/Үү) бүгд энд багтдаг.
const mixedTokenRe = /[A-Za-zЀ-ӿ]+/g;
const bareVRe = /\bv+\b/gi;
const cyrillicCharRe = /[Ѐ-ӿ]/;
const violations = [];

const CODE_EXT = new Set(['.html', '.js', '.css']);

for (const file of targets) {
  const isCode = CODE_EXT.has(path.extname(file).toLowerCase());
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    // Дүрэм 1: нэг токен дотор Латин + Кирилл холилдсон. Код мөрт ч,
    // коммент мөрт ч адилхан хамаарна — жинхэнэ Кирилл үг дотор Латин
    // үсэг орсон нь хаана ч гарсан алдаа.
    let m;
    mixedTokenRe.lastIndex = 0;
    while ((m = mixedTokenRe.exec(line))) {
      const tok = m[0];
      if (/[A-Za-z]/.test(tok) && cyrillicCharRe.test(tok) && !allowlist.has(tok)) {
        violations.push({
          file: path.relative(repoRoot, file),
          line: i + 1,
          token: tok,
          context: line.trim().slice(0, 120),
          rule: 'mixed-token',
        });
      }
    }
    // Дүрэм 2: ганцаараа зогсож буй, зөвхөн ижил нэг Латин үсгээс тогтсон
    // богино токен, мөрөнд өөр Кирилл үсэг байгаа тохиолдолд (Кирилл
    // өгүүлбэрийн дунд орсон Латин fragment гэж таамаглана). Тоотой
    // зэрэгцсэн бол хувилбарын дугаар байх магадлалтай тул алгасна. Код
    // өргөтгөлтэй файлд (.html/.js/.css) зөвхөн "//" коммент мөрөнд
    // хамаарна — код мөрөнд нэг үсэгт хувьсагчийн нэр (жиш нь "v:утга")
    // байгаа нь зөвшөөрөгдсөн хэрэглээ, алдаа биш.
    const trimmed = line.trim();
    if (isCode && !trimmed.startsWith('//')) return;
    if (!cyrillicCharRe.test(line)) return;
    bareVRe.lastIndex = 0;
    while ((m = bareVRe.exec(line))) {
      const tok = m[0];
      const before = line[m.index - 1] || '';
      const after = line[m.index + tok.length] || '';
      if (/[0-9]/.test(before) || /[0-9]/.test(after)) continue; // хувилбарын дугаар
      if (before === '`' && after === '`') continue; // `v` — код дэх хувьсагчийн нэрийг эшилсэн
      if (allowlist.has(tok)) continue;
      violations.push({
        file: path.relative(repoRoot, file),
        line: i + 1,
        token: tok,
        context: line.trim().slice(0, 120),
        rule: 'bare-latin-v',
      });
    }
  });
}

if (violations.length) {
  console.error('');
  console.error('КИРИЛЛ/ЛАТИН ХОЛИЛДСОН ' + violations.length + ' ГАЗАР ОЛДЛОО:');
  console.error('');
  for (const v of violations) {
    console.error('  ' + v.file + ':' + v.line + '  "' + v.token + '"  [' + v.rule + ']');
    console.error('    ' + v.context);
  }
  console.error('');
  console.error('Жинхэнэ алдаа бол зас. Санаатай холимог үг (брэнд нэр гэх мэт) бол');
  console.error('scripts/check-cyrillic-allowlist.txt файлд нэмж болно.');
  process.exit(1);
} else {
  console.log('OK: алдаа алга. ' + targets.length + ' файл шалгав.');
  process.exit(0);
}

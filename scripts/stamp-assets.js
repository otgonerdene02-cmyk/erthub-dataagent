#!/usr/bin/env node
/* Asset-ийн кэш тасалгаа (build алхамгүй статик сайтад).
 *
 * ЯАГААД: GitHub Pages бүх файлыг `Cache-Control: max-age=600`-аар өгдөг.
 * Deploy-ийн дараа 10 минут хөтөч ШИНЭ index.html + ХУУЧИН style.css/js-ийг
 * зэрэг ачаална (2026-10-22: #84-ийн дараа «113,324» ба «113K» хоёул гарав).
 * Холбоос бүрт файлын агуулгын hash-ыг `?v=<hash8>` болгон бичвэл файл
 * өөрчлөгдөх бүрд URL өөр болж, хөтөч шинээр татна.
 *
 *   node scripts/stamp-assets.js          # HTML доторх hash-ыг шинэчилнэ
 *   node scripts/stamp-assets.js --check  # хуучирсан/дутуу бол exit 1 (CI)
 *
 * Hash нь CRLF→LF болгож тооцно — Windows (autocrlf) ба CI (LF) ижил hash өгнө.
 * Зөвхөн локал .css/.js холбоос (http(s)://, // эхэлсэн гадаад холбоос биш).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const HTML_FILES = ['index.html', 'admin/index.html'];
/* (src|href)="<зам>.(css|js)[?v=…]" — бусад query-г хадгалахгүй (одоо алга). */
const REF_RE = /\b(src|href)="([^"?#]+\.(?:css|js))(?:\?v=([0-9a-f]*))?"/g;

function hashFile(abs) {
  const txt = fs.readFileSync(abs).toString('latin1').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(txt, 'latin1').digest('hex').slice(0, 8);
}

function isLocal(ref) { return !/^(?:[a-z]+:)?\/\//i.test(ref); }

/* html → { out, refs:[{file, ref, have, want, missing}] } */
function stampHtml(html, htmlRel, root) {
  root = root || ROOT;
  const refs = [];
  const out = html.replace(REF_RE, (m, attr, ref, have) => {
    if (!isLocal(ref)) return m;
    const abs = ref.startsWith('/') ? path.join(root, ref) : path.resolve(root, path.dirname(htmlRel), ref);
    const r = { file: htmlRel, ref, have: have || null, want: null, missing: false };
    refs.push(r);
    if (!fs.existsSync(abs)) { r.missing = true; return m; }
    r.want = hashFile(abs);
    return `${attr}="${ref}?v=${r.want}"`;
  });
  return { out, refs };
}

function run(opts) {
  const root = (opts && opts.root) || ROOT;
  const check = !!(opts && opts.check);
  const problems = [];
  let changed = 0, total = 0;
  for (const rel of HTML_FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const html = fs.readFileSync(abs, 'utf8');
    const { out, refs } = stampHtml(html, rel, root);
    total += refs.length;
    for (const r of refs) {
      if (r.missing) problems.push(`${rel}: ${r.ref} — файл олдсонгүй`);
      else if (r.have !== r.want) problems.push(`${rel}: ${r.ref} — ?v=${r.have || '(алга)'}, байх ёстой ?v=${r.want}`);
    }
    if (!check && out !== html) { fs.writeFileSync(abs, out); changed++; }
  }
  return { problems, changed, total };
}

module.exports = { run, stampHtml, hashFile, HTML_FILES };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const { problems, changed, total } = run({ check });
  if (check) {
    if (problems.length) {
      console.error('✗ Asset-ийн hash хуучирсан (' + problems.length + '/' + total + '):');
      problems.forEach((p) => console.error('  ' + p));
      console.error('\nЗасах: node scripts/stamp-assets.js  (дараа нь commit)');
      process.exit(1);
    }
    console.log('✓ Asset-ийн hash бүгд шинэ (' + total + ' холбоос)');
  } else {
    const missing = problems.filter((p) => /олдсонгүй/.test(p));
    missing.forEach((p) => console.error('⚠ ' + p));
    console.log(changed ? `✓ ${changed} HTML файл шинэчлэгдэв (${total} холбоос)` : `✓ Өөрчлөлтгүй (${total} холбоос)`);
    if (missing.length) process.exit(1);
  }
}

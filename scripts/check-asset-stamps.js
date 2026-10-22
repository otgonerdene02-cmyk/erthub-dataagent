#!/usr/bin/env node
/* Asset-ийн hash шинэ эсэхийг шалгана (CI `checks` job, commit-ийн өмнө).
 * Хуучирсан бол: node scripts/stamp-assets.js → commit. Дэлгэрэнгүй: stamp-assets.js */
'use strict';
const { run } = require('./stamp-assets.js');
const { problems, total } = run({ check: true });
if (problems.length) {
  console.error('✗ Asset-ийн hash хуучирсан (' + problems.length + '/' + total + '):');
  problems.forEach((p) => console.error('  ' + p));
  console.error('\nЗасах: node scripts/stamp-assets.js  (дараа нь commit)');
  process.exit(1);
}
console.log('✓ Asset-ийн hash бүгд шинэ (' + total + ' холбоос)');

'use strict';
/* Тестийн HTTP сервер — ХАТУУ порт АШИГЛАХГҮЙ.

   Өмнө нь run.js 8971, text-coverage.js 8973 портыг хатуу ашигладаг байв.
   Өөр сешн / worktree-д зэрэг тест ажиллаж байхад, эсвэл өмнөх гүйлтийн
   процесс порт барьсан үлдвэл бүх гүйлт `EADDRINUSE`-ээр шалтгаангүй унадаг
   байв. Одоо serve() бүр OS-оос сул порт авна (listen(0)) — зэрэгцээ
   гүйлтүүд хэзээ ч мөргөлдөхгүй.

   Тогтмол порт хэрэгтэй бол (жиш. Chrome-оор гараар нээж шалгах):
     TEST_PORT=8971 node tests/run.js */
function listenFree(server) {
  const want = Number(process.env.TEST_PORT) || 0;
  server.on('error', (e) => {
    console.error('\nТестийн сервер эхэлсэнгүй (порт ' + want + '): ' + e.code +
      (e.code === 'EADDRINUSE' ? ' — порт эзлэгдсэн. TEST_PORT-ыг арилгавал сул порт автоматаар авна.' : ''));
    process.exit(1);
  });
  server.listen(want);
  /* TCP-д bind синхрон — address() шууд бэлэн. Бүтэлгүйтвэл null буцаж,
     дээрх 'error' handler дараагийн tick-т процессыг зогсооно. */
  const a = server.address();
  return a ? a.port : want;
}

module.exports = { listenFree };

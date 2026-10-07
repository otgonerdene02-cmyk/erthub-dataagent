'use strict';
/* Харагдацын шалгагчийн ӨӨРИЙН тест (selftest) — гараар бодох боломжтой жижиг
   фикстур. Шалгагч өөрөө муу байвал ("ХУДАЛ ногоон") бүх хуудсын аудит утгагүй
   болно, тиймээс дүрэм бүрийг: (а) АЛДААТАЙ фикстур дээр ГАРЧ байгаа, (б) ЗӨВ
   фикстур дээр ГАРАХГҮЙ байгааг нотолно.

   expect = тухайн фикстурт гарах ёстой дүрмүүдийн ЯГ жагсаалт ([] = цэвэр). */
const CARD = 'border:1px solid #ccd;border-radius:16px;padding:16px;background:#fff;';
const rows = (n) => Array.from({ length: n }, (_, i) =>
  '<div style="padding:6px 0">Мөр ' + (i + 1) + ' — нэр</div>').join('');

const FIXTURES = {
  /* ── зөв ── */
  'clean-card': { expect: [], html: '<div style="' + CARD + 'width:300px">Энгийн текст</div>' },
  'ellipsis-is-fine': { expect: [], html:
    '<div style="' + CARD + 'width:200px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    'Маш урт нэр заавал таслагдах ёстой, гэхдээ ellipsis-тэй тул зөв</div></div>' },
  'scroll-container-is-fine': { expect: [], html:
    '<div style="' + CARD + 'width:240px"><div style="overflow-x:auto"><div style="white-space:nowrap;width:600px">' +
    'Өргөн хүснэгт хэвтээ гүйлгэгдэнэ — алдаа биш</div></div></div>' },
  'marquee-ignored': { expect: [], html:
    '<div style="position:relative;overflow:hidden;width:200px;height:30px;border:1px solid #ccc;border-radius:8px">' +
    '<div data-audit-ignore="marquee" style="position:absolute;white-space:nowrap;left:-80px">Гүйдэг мөр, зориудаар хүрээнээс гарна</div></div>' },
  'decor-ignored': { expect: [], html:
    '<div style="position:relative;' + CARD + 'width:300px;height:120px;overflow:hidden">Агуулга' +
    '<div style="position:absolute;inset:0;pointer-events:none"><svg viewBox="0 0 100 20" style="position:absolute;left:-200px;width:900px;height:100px"><text x="0" y="10">1925</text></svg></div></div>' },
  'placeholder-box-is-fine': { expect: [], html:
    '<div style="' + CARD + 'width:420px"><div>ГАРЧИГ</div>' +
    '<div style="height:210px;display:flex;align-items:center;justify-content:center">мэдээлэл алга</div></div>' },
  'chart-fills-width': { expect: [], html:
    '<div style="' + CARD + 'width:760px"><svg viewBox="0 0 600 170" style="width:100%;height:auto;display:block">' +
    '<path d="M0 150 L600 20" stroke="#09f" fill="none"/><text x="10" y="165">1-р сар</text></svg></div>' },
  'start-aligned-pair': { expect: [], html:
    '<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:start;width:960px">' +
    '<div style="' + CARD + '"><svg viewBox="0 0 600 170" style="width:100%;height:auto;display:block"><path d="M0 150 L600 20" stroke="#09f" fill="none"/></svg></div>' +
    '<div style="' + CARD + '">' + rows(12) + '</div></div>' },
  'svg-label-nowrap-is-fine': { expect: [], html:
    '<svg viewBox="0 0 200 40" style="width:400px;height:auto;display:block">' +
    '<foreignObject x="10" y="10" width="40" height="14" style="overflow:visible"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;justify-content:center;white-space:nowrap;font:9.5px monospace">11-р сар</div></foreignObject></svg>' },

  /* ── алдаатай (user-ийн дэлгэцийн зураг дээрх бодит алдаанууд) ── */
  'text-outside-card': { expect: ['text-overflow'], html:
    '<div style="' + CARD + 'width:160px"><span style="white-space:nowrap">Энэ текст картаасаа ГАРНА гэж бичсэн</span></div>' },
  'svg-label-moved-by-transform': { expect: ['text-overflow'], html:
    /* i06 "суурь индекс = 100": foreignObject clip хийдэг тул transform-оор өргөсөн шошго нуугдсан */
    '<svg viewBox="0 0 300 60" style="width:600px;height:auto;display:block"><line x1="0" y1="30" x2="300" y2="30" stroke="#999"/>' +
    '<foreignObject x="10" y="30" width="150" height="14"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:9px;white-space:nowrap;transform:translateY(-15px)">суурь индекс = 100</div></foreignObject></svg>' },
  'svg-tick-wraps-and-clips': { expect: ['text-overflow'], html:
    /* "11-р сар" 40px өргөнд 2 мөр болж, доод мөр нь clip-д орсон */
    '<svg viewBox="0 0 200 40" style="width:400px;height:auto;display:block">' +
    '<foreignObject x="10" y="10" width="40" height="14"><div xmlns="http://www.w3.org/1999/xhtml" style="text-align:center;font:9.5px monospace">11-р сар</div></foreignObject></svg>' },
  'tall-card-next-to-long-list': { expect: ['card-empty'], html:
    /* Дэлгэцийн зураг: "САРЫН НИСЛЭГИЙН ТОО" — жижиг график + align-items:stretch + урт жагсаалт */
    '<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:stretch;width:960px">' +
    '<div style="' + CARD + '"><div>САРЫН НИСЛЭГИЙН ТОО</div><svg viewBox="0 0 600 170" style="width:100%;height:auto;display:block"><path d="M0 150 L600 20" stroke="#09f" fill="none"/></svg></div>' +
    '<div style="' + CARD + '">' + rows(12) + '</div></div>' },
  'svg-letterboxed': { expect: ['svg-letterbox'], html:
    '<div style="' + CARD + 'width:800px"><svg viewBox="0 0 600 170" style="width:100%;height:180px;display:block">' +
    '<path d="M0 150 L600 20" stroke="#09f" fill="none"/></svg></div>' },
  'texts-overlap': { expect: ['text-overlap'], html:
    '<div style="' + CARD + 'width:300px;height:60px;position:relative"><span style="position:absolute;left:10px;top:10px">Давхцсан нэр</span>' +
    '<span style="position:absolute;left:30px;top:12px">1,234</span></div>' },
  'raw-nan-text': { expect: ['raw-leak'], html: '<div style="' + CARD + 'width:300px">Нийт: NaN нислэг</div>' },
  'raw-nan-svg': { expect: ['raw-leak'], html:
    '<svg viewBox="0 0 100 40" style="width:300px;height:auto"><path d="M0 40 L NaN 10" stroke="#09f" fill="none"/></svg>' },
  'page-hscroll': { expect: ['page-hscroll'], html: '<div style="width:3000px;height:20px;background:#eef">өргөн</div>' }
};

module.exports = { FIXTURES };

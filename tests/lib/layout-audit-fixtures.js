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
  /* 2026-10-15-аас ХОРИОТОЙ (UI стандарт ROW): өмнө нь «start-aligned хос зөвшөөрөгдөнө»
     гэж үздэг байсан нь галт тэрэг/вагон/үзлэгийн тэгш бус мөрүүдийг аудитаас нуусан. */
  'start-aligned-pair': { expect: ['row-height-mismatch'], html:
    '<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:start;width:960px">' +
    '<div style="' + CARD + '"><svg viewBox="0 0 600 170" style="width:100%;height:auto;display:block"><path d="M0 150 L600 20" stroke="#09f" fill="none"/></svg></div>' +
    '<div style="' + CARD + '">' + rows(12) + '</div></div>' },
  'svg-label-nowrap-is-fine': { expect: [], html:
    '<svg viewBox="0 0 200 40" style="width:400px;height:auto;display:block">' +
    '<foreignObject x="10" y="10" width="40" height="14" style="overflow:visible"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;justify-content:center;white-space:nowrap;font:9.5px monospace">11-р сар</div></foreignObject></svg>' },

  'even-grid-2x2': { expect: [], html:
    '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;width:600px">' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' + '</div>' },
  'orphan-spans-full-row': { expect: [], html:
    /* 2 багана, 3 нүд — сүүлийнх нь бүтэн мөр (mobile дээрх eh-g-2c) */
    '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;width:600px">' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px;grid-column:1/-1">Бүтэн мөр</div></div>' },
  'flex-wrap-stretched-last': { expect: [], html:
    /* 3+2: сүүлийн мөрийн нүд тэнцүү тэлнэ (tablet дээрх eh-ls-grid) */
    '<div style="display:flex;flex-wrap:wrap;gap:10px;width:600px">' +
    '<div style="' + CARD + 'height:80px;flex:1 1 150px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px;flex:1 1 150px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px;flex:1 1 150px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px;flex:1 1 150px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px;flex:1 1 150px">Нүд</div>' + '</div>' },
  /* SVG <text> доторх HTML <span> (dc-runtime {{ }}) → харагдахгүй. Treemap-ийн
     "Зүүн Ази 85.0%" шошго яг ийм байсан. */
  /* <span>-ыг скриптээр (createElement → HTML namespace) оруулна — dc-runtime
     яг ингэж оруулдаг; HTML парсер оруулбал SVG namespace болж өөр зан гаргана. */
  'svg-text-span-hidden': { expect: ['svg-text-hidden'], html:
    '<svg viewBox="0 0 300 100" style="width:300px;height:auto;display:block"><g>' +
    '<rect x="0" y="0" width="300" height="100" fill="#64c"></rect>' +
    '<text id="tt" x="6" y="18" fill="#fff" font-size="11"></text></g></svg>' +
    '<script>(function(){var t=document.getElementById("tt");var s=document.createElement("span");' +
    's.textContent="Зүүн Ази";t.appendChild(s);})();</script>' },
  /* Сарын график (богино) + тээвэрлэгчийн жагсаалт (урт) зэрэгцэж, grid нь align-items:start —
     богино карт доор 700px хоосон. Энэ нь дэлгэрэнгүй хуудасны ЯГ алдаа. */
  'row-height-mismatch': { expect: ['row-height-mismatch'], html:
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;width:700px">' +
    '<div style="' + CARD + '">' + rows(12) + '</div><div style="' + CARD + '">' + rows(40) + '</div></div>' },
  /* Жижиг (198px) donut карт + урт жагсаалт — хуучин дүрэм (≥220px карт) мултраадаг байсан
     ЯГ зорчигчийн галт тэрэгний алдаа (2026-10-15) */
  'row-height-mismatch-small-card': { expect: ['row-height-mismatch'], html:
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;width:700px">' +
    '<div style="' + CARD + 'height:120px">Донут</div><div style="' + CARD + '">' + rows(30) + '</div></div>' },
  /* Бага зөрүү (60px) ч мөр тэгш бус харагдана — үзлэгийн 360 | 420 */
  'row-height-mismatch-60px': { expect: ['row-height-mismatch'], html:
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;width:700px">' +
    '<div style="' + CARD + 'height:300px">А</div><div style="' + CARD + 'height:360px">Б</div></div>' },
  'table-underfill': { expect: ['table-underfill'], html:
    '<div style="' + CARD + 'width:700px"><div style="overflow-x:auto"><div data-eh-table="1" style="width:fit-content">' +
    '<div style="display:grid;grid-template-columns:120px 120px 120px;gap:12px"><div>Сар</div><div>Зорчигч</div><div>Төлөв</div></div></div></div></div>' },
  'table-fill-is-fine': { expect: [], html:
    '<div style="' + CARD + 'width:700px"><div style="overflow-x:auto"><div data-eh-table="1" style="min-width:100%;width:fit-content">' +
    '<div style="display:grid;grid-template-columns:minmax(120px,1fr) minmax(120px,1fr) minmax(120px,1fr);gap:12px"><div>Сар</div><div>Зорчигч</div><div>Төлөв</div></div></div></div></div>' },
  'row-stretch-is-fine': { expect: [], html:
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:stretch;width:700px">' +
    '<div style="' + CARD + '">' + rows(12) + '</div>' +
    /* Яг style.css-ийн eh-fill-* загвар: жагсаалт абсолют гүйлгээтэй → карт мөрийн өндрийг түлхэхгүй */
    '<div style="' + CARD + 'display:flex;flex-direction:column;"><div style="font-weight:600">Толгой</div>' +
    '<div style="position:relative;flex:1 1 0;min-height:0;"><div style="position:absolute;inset:0;overflow-y:auto;">' + rows(40) + '</div></div></div></div>' },
  'svg-text-foreignobject-is-fine': { expect: [], html:
    '<svg viewBox="0 0 300 100" style="width:300px;height:auto;display:block"><g>' +
    '<rect x="0" y="0" width="300" height="100" fill="#64c"></rect>' +
    '<foreignObject x="0" y="0" width="300" height="100"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#fff;font-size:11px;padding:6px">Зүүн Ази 1,749,961</div></foreignObject></g></svg>' },
  'control-inside-scroller-is-fine': { expect: [], html:
    '<div style="overflow-x:auto;width:240px"><div style="display:flex;gap:8px;width:700px"><button>Нэг</button><button style="margin-left:auto">Хоёр</button></div></div>' },
  'small-chips-wrap-is-fine': { expect: [], html:
    '<div style="display:flex;flex-wrap:wrap;gap:6px;width:300px">' +
    Array.from({ length: 7 }, () => '<span style="padding:6px 14px;border:1px solid #ccd;border-radius:999px">chip</span>').join('') + '</div>' },

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
  'week-labels-overlap-small': { expect: ['label-row-overlap'], html:
    /* Гар утас: 7 хоногийн баганын утга «571,206» ~33px баганад 9px давхцсан (text-overlap-ийн 30%-иас доош) */
    '<div class="eh-wk" style="display:flex;gap:4px;width:110px">' +
    ['571,206', '561,952', '521,477'].map((v) => '<div style="flex:1;min-width:0;text-align:center;white-space:nowrap;font:10.5px monospace"><span>' + v + '</span></div>').join('') + '</div>' },
  'raw-nan-text': { expect: ['raw-leak'], html: '<div style="' + CARD + 'width:300px">Нийт: NaN нислэг</div>' },
  'raw-nan-svg': { expect: ['raw-leak'], html:
    '<svg viewBox="0 0 100 40" style="width:300px;height:auto"><path d="M0 40 L NaN 10" stroke="#09f" fill="none"/></svg>' },
  'grid-orphan-4plus1': { expect: ['grid-orphan'], html:
    /* "ҮНДСЭН ҮЗҮҮЛЭЛТҮҮД" 1024 дээр 5 нүд 4+1 болж ганц орчигч үлдсэн */
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;width:800px">' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' + '</div>' },
  'grid-orphan-2plus1': { expect: ['grid-orphan'], html:
    '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;width:600px">' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' +
    '<div style="' + CARD + 'height:80px">Нүд</div>' + '</div>' },
  'offscreen-control': { expect: ['offscreen-control'], html:
    /* header: лого + товчнууд өргөн нь viewport-оос давж ☰ баруун ирмэгээс гарсан (root нь overflow-x:hidden) */
    '<style>html,body{overflow-x:hidden}</style><div style="display:flex;gap:8px;align-items:center;width:1000px"><span>ЛОГО</span><button>Нэвтрэх</button><button style="margin-left:auto">☰</button></div>' },
  'page-hscroll': { expect: ['page-hscroll'], html: '<div style="width:3000px;height:20px;background:#eef">өргөн</div>' }
};

module.exports = { FIXTURES };

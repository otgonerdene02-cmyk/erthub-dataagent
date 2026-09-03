# ErtHub — зам, тээврийн нээлттэй өгөгдлийн портал

Статик сайт (build алхамгүй). `index.html` дотор `<script type="text/x-dc">`
блокт бүх логик; темплейт нь `dc-runtime.js` (`sc-for` / `sc-if` / `{{ }}`).

## Файлын үүрэг

| Файл | Юу хадгалдаг |
|---|---|
| `index.html` | Сайт бүхэлдээ (темплейт + логик, ~7500 мөр) |
| `admin/index.html` | Удирдлагын хэрэгсэл — текст ба метрик холбоос засах |
| `content.json` | **Бүх харагдах текст** (доор үз) |
| `metric_registry.json` | Виджет → метрикийн холбоос, `agg/filter/transform` |
| `tests/run.js` | Ерөнхий регресс (74 тест) |
| `tests/text-coverage.js` | Харагдах текстийн хамрах хүрээ + round-trip (5 тест) |

## content.json — 4 блок

- `widgets{}` — виджет тус бүрийн `title` / `sub` / `unit` / `foot` / `foot2`
- `site{}` — нүүр хуудасны виджет БУС бүх текст (толгой, hero, KPI, шүүлт,
  7 хоногийн тайлан, коммунити, AI, эх сурвалжийн мета г.м.)
- `ui{}` — **админы** интерфейсийн текст (badge, товч, шошго). Нэг удаа
  бүртгэгдэж виджет бүрийн засварын дэлгэцэд давтагдана
- `ui_form{}` — админы маягтын бүлэг/шошго өөрөө

Уншилт: `index.html` → `stxt(path, fallback)` (модулийн түвшинд, класс
гаднаас ч уншигдана) ба `txt(id, field, fallback)`.
`applySiteContent()` нь `SECTORS` / `KPI_UNIFIED` / `WEEK_DATA` / `RECENT` /
`PROJECTS` / `POLICIES` / `AI_*` тогтмолыг content.json-оос дүүргэнэ.
`admin/index.html` → `utxt(path, fallback)` ба `data-ui` атрибут.

Админ ФАЙЛ РУУ ШУУД БИЧДЭГГҮЙ — `Экспортлох` товч JSON татаж өгнө,
түүнийг репод хуулж commit хийнэ.

## Командууд

```bash
node scripts/serve.js 8080          # хөгжүүлэлтийн сервер
node tests/run.js                   # 74 тест
node tests/text-coverage.js --list  # хамрах хүрээ 100% байх ёстой
```

Commit хийхийн ӨМНӨ заавал:

```bash
node scripts/check-cyrillic.js && node scripts/check-registry.js
```

## Дүрэм

- **Тоо ЗОХИОХГҮЙ.** Эх сурвалж холбогдоогүй бол `0` эсвэл `—` + "мэдээлэл
  алга" гэж ил хэлнэ. Зохиомол утга бол алдаа гэж үзнэ.
- **Ганц эх сурвалж.** Текстийг код ба content.json хоёуланд бүү давхардуул.
  Динамикаар тооцоологддог утгыг (`weekPaxUnit` гэх мэт) content.json-д
  бүү бич.
- **Шинэ харагдах текст нэмбэл** content.json-д бүртгэ — эс тэгвэл
  `tests/text-coverage.js` F1/F2 унана (хамрах хүрээ 100%-аас буурна).
- Push хийхийн өмнө зөвшөөрөл ав.
- Тайлбар, commit мессеж монголоор.

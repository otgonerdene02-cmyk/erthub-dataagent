# Шилжүүлгийн хураангуй — etransport_v2 backend → ErtHub widget builder

## Зорилго (энэ chat-д хийх ажил)

`erthub-dataagent` репо (Мал/ЭртХаб — зам, тээврийн нээлттэй өгөгдлийн портал,
`admin/index.html` + `index.html`, статик сайт) нь одоо шинээр гаргасан backend
API-аас **бодит салбарын дата** авч widget builder-т холбогдох ёстой.

## Өмнөх chat-д ХИЙГДСЭН ажил (дэвшилтэт төлөв)

### 1. Сервер, өгөгдлийн сан
- Сервер: `platformbackup@10.2.115.40` (Ubuntu 26.04), дотоод сүлжээ (`10.0.0.0/8`) —
  зөвхөн **Fortinet SSL VPN (MFA)**-аар л хүрдэг. Одоогийн OpenVPN холболт (172.169.x.x/
  192.168.x.x) энэ мужид ХҮРДЭГГҮЙ.
- `etransport_v2` PostgreSQL сан бэлэн: `bronze`/`silver`/`gold` (Medallion) schema.
- Хэрэглэгч: `etransport_app` (нууц үг Password Manager-т).

### 2. Backend API (Node.js/Express)
- Байршил: `/home/platformabackup/etransport-backend` (АНХААР: home directory
  бодитоор **`platformabackup`** гэж алдаатай үүссэн, `platformbackup` БИШ!).
- systemd service: `etransport-backend` (`sudo systemctl status etransport-backend`),
  автоматаар асдаг, `127.0.0.1:3000` дээр ажиллана.
- Endpoint-үүд:
  - `GET /health` → `{"status":"ok",...}`
  - `GET /health/db` → DB холболт шалгах
  - `GET /api/sectors` → 5 салбарын жагсаалт (`hasLiveData` flag-тай)
  - `GET /api/sectors/:sector/summary` → `gold.monthly_summary_by_sector`-с сарын нэгтгэл
    (**АНХААР**: rail-ийн хувьд одоогоор `silver.rail_operations`-г уншдаг, бид
    `silver.rail_wagon_loading`-д (шинэ) дата хийсэн ч ЭНЭ endpoint түүнийг ХАРАХГҮЙ —
    доорх "Дараагийн ажлын жагсаалт"-ыг үз)
  - `GET /api/sectors/:sector/datasets` → `dataset_registry`-с

### 3. Firewall/нээлттэй байдал — ⚠️ ХИЙГДЭЭГҮЙ
- Backend одоогоор ЗӨВХӨН `127.0.0.1` дээр (сервер дотроо) ажиллаж байгааг шалгасан.
- **ErtHub-ийн widget builder GitHub Pages дээр (нийтийн интернэт) байрлаж байгаа тул,
  10.2.115.40:3000 руу шууд хүрч ЧАДАХГҮЙ** — VPN-гүй, дотоод хаяг.
- Widget builder-тай холбохын ӨМНӨ эсвэл хамт: nginx reverse proxy + SSL, эсвэл
  өөр нийтийн endpoint зохион байгуулах шаардлагатай (runbook-ийн 9-р зүйл үз,
  `docs/deploy-runbook.md` серверт байгаа файлаас).

### 4. Дата (ETL) — амжилттай засварлаж, туршиж баталгаажуулав
- **Air**: `npm run etl:air:all` — 50 бодит мөр `bronze→silver→gold` бүрэн урссан.
  TLS алдаа (Sectigo intermediate cert дутуу) болон эрхийн алдаа (public/bronze/
  silver/gold GRANT дутуу) хоёуланг нь олж засав.
- **Rail wagon-loading**: `src/etl/rail/wagonLoadingTransform.js`-ийн field mapping
  **БУРУУ** байсан (код "C34-C64" гэсэн БАЙХГҮЙ дугаарлалт ашигладаг байсан, бодит
  API нь `ID_ST`/`ST_NAME`/`JOB_DT`/`POG_*`/`WIG_*` нэртэй). Хэрэглэгчийн ирүүлсэн
  "Ачилт буулгалтын хоногийн мэдээ _УБТЗ_.xlsx" dictionary-тэй тулгаж, ЗАСАВ.
  Одоо 50/50 мөр амжилттай `silver.rail_wagon_loading`-д орсон, утга шалгаж
  баталгаажуулсан (жиш. Шивээ-Овоо=322, Амгалан=29/89).
- `road`/`sea`/`transit` — эх сурвалж/ETL хараахан БАЙХГҮЙ (`hasLiveData: false`).

### 5. Гол сургамж/анхаарах зүйл дараагийн ажилд
- **Терминал paste-ийн асуудал**: серверийн terminal олон мөрийг зэрэг paste хийхэд
  зарим үед гүйцэтгэхгүй зүгээр текст болгож үлддэг байсан — тул ГАНЦ КОМАНД тус
  бүрчлэн өгч, хариу хүлээж байхыг зөвлөж байна. Харин heredoc (`cat > file <<
  'EOF' ... EOF`) блок ажиллагаатай.
- **Эрхийн алдаа хэвшил**: PostgreSQL 15+-аас хойш шинэ schema/materialized view
  үүсгэхэд `etransport_app`-д GRANT ХИЙГДЭЭГҮЙ байсан (`permission denied for
  schema ...`). Ижил тохиолдол дахин гарвал: `sudo -u postgres psql -d
  etransport_v2 -c "GRANT ..."`.
- **Home directory typo**: `/home/platformabackup/` (нэмэлт "a"-тай), `pwd`-ээр
  ЗААВАЛ баталгаажуулж байгаад зам ашиглах хэрэгтэй.

## ErtHub талын (widget builder) одоогийн бүтэц — товч сануулга

- `content.json` — БҮХ харагдах текст (widgets{}/site{}/ui{}/ui_form{}).
- `metric_registry.json` — виджет → метрикийн холбоос, `agg/filter/transform`
  тайлбар (БОДИТ утга биш, зөвхөн metadata).
- `index.html` доторх `loadMetricRegistry()`/`val()` — метрикийн жинхэнэ утгыг
  тооцоолдог цорын ганц газар.
- **ДҮРЭМ (CLAUDE.md-ээс)**: Тоо ЗОХИОХГҮЙ — эх сурвалж холбогдоогүй бол `0`/`—`.
  Ганц эх сурвалж — динамик утгыг content.json-д бүү бич.

## Энэ chat-д ХИЙГДСЭН ажил (2026-09-06)

Backend (10.2.115.40:3000) хараахан публик URL-гүй тул **бодит холболт хийх
боломжгүй** — тул зөвхөн клиент талын хийцийг (plumbing) урьдчилан бэлдэв,
публик URL гарч ирмэгц нэг мөр тохиргоо солиход идэвхжихээр:

1. `js/backend-config.js` (шинэ) — `ETRANSPORT_BACKEND_BASE` тогтмол
   (`js/firebase-config.js`-тэй ижил зарчим: хоосон бол бүх зүйл disabled).
2. `js/erthub-backend.js` (шинэ) — `EHBackend` модуль (`js/erthub-publish.js`-тэй
   ижил зарчим: enabled/disabled, timeout, алдаа бол `null`, ямар ч тохиолдолд
   сайтыг унагаахгүй). `fetchSectorSummary(sector)` ба
   `fetchRailWagonLoading()` экспортолно.
3. `index.html`: 2 script холбов, `componentDidMount()`-д
   `loadEtransportBackend()` дуудна, `val()`-ийн `getters`-т
   `'rail.wagon_loading':()=>this._railWagonLoading` нэмэв.
4. `metric_registry.json`-ийн `metrics{}`-д `rail.wagon_loading` бүртгэв
   (`quality:"pending"` — код холбогдсон ч АМЬД БИШ гэдгийг ил тэмдэглэсэн).
   Ямар ч widget слот руу ХАРААХАН холбоогүй (аль слотод очихыг Дараагийн
   ажлын жагсаалтын 2-р зүйл шийднэ). Admin-ийн "Виджет бүтээгч"-ийн метрик
   сонголтод одоо харагдана (Object.keys(REG.metrics)-ээс автоматаар), гэхдээ
   `why()` нь "метрик өөрөө verified биш" гэж анхааруулна — энэ бол зөв,
   учир нь бодит холболт хараахан алга.

## Дараагийн ажлын жагсаалт (шинэ chat-д)

1. Backend API-г widget builder-с хүрч болохоор болгох (firewall/reverse proxy/
   public endpoint шийдэл) — сервер рүү SSH хандалттай chat/session хэрэгтэй,
   ЭНЭ chat-д server access байхгүй байсан. URL гарсны дараа
   `js/backend-config.js`-ийн `ETRANSPORT_BACKEND_BASE`-г бөглөнө.
2. `gold.monthly_summary_by_sector`-ийн rail хэсгийг `silver.rail_wagon_loading`-тай
   холбох эсэхийг (эсвэл тусдаа endpoint үүсгэх эсэхийг) backend талд шийдэх —
   энэ шийдвэрийн дараа л `metric_registry.json`-ийн `rail.wagon_loading`
   бичлэгийн `agg`/`filter`/`unit`-ийг бодит утгаар бөглөж, `quality:"verified"`
   болгож болно.
3. `rail.wagon_loading`-ийг аль widget слотод холбохыг тодруулж (жиш.
   `w2c.sectors.rail` — 7 хоногийн ачаа), `admin/index.html`-ийн "Виджет
   бүтээгч"-ээр бодитоор холбож, preview шалгах.
4. Бусад салбарууд (`road`/`sea`/`transit`) ETL бэлэн болмогц ижил хэв маягаар
   (config → getter → registry → widget холболт) нэмэгдэнэ.

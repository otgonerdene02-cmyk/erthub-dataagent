# erthub.dataagent
ЗТЯ-ны дата портал

## Датасэтийн "Үзсэн" тоолуур

Датасэт бүрийн үзэлтийг `js/dataset-views.js` бүртгэнэ. Хоёр горимтой:

- **Локал (одоо ажиллаж байгаа)** — `localStorage`. Backend шаардахгүй, шууд
  ажиллана. Гэхдээ энэ нь **зөвхөн тухайн хөтчийн** тоо, хэрэглэгч бүр өөрийн
  тоог хардаг.
- **Дундын (Firestore)** — бүх хэрэглэгчийн нийт тоо. Код бэлэн, Firestore
  идэвхжмэгц **өөрчлөлт хийхгүйгээр** автоматаар шилжинэ.

### Дундын тоолуурыг идэвхжүүлэх

1. [Firebase Console](https://console.firebase.google.com) → `open-data-62ed3`
   → **Build → Firestore Database → Create database** (production mode).
2. **Rules** таб дээр дараах дүрмийг тавина:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /datasetViews/{id} {
      allow read: if true;
      // Зөвхөн count талбарыг 1-ээр нэмэхийг зөвшөөрнө.
      allow create: if request.resource.data.count == 1;
      allow update: if request.resource.data.count == resource.data.count + 1;
    }
  }
}
```

3. Хэдэн минутын дараа сайт автоматаар дундын тоог уншиж эхэлнэ.

**Анхаар:** дээрх дүрэм нэвтрээгүй хэрэглэгчид бичихийг зөвшөөрдөг тул тоог
зохиомлоор өсгөх боломж нээлттэй. Үүнийг хаах бол
[App Check](https://firebase.google.com/docs/app-check) нэмэх, эсвэл
нэвтэрсэн хэрэглэгчээр хязгаарлана (`allow write: if request.auth != null`).

## Картын утгыг датасэттэй холбох

Дэлгэрэнгүй хуудасны картууд бодит өгөгдлөөс утгаа авдаг. `index.html` доторх
`DATA_BINDINGS`-ийг үз — гурван алхамтай:

1. `applyRealFlightsData()` бодит мөрүүдээс `this._liveStats[салбар]`-ыг бөглөнө.
2. `DATA_BINDINGS[салбар][нэр]` тэр статистикийг `{label, value}` болгоно.
3. Датасэт `live:{картынТалбар:'нэр'}`-ээр аль холболтыг дуудахаа сонгоно.

Зарлаагүй бол `DATASETS` доторх статик текст хэвээр үлдэнэ.
`DATA_BINDING_DEFAULTS` нь бүх датасэтэд автоматаар үйлчилнэ (жиш. `use` →
`views`). Бодит өгөгдлөөс тооцсон утгын хажууд ногоон цэг гарна.

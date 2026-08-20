/*
 * ErtHub — Firebase Authentication тохиргоо
 * ==========================================
 * Нэвтрэх/Бүртгүүлэх товч жинхэнэ ажиллахын тулд доорх алхмуудыг хийнэ:
 *
 * 1. https://console.firebase.google.com руу орж Google эрхээрээ нэвтэрнэ.
 * 2. "Add project" дараад шинэ project үүсгэнэ (нэрийг дурын, жиш. erthub-dataagent).
 * 3. Зүүн талын цэснээс Build > Authentication > Get started.
 *    - "Sign-in method" таб руу орж "Email/Password"-ыг Enable болгоно.
 *    - Мөн "Google"-ыг Enable болгоно (project support email сонгоно).
 * 4. Project Settings (⚙ дүрс) > General > "Your apps" хэсэгт "</>" (Web) товч дарж
 *    шинэ web app бүртгэнэ (nickname дурын, Firebase Hosting шаардлагагүй).
 * 5. Гарч ирэх `firebaseConfig` объектын утгуудыг доорх FIREBASE_CONFIG-д хуулна.
 * 6. Authentication > Settings > "Authorized domains" хэсэгт GitHub Pages-ийн
 *    домэйноо нэмнэ (жиш. otgonerdene02-cmyk.github.io). localhost аль хэдийн
 *    жагсаалтад байгаа тул local тест шууд ажиллана.
 *
 * Эдгээр утгууд нууц түлхүүр биш — Firebase-ийн Web SDK config нь клиент талд
 * ил байхаар зориулагдсан, аюулгүй байдлыг нь Firebase Console-ийн Authorized
 * domains болон Security Rules хариуцна.
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDAGGKmiuwwtFSi87FGhgkss1cjJy0aLsc",
  authDomain: "open-data-62ed3.firebaseapp.com",
  projectId: "open-data-62ed3",
  storageBucket: "open-data-62ed3.firebasestorage.app",
  messagingSenderId: "167021909046",
  appId: "1:167021909046:web:6260d0f6f91fff11d4b497"
};

if (FIREBASE_CONFIG.apiKey.indexOf("REPLACE_WITH") !== 0 && typeof firebase !== "undefined") {
  firebase.initializeApp(FIREBASE_CONFIG);
  window.auth = firebase.auth();
  window.googleProvider = new firebase.auth.GoogleAuthProvider();
} else {
  console.warn("[ErtHub] Firebase тохируулаагүй байна — js/firebase-config.js доторх FIREBASE_CONFIG-ийг бөглөнө үү. Нэвтрэх/Бүртгүүлэх түр ажиллахгүй.");
}

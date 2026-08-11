/**
 * Lokal ishlab chiqishda `.env` faylini yuklaydi.
 *
 * Railway'da o'zgaruvchilar platformadan keladi va `.env` bo'lmaydi —
 * shuning uchun fayl topilmasa jim o'tib ketamiz.
 *
 * MUHIM: bu modul `config.js` dan OLDIN import qilinishi kerak,
 * chunki config o'zgaruvchilarni import paytida o'qiydi.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // .env yo'q — muhit o'zgaruvchilari tashqaridan berilgan deb hisoblaymiz.
}

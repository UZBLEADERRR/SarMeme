/**
 * REAL SAVDO — ATAYLAB AMALGA OSHIRILMAGAN.
 *
 * Bu fayl bo'sh qolgani xato emas, qaror. Shadow mode natijasi ijobiy
 * bo'lmaguncha bu yerga kod yozish — pulni yo'qotishning eng tez yo'li.
 *
 * Yoqishdan OLDIN quyidagilar bajarilishi shart:
 *
 *  1. Kamida 3-4 hafta paper rejim, real statistika bilan:
 *     - win-rate, o'rtacha PnL, eng yomon seriya (max drawdown)
 *     - komissiya va slippage hisobga olingan holda (paper.ts da bor)
 *     - agar paper minusda bo'lsa, real ham minusda bo'ladi — to'xtang
 *
 *  2. Kalit boshqaruvi:
 *     - Maxsus savdo koshelyogi, asosiy kapitaldan alohida
 *     - Faqat yo'qotishga tayyor summa (bankroll ning o'zi)
 *     - Kalit .env da OCHIQ MATNDA saqlanmasin — shifrlangan fayl
 *       (age/sops) yoki Railway secret + ishga tushirishda deshifrlash
 *     - Kalit hech qachon logga, Telegram xabariga yoki bazaga tushmasin
 *
 *  3. Ijro qatlami:
 *     - Jupiter Swap API: /quote → /swap (bepul, kalitsiz)
 *     - slippageBps ni aniq cheklang (masalan 300 = 3%)
 *     - Jito bundle yoki priority fee — MEV va tranzaksiya tushib
 *       qolishiga qarshi
 *     - Har tranzaksiyani tasdiqlanishini kuting va natijani bazaga yozing
 *
 *  4. Ishonchlilik:
 *     - Idempotentlik: bitta signal ikki marta xarid qilmasin
 *     - Qisman to'ldirish va muvaffaqiyatsiz tranzaksiyani qayta ishlash
 *     - Chiqish tranzaksiyasi tushmasa — qayta urinish navbati
 *       (chiqa olmaslik kira olmaslikdan ancha xavfli)
 *
 *  5. Yuridik: yashaydigan yurisdiksiyangizda avtomatik savdo va
 *     kripto operatsiyalari qoidalarini tekshiring.
 *
 * Ishga tushirish tartibi: bir necha kun eng kichik pozitsiya bilan
 * (masalan 0.01 SOL), keyin asta oshiring.
 */

export function assertLiveTradingNotEnabled(): never {
  throw new Error(
    'Live savdo hali amalga oshirilmagan. TRADING_MODE=paper qoldiring. ' +
      'Talablar ro\'yxati: src/trade/live.ts',
  );
}

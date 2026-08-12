# SarMeme

Solana memcoin tokenlarini avtomatik tahlil qiluvchi va **virtual savdo** qiluvchi shaxsiy bot.

Bepul xizmatlarda ishlaydi — taxminan **$5/oy** (faqat Railway).

---

## Darrov ko'rish

Hech narsa sozlamasdan:

```bash
npm install
SIMULATE=true npm run dev
```

Brauzerda **http://localhost:3000** oching. Bir-ikki daqiqada dashboard to'ladi: tokenlar oqimi, filtr natijalari, ballar, ochilgan pozitsiyalar, chiqishlar va PnL.

`SIMULATE=true` sun'iy tokenlar yaratadi va ularni **haqiqiy quvurdan** o'tkazadi — haqiqiy filtr, haqiqiy ballchi, haqiqiy risk menejeri, haqiqiy chiqish qoidalari. Faqat ma'lumot o'ylab topilgan. Bu tizim qanday ishlashini ko'rsatadi, lekin strategiya foydali ekanini **isbotlamaydi**.

Simulyatorsiz (`npm run dev`) bot haqiqiy PumpPortal oqimiga ulanadi — bu ham kalitsiz ishlaydi, lekin ma'lumot to'planishi sekinroq.

---

## Majburiy o'zgaruvchi yo'q

Nima berilmagan bo'lsa, o'rniga xavfsiz zaxira ishlatiladi:

| Yo'q bo'lsa | Nima bo'ladi |
|---|---|
| `SUPABASE_*` | Xotiradagi baza — ishlaydi, lekin qayta ishga tushganda tozalanadi |
| `GEMINI_API_KEY` | Evristik ballchi — ochiq formula (`src/ai/heuristic.ts`), narrativni tushunmaydi |
| `TELEGRAM_*` | Xabarlar dashboard va logda ko'rinadi |
| `SOLANA_RPC_URL` | Zanjir tekshiruvi o'tkazib yuboriladi, ball pasaytiriladi |

Dashboard yuqorisidagi belgilar nima ulangani va nima yo'qligini doim ko'rsatib turadi.

---

## Asosiy tamoyil

> **AI fikr beradi, kod qaror qabul qiladi.**

Til modeli hech qachon savdo qilmaydi. U faqat ball qo'yadi. Kirish-chiqish, pozitsiya hajmi va barcha risk limitlari qattiq kodda — `src/risk/manager.ts` va `src/trade/paper.ts` da.

```
1) DETERMINISTIK FILTR  (src/filter/screener.ts)    — AI yo'q, tez, arzon
   PumpPortal oqimi → mint/freeze authority, likvidlik, hajm,
   top-10 xolder ulushi, dev reputatsiyasi → ~90% tokenni rad etadi
                              ↓
2) BAHOLASH  (src/ai/analyst.ts | src/ai/heuristic.ts)
   Faqat filtrdan o'tganlar. Gemini bo'lsa: 15 ta token = 1 ta so'rov,
   strukturaviy JSON. Bo'lmasa: ochiq formulali evristika.
                              ↓
3) DETERMINISTIK IJRO  (src/risk + src/trade)       — AI aralashmaydi
   Risk tekshiruvi → pozitsiya hajmi formulasi → virtual kirish
   → stop-loss / take-profit / trailing / vaqt chegarasi
```

**Insider graf va dev reputatsiyasi bir dona AI chaqiruvisiz quriladi.** Har ko'rilgan token va uning taqdiri (`outcomeTick`) bazaga yoziladi — bir marta rug qilgan dev keyingi safar filtrda darrov to'siladi. Bu baza har kuni bepul o'sib boradi.

---

## ⚠️ Hozir bot faqat PAPER rejimda

`TRADING_MODE=live` ataylab bloklangan (`src/trade/live.ts`). Bot signal beradi, "sotib oldim" deydi, PnL hisoblaydi — lekin hech qanday tranzaksiya yubormaydi.

Virtual savdoda har kirish va chiqishga **1% komissiya + 2% slippage** jarimasi qo'llanadi, shuning uchun natija haqiqiydan chiroyliroq ko'rinmaydi.

**Kamida 3–4 hafta haqiqiy oqimda paper rejimda ishlating.** Agar shu davrda minusda bo'lsa — real pul bilan ham minusda bo'lasiz, faqat tezroq. To'liq talablar ro'yxati `src/trade/live.ts` da.

---

## Strategiya: snayping emas

Bepul ma'lumot bilan launch'ning birinchi bloklarida yutib bo'lmaydi — Yellowstone gRPC ishlatadigan botlar tokenni 200–500ms oldin ko'radi.

Shuning uchun bot **token tug'ilgandan 5–180 daqiqa keyin** qaraydi (`MIN_AGE_MINUTES` / `MAX_AGE_MINUTES`). Bu vaqtda allaqachon ma'lum: likvidlik ushlandimi, snayperlar chiqib ketdimi, haqiqiy hajm bormi. 100x'dan mahrum bo'lasiz, lekin rug'larning katta qismidan qutulasiz.

---

## To'liq sozlash

### 1. Supabase (bepul) — doimiy saqlash uchun

1. [supabase.com](https://supabase.com) da loyiha oching
2. **SQL Editor** → `supabase/schema.sql` ni to'liq ishga tushiring
3. **Project Settings → API** dan `URL` va `service_role` kalitini `.env` ga qo'ying

> **Xavfsizlik:** sxemada RLS yoqilmagan. Faqat `service_role` kaliti ishlatilsa muammo yo'q, lekin `anon` kaliti sizib chiqsa har kim ma'lumotni o'zgartira oladi. Tavsiya: RLS'ni yoqing (siyosatsiz) — `service_role` uni chetlab o'tadi, boshqa hamma bloklanadi. SQL `supabase/schema.sql` oxirida.

### 2. Kalitlar

| Xizmat | Qayerdan | Narx |
|---|---|---|
| Helius RPC | [helius.dev](https://helius.dev) → free tier | Bepul |
| Gemini API | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Bepul tarif |
| Telegram bot | [@BotFather](https://t.me/BotFather) → `/newbot` | Bepul |
| Telegram chat ID | [@userinfobot](https://t.me/userinfobot) | Bepul |
| PumpPortal · DexScreener | Kalit kerak emas | Bepul |

### 3. Railway'ga deploy

1. Repo'ni GitHub'ga push qiling
2. Railway → **New Project → Deploy from GitHub repo**
3. **Variables** ga `.env` dagi o'zgaruvchilarni qo'shing
4. **`DASHBOARD_TOKEN` ni albatta qo'ying** — Railway URL ochiq bo'ladi

Dashboard: `https://sizning-app.railway.app/?token=SIZNING_TOKEN`

> Bitta servis ishlating. Postgres'ni Railway'da emas, Supabase'da (bepul) ushlang.

---

## Dashboard

| Panel | Nima ko'rsatadi |
|---|---|
| Quvur | Voronka: ko'rildi → filtrdan o'tdi → baholandi → kirildi |
| Ochiq pozitsiyalar | Joriy foyda/zarar, ball, qancha vaqt ochiq |
| Baholar | Ball, hukm, sabab, aniqlangan xavf belgilari |
| Skrining natijalari | Har token nega o'tdi yoki nega rad etildi |
| Tokenlar oqimi | Real vaqtda kelayotgan yangi tokenlar |
| Yopilgan savdolar | PnL va chiqish sababi |
| Dev reputatsiyasi | Kim necha token chiqargan, nechtasi rug bo'lgan |

Yuqoridagi **⏹ To'xtatish** tugmasi — kill switch. Bosilganda yangi pozitsiya ochilmaydi.

---

## Telegram buyruqlari

`/status` · `/positions` · `/pnl` · `/token <mint>` · `/kill` · `/resume`

Faqat `TELEGRAM_CHAT_ID` da ko'rsatilgan chatdan qabul qilinadi.

---

## Risk himoyasi

Barcha limitlar `src/risk/manager.ts` da majburlanadi. AI ham, prompt ham ularni o'zgartira olmaydi.

| Sozlama | Nima qiladi | Standart |
|---|---|---|
| `BANKROLL_SOL` | Bot ixtiyoridagi kapital | 2 SOL |
| `MAX_POSITION_PCT` | Bitta pozitsiyaning maksimal ulushi | 4% |
| `DAILY_LOSS_LIMIT_PCT` | Tegilsa **kill switch avtomatik yoqiladi** | 10% |
| `MAX_OPEN_POSITIONS` | Bir vaqtda ochiq pozitsiyalar | 5 |
| `MAX_TRADES_PER_HOUR` | Runaway loop himoyasi | 10 |
| `MIN_AI_SCORE` | Bundan past ballda kirilmaydi | 70 |

Chiqish: `STOP_LOSS_PCT` (25%), `TAKE_PROFIT_PCT` (60%), `TRAILING_STOP_PCT` (20%), `MAX_HOLD_MINUTES` (240). Likvidlik butunlay yo'qolsa — to'liq zarar deb yoziladi.

Real savdoga o'tganda: **asosiy kapitalning faqat 5–10%ini alohida koshelyokda ushlang.**

---

## Bepul limitlarni asrash

- **Gemini** — tokenlar guruh bilan (`AI_BATCH_SIZE=15`) bitta so'rovda. 429 xatosida uzunroq kutib qayta uriniladi.
- **RPC** — token-bucket cheklagich. Zanjir tekshiruvi faqat arzon bozor filtridan o'tganlar uchun.
- **DexScreener** — bir so'rovda 30 tagacha token, 3 so'rov/soniya.
- **Dashboard** — narxlar 20 soniya keshlanadi.
- **Sikllar** bir-birining ustiga chiqmaydi.

---

## Loyiha tuzilishi

```
src/
├── index.ts              Ishga tushirish, sikllar, graceful shutdown
├── config.ts             Sozlamalar — majburiy o'zgaruvchi yo'q
├── notify.ts             Bildirishnomalar (UI + Telegram)
├── ingest/pumpportal.ts  WebSocket oqimi (reconnect + heartbeat)
├── market/               DexScreener + almashtiriladigan narx manbai
├── chain/                RPC + almashtiriladigan zanjir manbai
├── filter/screener.ts    ⭐ Deterministik filtr — AI yo'q
├── ai/analyst.ts         Gemini guruh tahlili
├── ai/heuristic.ts       Zaxira ballchi — ochiq formula
├── risk/manager.ts       ⭐ Qattiq limitlar, kill switch
├── trade/paper.ts        Virtual savdo + chiqish qoidalari
├── trade/live.ts         Real savdo — ataylab bloklangan
├── pipeline/loops.ts     Skrining → baholash → pozitsiya → natija
├── store/                Supabase yoki xotira — bir xil interfeys
├── web/                  Dashboard (HTTP server + sahifa)
├── demo/simulator.ts     Sun'iy ma'lumot, haqiqiy quvur
└── telegram/bot.ts       Buyruqlar
```

---

## Ma'lum cheklovlar

- **Top-10 xolder hisobi evristik.** Bonding curve / bassein hisobini ajratish uchun 50%dan ko'p ushlagan eng yirik hisob chiqarib tashlanadi. Aniqroq usul — hisob egasini tekshirish.
- **Xolderlar soni Helius'ga bog'liq.** Boshqa provayderda `null` qaytadi (yumshoq belgi).
- **Funding graf hali yo'q.** Dev reputatsiyasi bor, koshelyoklarni bitta manbaga bog'lovchi graf keyingi bosqichda.
- **Narrativ agenti hali yo'q.** Gemini'ning Google Search grounding funksiyasi bilan qo'shiladi.
- **Haftalik o'z-o'zini tahlil hali yo'q.** Jurnal to'lib boradi — tahlil shundan o'qiydi.

---

## Ogohlantirish

Bu dasturiy ta'minot **shaxsiy foydalanish va o'rganish uchun**. Moliyaviy maslahat emas.

Memcoin savdosi o'ta yuqori riskli — foydalanuvchilarning katta qismi pul yo'qotadi, hatto yaxshi tizim bilan ham. Yo'qotishga tayyor bo'lmagan pulni ishlatmang.

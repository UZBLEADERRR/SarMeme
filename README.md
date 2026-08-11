# SarMeme

Solana memcoin tokenlarini avtomatik tahlil qiluvchi va **virtual savdo** qiluvchi shaxsiy bot.

Butun stack bepul yoki deyarli bepul xizmatlarda ishlaydi — taxminan **$5/oy** (faqat Railway).

---

## Asosiy tamoyil

> **AI fikr beradi, kod qaror qabul qiladi.**

Til modeli hech qachon savdo qilmaydi. U faqat ball qo'yadi. Kirish-chiqish, pozitsiya hajmi va barcha risk limitlari qattiq kodda — `src/risk/manager.ts` va `src/trade/paper.ts` da.

Uchta qatlam:

```
1) DETERMINISTIK FILTR  (src/filter/screener.ts)    — AI yo'q, tez, arzon
   PumpPortal oqimi → mint/freeze authority, likvidlik, hajm,
   top-10 xolder ulushi, dev reputatsiyasi → ~99% tokenni rad etadi
                              ↓
2) AI TAHLIL  (src/ai/analyst.ts)                   — Gemini, guruh bilan
   Faqat filtrdan o'tganlar. 15 ta token = 1 ta so'rov.
   Strukturaviy JSON: {score, verdict, red_flags, narrative}
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

**Kamida 3–4 hafta shu rejimda ishlating.** Agar shu davrda minusda bo'lsa — real pul bilan ham minusda bo'lasiz, faqat tezroq. Real savdoni yoqishdan oldingi to'liq talablar ro'yxati `src/trade/live.ts` da.

---

## Strategiya: snayping emas

Bepul ma'lumot bilan launch'ning birinchi bloklarida yutib bo'lmaydi — Yellowstone gRPC ishlatadigan botlar tokenni 200–500ms oldin ko'radi.

Shuning uchun bot **token tug'ilgandan 5–180 daqiqa keyin** qaraydi (`MIN_AGE_MINUTES` / `MAX_AGE_MINUTES`). Bu vaqtda allaqachon ma'lum: likvidlik ushlandimi, snayperlar chiqib ketdimi, haqiqiy hajm bormi. 100x'dan mahrum bo'lasiz, lekin rug'larning katta qismidan qutulasiz.

---

## O'rnatish

### 1. Supabase (bepul)

1. [supabase.com](https://supabase.com) da yangi loyiha oching
2. **SQL Editor** → `supabase/schema.sql` faylini to'liq nusxalab ishga tushiring
3. **Project Settings → API** dan `URL` va `service_role` kalitini oling

### 2. Kalitlar

| Xizmat | Qayerdan | Narx |
|---|---|---|
| Helius RPC | [helius.dev](https://helius.dev) → free tier | Bepul |
| Gemini API | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Bepul tarif |
| Telegram bot | [@BotFather](https://t.me/BotFather) → `/newbot` | Bepul |
| Telegram chat ID | [@userinfobot](https://t.me/userinfobot) ga yozing | Bepul |
| PumpPortal | Kalit kerak emas | Bepul |
| DexScreener | Kalit kerak emas | Bepul |

### 3. Lokal ishga tushirish

```bash
npm install
cp .env.example .env     # keyin .env ni to'ldiring
npm run dev
```

Telegram'da botingizga `/status` yozing — javob kelsa, hammasi ishlayapti.

### 4. Railway'ga deploy

1. Repo'ni GitHub'ga push qiling
2. Railway → **New Project → Deploy from GitHub repo**
3. **Variables** bo'limiga `.env` dagi barcha o'zgaruvchilarni qo'shing
4. Deploy avtomatik boshlanadi (`railway.json` allaqachon sozlangan)

> **Bitta servis ishlating.** Postgres'ni Railway'da emas, Supabase'da (bepul) ushlang — aks holda oylik kredit tezroq tugaydi.

---

## Telegram buyruqlari

| Buyruq | Nima qiladi |
|---|---|
| `/status` | Rejim, kill switch, ochiq pozitsiyalar, kunlik PnL |
| `/positions` | Ochiq pozitsiyalar va joriy foyda/zarari |
| `/pnl` | Bugungi, 7 kunlik va umumiy natija |
| `/token <mint>` | Token bo'yicha oxirgi tekshiruv natijasi |
| `/kill` | 🛑 Darhol to'xtatish — yangi pozitsiya ochilmaydi |
| `/resume` | Kill switch'ni o'chirish |

Buyruqlar faqat `TELEGRAM_CHAT_ID` da ko'rsatilgan chatdan qabul qilinadi.

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

Chiqish qoidalari: `STOP_LOSS_PCT` (25%), `TAKE_PROFIT_PCT` (60%), `TRAILING_STOP_PCT` (20%), `MAX_HOLD_MINUTES` (240). Likvidlik butunlay yo'qolsa — to'liq zarar deb yoziladi.

Real savdoga o'tganda: **asosiy kapitalning faqat 5–10%ini alohida koshelyokda ushlang.**

---

## Bepul limitlarni asrash

Loyiha bepul tariflarda ishlashi uchun ataylab tejamkor:

- **Gemini** — tokenlar guruh bilan (`AI_BATCH_SIZE=15`) bitta so'rovda yuboriladi. 200 ta so'rov o'rniga ~4 ta. 429 xatosida uzunroq kutib qayta uriniladi.
- **RPC** — token-bucket cheklagich (`RPC_MAX_RPS=4`). Zanjir tekshiruvi faqat arzon bozor filtridan o'tganlar uchun bajariladi.
- **DexScreener** — bir so'rovda 30 tagacha token, 3 so'rov/soniya.
- **Sikllar bir-birining ustiga chiqmaydi** — oldingi ish tugamasa, yangisi o'tkazib yuboriladi.

---

## Loyiha tuzilishi

```
src/
├── index.ts              Ishga tushirish, sikllar, graceful shutdown
├── env.ts                .env yuklash (config'dan oldin import qilinadi)
├── config.ts             Barcha sozlamalar + tekshiruv
├── ingest/pumpportal.ts  WebSocket oqimi (reconnect + heartbeat)
├── market/dexscreener.ts Narx/likvidlik (guruh so'rovlari)
├── chain/rpc.ts          Mint authority, xolder konsentratsiyasi
├── filter/screener.ts    ⭐ Deterministik filtr — AI yo'q
├── ai/gemini.ts          Gemini REST mijozi (strukturaviy JSON)
├── ai/analyst.ts         Guruh tahlili, prompt va sxema
├── risk/manager.ts       ⭐ Qattiq limitlar, kill switch
├── trade/paper.ts        Virtual savdo + chiqish qoidalari
├── trade/live.ts         Real savdo — ataylab bloklangan
├── pipeline/loops.ts     Sikllar: skrining → AI → pozitsiya → natija
├── telegram/bot.ts       Buyruqlar va bildirishnomalar
└── db/                   Supabase mijozi va so'rovlar
```

---

## Ma'lum cheklovlar

Bular ataylab ochiq qoldirilgan — keyingi bosqichda yaxshilanadi:

- **Top-10 xolder hisobi evristik.** Bonding curve / bassein hisobini ajratish uchun 50%dan ko'p ushlagan eng yirik bitta hisob chiqarib tashlanadi (`src/chain/rpc.ts`). Aniqroq usul — hisob egasini (`owner`) tekshirish.
- **Xolderlar soni Helius'ga bog'liq.** `getTokenAccounts` boshqa provayderda yo'q; u holda `null` qaytadi va filtr buni yumshoq belgi sifatida qabul qiladi.
- **Funding graf hali yo'q.** Dev reputatsiyasi bor, lekin koshelyoklarni bitta manbaga bog'lovchi graf keyingi bosqichda.
- **Narrativ agenti hali yo'q.** Gemini'ning Google Search grounding funksiyasi bilan qo'shiladi.
- **Haftalik o'z-o'zini tahlil hali yo'q.** Jurnal (`journal` jadvali) allaqachon to'lib boradi — tahlil shundan o'qiydi.

---

## Ogohlantirish

Bu dasturiy ta'minot **shaxsiy foydalanish va o'rganish uchun**. Moliyaviy maslahat emas.

Memcoin savdosi o'ta yuqori riskli — foydalanuvchilarning katta qismi pul yo'qotadi, hatto yaxshi tizim bilan ham. Yo'qotishga tayyor bo'lmagan pulni ishlatmang. Real savdoni yoqishdan oldin `src/trade/live.ts` dagi to'liq ro'yxatni o'qing.

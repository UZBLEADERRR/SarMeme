import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { generateJson, type GeminiSchema } from './gemini.js';
import type { AiAnalysis, ScreenResult, Verdict } from '../types.js';

const log = createLogger('analyst');

const SYSTEM = `Sen Solana memcoin bozorini tahlil qiluvchi tajribali riskchi analitiksan.

Senga DETERMINISTIK FILTRDAN O'TGAN tokenlar ro'yxati beriladi. Ular allaqachon
asosiy xavfsizlik tekshiruvidan o'tgan (mint/freeze authority bekor qilingan,
minimal likvidlik va hajm bor). Sening vazifang — qolgan nozik risklarni topish
va har biriga ball qo'yish.

Nimalarga qara:
- Xolder konsentratsiyasi: top-10 ulushi qancha yuqori bo'lsa, dump xavfi shuncha katta.
- Dev tarixi: oldin rug qilganmi, nechta token chiqargan, omon qolganlari bormi.
- Likvidlik/kapitalizatsiya nisbati: likvidlik mcap'ga nisbatan juda kichik bo'lsa — chiqish qiyin.
- Savdo balansi: sotuvlar xaridlardan sezilarli ko'p bo'lsa — chiqish bosimi.
- Nom va simvol: taniqli brendga taqlid, obro'siz nusxa, spam pattern.
- Yosh: juda yosh token hali beqaror, juda eski token esa impulsni yo'qotgan bo'lishi mumkin.

Ball qo'yish (0-100):
- 0-39   → avoid  : aniq xavf yoki hech qanday ustunlik yo'q
- 40-69  → watch  : qiziq, lekin ishonchsiz
- 70-100 → enter  : ko'rsatkichlar mustahkam, risk boshqariladigan

MUHIM QOIDALAR:
- Ehtiyotkor bo'l. Shubha bo'lsa — pastroq ball. Bitta o'tkazib yuborilgan imkoniyat
  bitta rug'dan ancha arzon.
- Ma'lumot yetishmasa (masalan xolder soni noma'lum), buni belgila va ballni pasaytir.
- Faqat berilgan ma'lumot asosida hukm qil. Narx, hajm yoki tarixni o'zingdan to'qima.
- Har bir token uchun alohida javob ber. Ro'yxatdagi tokenlar bir-biriga bog'liq emas.
- Javobingdagi "mint" maydoni kirish ma'lumotidagi mint bilan aynan bir xil bo'lsin.`;

const SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      description: 'Har bir kiritilgan token uchun bitta natija',
      items: {
        type: 'OBJECT',
        properties: {
          mint: { type: 'STRING', description: 'Token mint manzili, kirishdagi bilan aynan bir xil' },
          score: { type: 'INTEGER', description: '0 dan 100 gacha ishonch bali' },
          verdict: { type: 'STRING', enum: ['avoid', 'watch', 'enter'] },
          narrative: { type: 'STRING', description: 'Token qaysi narrativga tegishli, bir jumla' },
          reasoning: { type: 'STRING', description: 'Ball nega shunday qo\'yilgani, 2-3 jumla' },
          red_flags: {
            type: 'ARRAY',
            description: 'Aniqlangan xavf belgilari, qisqa iboralar',
            items: { type: 'STRING' },
          },
        },
        required: ['mint', 'score', 'verdict', 'narrative', 'reasoning', 'red_flags'],
        propertyOrdering: ['mint', 'score', 'verdict', 'narrative', 'reasoning', 'red_flags'],
      },
    },
  },
  required: ['results'],
};

interface RawResult {
  mint: string;
  score: number;
  verdict: string;
  narrative: string;
  reasoning: string;
  red_flags: string[];
}

/** Har bir tokenni AI o'qiy oladigan ixcham faktlar to'plamiga aylantiradi. */
function describe(r: ScreenResult, symbol: string | null, name: string | null): string {
  const m = r.market;
  const c = r.chain;
  const d = r.dev;
  const n = (v: number | null | undefined, digits = 2) =>
    v === null || v === undefined ? 'noma\'lum' : v.toFixed(digits);

  const lines = [
    `mint: ${r.mint}`,
    `nom: ${name ?? 'noma\'lum'} (${symbol ?? '?'})`,
    `yosh: ${r.ageMinutes.toFixed(0)} daqiqa`,
    `likvidlik_usd: ${n(m.liquidityUsd, 0)}`,
    `kapitalizatsiya_usd: ${n(m.marketCapUsd, 0)}`,
    `hajm_5daq_usd: ${n(m.volume5mUsd, 0)}`,
    `hajm_1soat_usd: ${n(m.volume1hUsd, 0)}`,
    `xarid_5daq: ${m.txns5mBuys ?? 'noma\'lum'}`,
    `sotuv_5daq: ${m.txns5mSells ?? 'noma\'lum'}`,
    `dex: ${m.dexId ?? 'noma\'lum'}`,
    `top10_xolder_ulushi_pct: ${n(c.top10Pct, 1)}`,
    `xolderlar_soni: ${c.holderCount ?? 'noma\'lum'}`,
    `mint_authority_faol: ${c.mintAuthorityPresent === null ? 'noma\'lum' : c.mintAuthorityPresent}`,
    `freeze_authority_faol: ${c.freezeAuthorityPresent === null ? 'noma\'lum' : c.freezeAuthorityPresent}`,
  ];

  if (m.liquidityUsd && m.marketCapUsd && m.marketCapUsd > 0) {
    lines.push(`likvidlik_mcap_nisbati_pct: ${((m.liquidityUsd / m.marketCapUsd) * 100).toFixed(1)}`);
  }

  if (d) {
    lines.push(
      `dev_chiqargan_tokenlar: ${d.tokensCreated}`,
      `dev_ruglar: ${d.rugs}`,
      `dev_omon_qolganlar: ${d.survivors}`,
    );
  } else {
    lines.push('dev_tarixi: bazamizda yo\'q (birinchi marta ko\'ryapmiz)');
  }

  if (r.flags.length > 0) lines.push(`filtr_belgilari: ${r.flags.join(', ')}`);

  return lines.join('\n');
}

/**
 * Bir guruh tokenni BITTA so'rovda tahlil qiladi.
 *
 * Bu bepul tarifga sig'ishning asosiy usuli: 15 ta alohida so'rov o'rniga
 * 1 ta so'rov. Rate limit ham, token sarfi ham keskin kamayadi.
 */
export async function analyzeBatch(
  items: readonly { screen: ScreenResult; symbol: string | null; name: string | null }[],
): Promise<{ analyses: AiAnalysis[]; raw: unknown }> {
  if (items.length === 0) return { analyses: [], raw: null };

  const blocks = items.map((it, i) => `### Token ${i + 1}\n${describe(it.screen, it.symbol, it.name)}`);
  const prompt = `Quyidagi ${items.length} ta tokenni tahlil qil va har biriga ball qo'y.\n\n${blocks.join('\n\n')}`;

  log.info('tahlil yuborilmoqda', { tokens: items.length, model: config.gemini.modelFast });

  const res = await generateJson<{ results: RawResult[] }>({
    model: config.gemini.modelFast,
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    temperature: 0.2,
  });

  const wanted = new Set(items.map((it) => it.screen.mint));
  const analyses: AiAnalysis[] = [];

  for (const r of res.results ?? []) {
    // Model o'zidan mint to'qib qo'ymasligi uchun tekshiramiz.
    if (!wanted.has(r.mint)) {
      log.warn('noma\'lum mint qaytdi, tashlandi', { mint: r.mint });
      continue;
    }
    const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
    const verdict: Verdict =
      r.verdict === 'enter' || r.verdict === 'watch' || r.verdict === 'avoid'
        ? r.verdict
        : 'avoid';

    analyses.push({
      mint: r.mint,
      score,
      verdict,
      narrative: String(r.narrative ?? '').slice(0, 500),
      reasoning: String(r.reasoning ?? '').slice(0, 2000),
      redFlags: Array.isArray(r.red_flags) ? r.red_flags.map(String).slice(0, 20) : [],
    });
  }

  const missing = [...wanted].filter((m) => !analyses.some((a) => a.mint === m));
  if (missing.length > 0) log.warn('javobsiz qolgan tokenlar', { count: missing.length });

  return { analyses, raw: res };
}

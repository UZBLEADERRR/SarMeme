import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { getStore } from '../store/index.js';
import { fetchMarkets } from '../market/prices.js';
import { isKillSwitchOn, setKillSwitch, snapshot } from '../risk/manager.js';
import { recentNotifications } from '../notify.js';
import { PAGE } from './page.js';

const log = createLogger('web');

/**
 * Ochiq pozitsiyalar narxi uchun qisqa keshli olish.
 * Dashboard 3 soniyada bir yangilanadi — har safar DexScreener'ga borsak
 * bepul limitni bekorga sarflaymiz.
 */
let priceCache: { at: number; prices: Map<string, number | null> } = {
  at: 0,
  prices: new Map(),
};

async function pricesFor(mints: string[]): Promise<Map<string, number | null>> {
  if (mints.length === 0) return new Map();
  if (Date.now() - priceCache.at < 20_000) return priceCache.prices;

  const markets = await fetchMarkets(mints);
  const prices = new Map<string, number | null>();
  for (const m of mints) prices.set(m, markets.get(m)?.priceNativeSol ?? null);
  priceCache = { at: Date.now(), prices };
  return prices;
}

async function buildState(): Promise<unknown> {
  const store = getStore();
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [risk, counts, open, closed, analyses, checks, tokens, journal, devs] = await Promise.all([
    snapshot(),
    store.statusCounts(),
    store.listOpenPositions(),
    store.recentClosedPositions(25),
    store.recentAnalyses(25),
    store.recentChecks(30),
    store.recentTokens(30),
    store.recentJournal(30),
    store.topDevs(15),
  ]);

  const [today, week, all] = await Promise.all([
    store.pnlSince(startOfDay),
    store.pnlSince(new Date(Date.now() - 7 * 86_400_000)),
    store.pnlSince(new Date(0)),
  ]);

  const prices = await pricesFor(open.map((p) => p.mint));

  return {
    now: now.toISOString(),
    mode: config.tradingMode,
    isDemo: config.isDemo,
    simulate: config.simulate,
    capabilities: config.capabilities,
    engine: config.capabilities.ai === 'gemini' ? config.gemini.modelFast : 'evristika',
    limits: {
      bankrollSol: config.risk.bankrollSol,
      maxOpenPositions: config.risk.maxOpenPositions,
      maxPositionPct: config.risk.maxPositionPct,
      minAiScore: config.minAiScore,
    },
    risk,
    counts,
    pnl: { today, week, all },
    open: open.map((p) => {
      const price = prices.get(p.mint) ?? null;
      return {
        mint: p.mint,
        symbol: p.symbol,
        solIn: p.solIn,
        entryScore: p.entryScore,
        entryAt: p.entryAt.toISOString(),
        pnlPct: price === null ? null : ((price - p.entryPrice) / p.entryPrice) * 100,
      };
    }),
    closed: closed.map((p) => ({
      mint: p.mint,
      symbol: p.symbol,
      pnlSol: p.pnlSol,
      pnlPct: p.pnlPct,
      exitReason: p.exitReason,
      exitAt: p.exitAt?.toISOString() ?? null,
    })),
    analyses: analyses.map((a) => ({
      mint: a.mint,
      score: a.score,
      verdict: a.verdict,
      reasoning: a.reasoning,
      redFlags: a.redFlags,
      createdAt: a.createdAt.toISOString(),
    })),
    checks: checks.map((k) => ({
      mint: k.mint,
      passed: k.passed,
      flags: k.flags,
      liquidityUsd: k.liquidityUsd,
      marketCapUsd: k.marketCapUsd,
      top10Pct: k.top10Pct,
      holderCount: k.holderCount,
      checkedAt: k.checkedAt.toISOString(),
    })),
    tokens: tokens.map((t) => ({
      mint: t.mint,
      symbol: t.symbol,
      status: t.status,
      statusReason: t.statusReason,
      launchedAt: t.launchedAt.toISOString(),
    })),
    journal: journal.map((j) => ({ note: j.note, createdAt: j.createdAt.toISOString() })),
    notifications: recentNotifications(25).map((n) => ({ text: n.text, at: n.at.toISOString() })),
    devs,
  };
}

function authorized(req: IncomingMessage, url: URL): boolean {
  const expected = config.web.token;
  if (!expected) return true;
  const provided = url.searchParams.get('token') ?? req.headers['x-dashboard-token'];
  return provided === expected;
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * Dashboard va boshqaruv API'si.
 *
 * DASHBOARD_TOKEN qo'yilgan bo'lsa, har so'rov shu token bilan bo'lishi shart.
 * Railway'da ochiq URL bo'lgani uchun uni albatta qo'ying.
 */
export function startWebServer(): void {
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      try {
        if (url.pathname === '/health') {
          return send(res, 200, JSON.stringify({ ok: true }), 'application/json');
        }

        if (url.pathname === '/') {
          // Sahifaning o'zi ochiq — ma'lumot API'dan kelganda tekshiriladi.
          return send(res, 200, PAGE, 'text/html; charset=utf-8');
        }

        if (!authorized(req, url)) {
          return send(res, 401, JSON.stringify({ error: 'token' }), 'application/json');
        }

        if (url.pathname === '/api/state') {
          return send(res, 200, JSON.stringify(await buildState()), 'application/json');
        }

        if (req.method === 'POST' && (url.pathname === '/api/kill' || url.pathname === '/api/resume')) {
          const enable = url.pathname === '/api/kill';
          await setKillSwitch(enable, 'dashboard');
          return send(res, 200, JSON.stringify({ killSwitch: await isKillSwitchOn() }), 'application/json');
        }

        send(res, 404, JSON.stringify({ error: 'topilmadi' }), 'application/json');
      } catch (err) {
        log.error('so\'rov xatosi', { path: url.pathname, error: String(err) });
        send(res, 500, JSON.stringify({ error: String(err) }), 'application/json');
      }
    })();
  });

  server.listen(config.web.port, () => {
    log.info(`dashboard: http://localhost:${config.web.port}`);
    if (!config.web.token) {
      log.warn('DASHBOARD_TOKEN qo\'yilmagan — dashboard himoyalanmagan (Railway\'da albatta qo\'ying)');
    }
  });

  server.on('error', (err) => log.error('server xatosi', { error: String(err) }));
}

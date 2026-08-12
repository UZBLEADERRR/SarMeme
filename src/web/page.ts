/**
 * Dashboard sahifasi — bitta o'zi yetarli HTML fayl.
 * Tashqi CDN, shrift yoki kutubxona yo'q: Railway'da ham, lokal ham,
 * internetsiz ham bir xil ishlaydi.
 */
export const PAGE = /* html */ `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SarMeme</title>
<style>
  :root {
    --bg:#0b0e14; --panel:#121722; --panel2:#171d2b; --line:#232b3d;
    --text:#e6ecf5; --dim:#8b98ad; --accent:#7c5cff;
    --green:#25c685; --red:#ff5d6c; --amber:#ffb020; --blue:#4aa8ff;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--text); font-size:14px;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  code, .mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  a { color:var(--blue); text-decoration:none; }

  header {
    position:sticky; top:0; z-index:10; background:rgba(11,14,20,.92);
    backdrop-filter:blur(8px); border-bottom:1px solid var(--line);
    padding:14px 18px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  }
  .logo { font-weight:700; font-size:17px; letter-spacing:.5px; }
  .logo span { color:var(--accent); }
  .badge {
    padding:3px 10px; border-radius:999px; font-size:11px; font-weight:600;
    border:1px solid var(--line); background:var(--panel2); color:var(--dim);
  }
  .badge.paper { color:var(--blue); border-color:#28456b; background:#0f1c2e; }
  .badge.demo  { color:var(--amber); border-color:#5a4413; background:#251c08; }
  .badge.on    { color:var(--green); border-color:#1a5c40; background:#0c2419; }
  .badge.off   { color:var(--red); border-color:#5c2029; background:#261014; }
  .spacer { flex:1; }
  button {
    font:inherit; font-weight:600; cursor:pointer; padding:7px 14px; border-radius:8px;
    border:1px solid var(--line); background:var(--panel2); color:var(--text);
  }
  button:hover { border-color:var(--accent); }
  button.danger { border-color:#5c2029; color:var(--red); }
  button.good   { border-color:#1a5c40; color:var(--green); }

  main { padding:18px; max-width:1500px; margin:0 auto; }
  .grid { display:grid; gap:14px; }
  .stats { grid-template-columns:repeat(auto-fit,minmax(155px,1fr)); margin-bottom:16px; }
  .cols  { grid-template-columns:repeat(auto-fit,minmax(370px,1fr)); align-items:start; }

  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .card h2 {
    margin:0; padding:11px 14px; font-size:12px; font-weight:600; letter-spacing:.6px;
    text-transform:uppercase; color:var(--dim); border-bottom:1px solid var(--line);
    display:flex; align-items:center; gap:8px;
  }
  .card .body { padding:6px 0; max-height:420px; overflow-y:auto; }

  .stat { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:13px 15px; }
  .stat .k { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
  .stat .v { font-size:23px; font-weight:700; margin-top:5px; }
  .stat .s { color:var(--dim); font-size:11px; margin-top:3px; }

  .row { padding:9px 14px; border-bottom:1px solid var(--line); }
  .row:last-child { border-bottom:none; }
  .row .top { display:flex; align-items:center; gap:8px; }
  .row .sub { color:var(--dim); font-size:12px; margin-top:3px; line-height:1.5; }
  .name { font-weight:600; }
  .mint { color:var(--dim); font-size:11px; }

  .pill { font-size:10px; padding:2px 7px; border-radius:5px; border:1px solid var(--line); color:var(--dim); white-space:nowrap; }
  .pill.pass { color:var(--green); border-color:#1a5c40; }
  .pill.fail { color:var(--red); border-color:#5c2029; }
  .pill.warn { color:var(--amber); border-color:#5a4413; }
  .flags { display:flex; flex-wrap:wrap; gap:4px; margin-top:5px; }

  .score { font-weight:700; font-size:15px; min-width:30px; text-align:right; }
  .pos { color:var(--green); } .neg { color:var(--red); }

  .funnel { padding:12px 14px; }
  .fstep { display:flex; align-items:center; gap:10px; margin-bottom:7px; font-size:12px; }
  .fstep .lab { width:105px; color:var(--dim); flex-shrink:0; }
  .fstep .bar { height:20px; border-radius:5px; background:var(--accent); min-width:3px; opacity:.85; }
  .fstep .num { font-weight:700; }

  .empty { padding:26px 14px; text-align:center; color:var(--dim); font-size:13px; }
  .note { padding:11px 14px; background:#251c08; border-bottom:1px solid var(--line); color:#ffd580; font-size:12px; line-height:1.6; }
  footer { padding:20px; text-align:center; color:var(--dim); font-size:12px; }
</style>
</head>
<body>
<header>
  <div class="logo">Sar<span>Meme</span></div>
  <div id="badges" style="display:flex;gap:7px;flex-wrap:wrap"></div>
  <div class="spacer"></div>
  <span id="clock" class="badge"></span>
  <button id="killBtn">…</button>
</header>

<main>
  <div class="grid stats" id="stats"></div>
  <div class="grid cols" id="cols"></div>
</main>

<footer>SarMeme — shaxsiy tahlil boti · virtual savdo · 3 soniyada yangilanadi</footer>

<script>
const $ = (id) => document.getElementById(id);
const TOKEN = new URLSearchParams(location.search).get('token') || '';
const qs = TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const short = (m) => !m ? '' : m.slice(0, 4) + '…' + m.slice(-4);
const sol = (n) => (n >= 0 ? '+' : '') + Number(n).toFixed(4);
const usd = (n) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
const pct = (n) => n == null ? '—' : Number(n).toFixed(1) + '%';

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'daq';
  if (s < 86400) return Math.floor(s / 3600) + 'soat';
  return Math.floor(s / 86400) + 'kun';
}

function card(title, extra, inner) {
  return '<div class="card"><h2>' + esc(title) +
    (extra ? '<span class="pill">' + esc(extra) + '</span>' : '') +
    '</h2><div class="body">' + (inner || '<div class="empty">Hali ma\\'lumot yo\\'q</div>') + '</div></div>';
}

function stat(k, v, s, cls) {
  return '<div class="stat"><div class="k">' + esc(k) + '</div>' +
    '<div class="v ' + (cls || '') + '">' + v + '</div>' +
    '<div class="s">' + esc(s || '') + '</div></div>';
}

function render(d) {
  // ── Bayroqlar ────────────────────────────────────────────────────────
  const caps = d.capabilities;
  const badges = [
    '<span class="badge ' + (d.isDemo ? 'demo' : 'paper') + '">' +
      (d.simulate ? 'SIMULYATSIYA' : d.isDemo ? 'DEMO REJIM' : (d.mode === 'paper' ? 'PAPER — virtual savdo' : 'LIVE')) + '</span>',
    '<span class="badge ' + (caps.database === 'supabase' ? 'on' : '') + '">Baza: ' +
      (caps.database === 'supabase' ? 'Supabase' : 'xotira') + '</span>',
    '<span class="badge ' + (caps.ai === 'gemini' ? 'on' : '') + '">AI: ' +
      (caps.ai === 'gemini' ? 'Gemini' : 'evristika') + '</span>',
    '<span class="badge ' + (caps.telegram ? 'on' : '') + '">Telegram: ' + (caps.telegram ? 'ulangan' : 'yo\\'q') + '</span>',
    '<span class="badge ' + (caps.chain ? 'on' : '') + '">RPC: ' + (caps.chain ? 'ulangan' : 'yo\\'q') + '</span>',
  ];
  $('badges').innerHTML = badges.join('');

  $('clock').textContent = new Date(d.now).toLocaleTimeString('uz-UZ');

  const kb = $('killBtn');
  kb.textContent = d.risk.killSwitch ? '▶ Davom ettirish' : '⏹ To\\'xtatish';
  kb.className = d.risk.killSwitch ? 'good' : 'danger';

  // ── Statistika ───────────────────────────────────────────────────────
  const c = d.counts || {};
  const seen = Object.values(c).reduce((a, b) => a + b, 0);
  const watching = (c.watching || 0);
  const traded = (c.traded || 0);
  const wr = d.pnl.all.trades > 0 ? Math.round(d.pnl.all.wins / d.pnl.all.trades * 100) : 0;

  $('stats').innerHTML = [
    stat('Ko\\'rilgan token', seen.toLocaleString('en-US'), 'oqim boshlanganidan beri'),
    stat('Filtrdan o\\'tgan', watching + traded, 'tahlilga yuborilgan'),
    stat('Ochiq pozitsiya', d.risk.openPositions + '/' + d.limits.maxOpenPositions,
         d.risk.exposureSol.toFixed(3) + ' / ' + d.limits.bankrollSol + ' SOL'),
    stat('Bugungi PnL', sol(d.pnl.today.realizedSol),
         d.pnl.today.trades + ' savdo · limit ' + d.risk.dailyLossLimitSol.toFixed(3),
         d.pnl.today.realizedSol >= 0 ? 'pos' : 'neg'),
    stat('Umumiy PnL', sol(d.pnl.all.realizedSol),
         d.pnl.all.trades + ' savdo · win-rate ' + wr + '%',
         d.pnl.all.realizedSol >= 0 ? 'pos' : 'neg'),
  ].join('');

  // ── Voronka ──────────────────────────────────────────────────────────
  const steps = [
    ['Ko\\'rildi', seen],
    ['Filtrdan o\\'tdi', watching + traded],
    ['AI baholadi', d.analyses.length],
    ['Kirildi', traded],
  ];
  const max = Math.max(1, ...steps.map(s => s[1]));
  const funnel = '<div class="funnel">' + steps.map(([lab, n]) =>
    '<div class="fstep"><div class="lab">' + esc(lab) + '</div>' +
    '<div class="bar" style="width:' + (n / max * 100) + '%"></div>' +
    '<div class="num">' + n + '</div></div>').join('') +
    '<div style="color:var(--dim);font-size:11px;margin-top:8px;line-height:1.6">' +
    'Har bosqich oldingisining kichik qismini o\\'tkazadi — bu ataylab shunday. ' +
    'Filtr qimmat tekshiruvlarni faqat nomzodlarga sarflaydi.</div></div>';

  // ── Ochiq pozitsiyalar ───────────────────────────────────────────────
  const open = d.open.map(p => {
    const cls = p.pnlPct == null ? '' : (p.pnlPct >= 0 ? 'pos' : 'neg');
    return '<div class="row"><div class="top">' +
      '<span class="name">' + esc(p.symbol || short(p.mint)) + '</span>' +
      '<span class="pill">ball ' + (p.entryScore ?? '?') + '</span>' +
      '<div class="spacer" style="flex:1"></div>' +
      '<span class="score ' + cls + '">' + (p.pnlPct == null ? '—' : pct(p.pnlPct)) + '</span></div>' +
      '<div class="sub">' + p.solIn.toFixed(4) + ' SOL · ' + ago(p.entryAt) + ' oldin · ' +
      '<span class="mint mono">' + esc(short(p.mint)) + '</span></div></div>';
  }).join('');

  // ── Yopilgan pozitsiyalar ────────────────────────────────────────────
  const closed = d.closed.map(p => {
    const cls = (p.pnlSol ?? 0) >= 0 ? 'pos' : 'neg';
    return '<div class="row"><div class="top">' +
      '<span class="name">' + esc(p.symbol || short(p.mint)) + '</span>' +
      '<div style="flex:1"></div>' +
      '<span class="score ' + cls + '">' + sol(p.pnlSol ?? 0) + '</span></div>' +
      '<div class="sub">' + esc(p.exitReason || '') + ' · ' + pct(p.pnlPct) + '</div></div>';
  }).join('');

  // ── AI tahlillari ────────────────────────────────────────────────────
  const analyses = d.analyses.map(a => {
    const cls = a.verdict === 'enter' ? 'pass' : a.verdict === 'watch' ? 'warn' : 'fail';
    const scls = a.score >= 70 ? 'pos' : a.score < 40 ? 'neg' : '';
    return '<div class="row"><div class="top">' +
      '<span class="mono mint">' + esc(short(a.mint)) + '</span>' +
      '<span class="pill ' + cls + '">' + esc(a.verdict) + '</span>' +
      '<div style="flex:1"></div>' +
      '<span class="score ' + scls + '">' + a.score + '</span></div>' +
      '<div class="sub">' + esc(a.reasoning) + '</div>' +
      (a.redFlags.length ? '<div class="flags">' + a.redFlags.map(f =>
        '<span class="pill fail">' + esc(f) + '</span>').join('') + '</div>' : '') +
      '</div>';
  }).join('');

  // ── Skrining ─────────────────────────────────────────────────────────
  const checks = d.checks.map(k =>
    '<div class="row"><div class="top">' +
    '<span class="pill ' + (k.passed ? 'pass' : 'fail') + '">' + (k.passed ? 'o\\'tdi' : 'rad') + '</span>' +
    '<span class="mono mint">' + esc(short(k.mint)) + '</span>' +
    '<div style="flex:1"></div>' +
    '<span class="mint">' + ago(k.checkedAt) + '</span></div>' +
    '<div class="sub">likv ' + usd(k.liquidityUsd) + ' · mcap ' + usd(k.marketCapUsd) +
    ' · top10 ' + pct(k.top10Pct) + ' · xolder ' + (k.holderCount ?? '—') + '</div>' +
    (k.flags.length ? '<div class="flags">' + k.flags.map(f =>
      '<span class="pill ' + (k.passed ? 'warn' : 'fail') + '">' + esc(f) + '</span>').join('') + '</div>' : '') +
    '</div>').join('');

  // ── Oqim ─────────────────────────────────────────────────────────────
  const tokens = d.tokens.map(t =>
    '<div class="row"><div class="top">' +
    '<span class="name">' + esc(t.symbol || '?') + '</span>' +
    '<span class="pill">' + esc(t.status) + '</span>' +
    '<div style="flex:1"></div>' +
    '<span class="mint">' + ago(t.launchedAt) + '</span></div>' +
    '<div class="sub mono">' + esc(short(t.mint)) + (t.statusReason ? ' · ' + esc(t.statusReason) : '') + '</div>' +
    '</div>').join('');

  // ── Bildirishnomalar ─────────────────────────────────────────────────
  const notes = d.notifications.map(nt =>
    '<div class="row"><div class="sub" style="color:var(--text);white-space:pre-wrap">' +
    esc(nt.text) + '</div><div class="sub">' + ago(nt.at) + ' oldin</div></div>').join('');

  // ── Devlar ───────────────────────────────────────────────────────────
  const devs = d.devs.map(v =>
    '<div class="row"><div class="top">' +
    '<span class="mono mint">' + esc(short(v.address)) + '</span>' +
    '<div style="flex:1"></div>' +
    (v.rugs > 0 ? '<span class="pill fail">' + v.rugs + ' rug</span>' : '') +
    (v.survivors > 0 ? '<span class="pill pass">' + v.survivors + ' omon</span>' : '') +
    '</div><div class="sub">' + v.tokensCreated + ' ta token chiqargan</div></div>').join('');

  const simNote = d.simulate
    ? '<div class="note" style="background:#2a1420;color:#ffb3c8;border-color:#5c2029"><b>⚠️ SIMULYATSIYA REJIMI.</b> ' +
      'Tokenlar, narxlar va likvidlik — sun\\'iy. Filtr, ballchi, risk menejeri va chiqish qoidalari esa HAQIQIY kod. ' +
      'Bu tizim qanday ishlashini ko\\'rsatadi, lekin strategiya foydali yoki foydasizligini ISBOTLAMAYDI.</div>'
    : '';

  const demoNote = d.isDemo
    ? '<div class="note"><b>Demo rejim.</b> Supabase, Gemini va Telegram sozlanmagan — ' +
      'baza xotirada (qayta ishga tushganda tozalanadi), ball evristik formula bilan qo\\'yiladi. ' +
      'Tokenlar oqimi va narxlar esa HAQIQIY: PumpPortal va DexScreener kalit talab qilmaydi.</div>'
    : '';

  $('cols').innerHTML = [
    '<div class="card"><h2>Quvur</h2>' + simNote + demoNote + funnel + '</div>',
    card('Ochiq pozitsiyalar', d.open.length + ' ta', open),
    card('AI baholari', d.engine, analyses),
    card('Skrining natijalari', '', checks),
    card('Yangi tokenlar oqimi', '', tokens),
    card('Yopilgan savdolar', '', closed),
    card('Bildirishnomalar', '', notes),
    card('Dev reputatsiyasi', '', devs),
  ].join('');
}

async function tick() {
  try {
    const res = await fetch('/api/state' + qs);
    if (res.status === 401) {
      document.body.innerHTML = '<div class="empty" style="padding:60px">Token noto\\'g\\'ri. URL oxiriga <code>?token=...</code> qo\\'shing.</div>';
      return;
    }
    render(await res.json());
  } catch (e) {
    $('clock').textContent = 'aloqa yo\\'q';
  }
}

$('killBtn').onclick = async () => {
  const stop = $('killBtn').className === 'danger';
  await fetch('/api/' + (stop ? 'kill' : 'resume') + qs, { method: 'POST' });
  tick();
};

tick();
setInterval(tick, 3000);
</script>
</body>
</html>`;

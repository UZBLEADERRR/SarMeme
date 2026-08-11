-- SarMeme — Supabase sxemasi
-- Supabase Dashboard → SQL Editor → shu faylni to'liq nusxalab ishga tushiring.

create extension if not exists "pgcrypto";

-- ── Devlar (o'z reputatsiya bazamiz — RPC so'rovsiz, bepul) ──────────────────
create table if not exists devs (
  address           text primary key,
  tokens_created    int         not null default 0,
  rugs              int         not null default 0,
  survivors         int         not null default 0,
  best_liquidity_usd numeric    not null default 0,
  avg_lifetime_min  numeric,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  notes             text
);

-- ── Ko'rilgan har bir token ─────────────────────────────────────────────────
create table if not exists tokens (
  mint          text primary key,
  symbol        text,
  name          text,
  creator       text references devs(address),
  uri           text,
  pool          text,
  source        text        not null default 'pumpportal',
  launched_at   timestamptz,
  first_seen_at timestamptz not null default now(),
  -- new → screened(rad etilgan) | watching → analyzed → traded | dead
  status        text        not null default 'new',
  status_reason text,
  updated_at    timestamptz not null default now()
);

create index if not exists tokens_status_seen_idx on tokens (status, first_seen_at desc);
create index if not exists tokens_creator_idx     on tokens (creator);

-- ── Deterministik xavfsizlik tekshiruvi (AI'siz) ────────────────────────────
create table if not exists token_checks (
  id              bigserial primary key,
  mint            text        not null references tokens(mint) on delete cascade,
  checked_at      timestamptz not null default now(),
  mint_authority  boolean,
  freeze_authority boolean,
  liquidity_usd   numeric,
  market_cap_usd  numeric,
  volume_5m_usd   numeric,
  price_usd       numeric,
  holder_count    int,
  top10_pct       numeric,
  age_minutes     numeric,
  passed          boolean     not null,
  flags           jsonb       not null default '[]'::jsonb
);

create index if not exists token_checks_mint_idx on token_checks (mint, checked_at desc);

-- ── AI tahlil natijalari ────────────────────────────────────────────────────
create table if not exists analyses (
  id          bigserial primary key,
  mint        text        not null references tokens(mint) on delete cascade,
  model       text        not null,
  score       int         not null,
  verdict     text        not null,          -- avoid | watch | enter
  narrative   text,
  reasoning   text,
  red_flags   jsonb       not null default '[]'::jsonb,
  raw         jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists analyses_mint_idx on analyses (mint, created_at desc);

-- ── Pozitsiyalar (paper va live bir jadvalda, mode bilan ajratiladi) ────────
create table if not exists positions (
  id            uuid        primary key default gen_random_uuid(),
  mint          text        not null references tokens(mint) on delete cascade,
  symbol        text,
  mode          text        not null default 'paper',  -- paper | live
  status        text        not null default 'open',   -- open | closed
  entry_score   int,
  sol_in        numeric     not null,
  entry_price   numeric     not null,
  qty           numeric     not null,
  entry_at      timestamptz not null default now(),
  peak_price    numeric,
  exit_price    numeric,
  sol_out       numeric,
  exit_at       timestamptz,
  exit_reason   text,
  pnl_sol       numeric,
  pnl_pct       numeric
);

create index if not exists positions_status_idx on positions (status, entry_at desc);
create index if not exists positions_mint_idx   on positions (mint);

-- ── Savdo jurnali (keyinchalik AI shu yerdan o'rganadi) ─────────────────────
create table if not exists journal (
  id          bigserial primary key,
  position_id uuid        references positions(id) on delete cascade,
  mint        text,
  author      text        not null default 'system',  -- system | ai | user
  note        text        not null,
  data        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists journal_created_idx on journal (created_at desc);

-- ── Bot holati (kill switch, kunlik PnL, hisoblagichlar) ────────────────────
create table if not exists bot_state (
  key        text primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

insert into bot_state (key, value) values ('kill_switch', '{"enabled": false}'::jsonb)
  on conflict (key) do nothing;

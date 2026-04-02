"use strict";

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const STARTING_C = 1000;
const ADMIN_USER = "admin";
const ADMIN_DISCORD = "LeagueAdmin";

const DEFAULT_MARKETS = [
  {
    id: "def-r1-winner",
    ticker: "R1-WIN",
    title: "Azure Motors wins Race 1 (Monza layout)",
    subtitle: "Official league race result",
    category: "Races",
    yesBid: 38,
    yesAsk: 42,
    volume: 2400,
  },
  {
    id: "def-fastest-q",
    ticker: "R3-FL",
    title: "Driver @Swift sets fastest lap in Race 3 qualifying",
    subtitle: "League timing board",
    category: "Drivers",
    yesBid: 22,
    yesAsk: 26,
    volume: 1800,
  },
  {
    id: "def-team-champ",
    ticker: "26-CHAMP",
    title: "Crimson Racing wins the 2026 constructors title",
    subtitle: "End of season standings",
    category: "Season",
    yesBid: 45,
    yesAsk: 49,
    volume: 9200,
  },
  {
    id: "def-safety",
    ticker: "R5-SC",
    title: "Safety car deploys during Race 5",
    subtitle: "Stewards log",
    category: "Races",
    yesBid: 51,
    yesAsk: 55,
    volume: 3100,
  },
  {
    id: "def-pit",
    ticker: "R2-SUB2",
    title: "Sub-2.0s pit stop recorded by any team in Race 2",
    subtitle: "League pit telemetry",
    category: "Teams",
    yesBid: 33,
    yesAsk: 37,
    volume: 1400,
  },
  {
    id: "def-league-rule",
    ticker: "LG-DRS",
    title: "League enables DRS for all tracks before Round 8",
    subtitle: "League announcement",
    category: "League",
    yesBid: 60,
    yesAsk: 64,
    volume: 800,
  },
];

function openDatabase(dbPath) {
  const db = Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      discord TEXT NOT NULL COLLATE NOCASE,
      role TEXT NOT NULL DEFAULT 'user',
      approved INTEGER NOT NULL DEFAULT 0,
      balance INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS positions (
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('yes','no')),
      qty INTEGER NOT NULL,
      avg_cents INTEGER NOT NULL,
      PRIMARY KEY (user_id, market_id, side),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL UNIQUE COLLATE NOCASE,
      title TEXT NOT NULL,
      subtitle TEXT,
      category TEXT NOT NULL,
      yes_bid INTEGER NOT NULL,
      yes_ask INTEGER NOT NULL,
      volume INTEGER NOT NULL DEFAULT 0,
      builtin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS deleted_builtin_markets (
      market_id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      t INTEGER NOT NULL,
      mid INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_price_history_market ON price_history(market_id);
  `);
  return db;
}

function normalizeDiscord(s) {
  let t = String(s || "").trim();
  t = t.replace(/^@+/, "");
  if (t.includes("#")) t = t.split("#")[0].trim();
  return t;
}

function lastPrice(yesBid, yesAsk) {
  return Math.round((yesBid + yesAsk) / 2);
}

function generateSyntheticHistory(mid, count) {
  const out = [];
  const now = Date.now();
  const step = 45 * 60 * 1000;
  let v = mid + (Math.random() * 10 - 5);
  for (let i = 0; i < count; i++) {
    v = Math.max(1, Math.min(99, v + (Math.random() * 5 - 2.5)));
    out.push({ t: now - (count - 1 - i) * step, mid: Math.round(v) });
  }
  if (out.length) out[out.length - 1].mid = mid;
  return out;
}

function seedDefaultMarkets(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO markets (id, ticker, title, subtitle, category, yes_bid, yes_ask, volume, builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const m of DEFAULT_MARKETS) {
    insert.run(
      m.id,
      m.ticker,
      m.title,
      m.subtitle || "",
      m.category,
      m.yesBid,
      m.yesAsk,
      m.volume
    );
  }
}

function ensurePriceHistory(db, marketId, yesBid, yesAsk) {
  const n = db.prepare("SELECT COUNT(*) as c FROM price_history WHERE market_id = ?").get(marketId);
  if (n.c > 0) return;
  const mid = lastPrice(yesBid, yesAsk);
  const pts = generateSyntheticHistory(mid, 48);
  const ins = db.prepare("INSERT INTO price_history (market_id, t, mid) VALUES (?, ?, ?)");
  const run = db.transaction((points) => {
    for (const p of points) ins.run(marketId, p.t, p.mid);
  });
  run(pts);
}

function seedAdmin(db, adminPassword) {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(ADMIN_USER);
  if (existing) return;
  const id = "u-admin";
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, discord, role, approved, balance, created_at)
     VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)`
  ).run(id, ADMIN_USER, hash, ADMIN_DISCORD, STARTING_C, Date.now());
}

function rowToMarket(r) {
  return {
    id: r.id,
    ticker: r.ticker,
    title: r.title,
    subtitle: r.subtitle || "",
    category: r.category,
    yesBid: r.yes_bid,
    yesAsk: r.yes_ask,
    volume: r.volume,
    builtin: !!r.builtin,
  };
}

function getMarketsPayload(db) {
  const deleted = new Set(
    db.prepare("SELECT market_id FROM deleted_builtin_markets").all().map((x) => x.market_id)
  );
  const rows = db
    .prepare(
      `SELECT * FROM markets ORDER BY builtin DESC, ticker`
    )
    .all();
  const markets = [];
  for (const r of rows) {
    if (r.builtin && deleted.has(r.id)) continue;
    markets.push(rowToMarket(r));
  }
  const history = {};
  const midStmt = db.prepare("SELECT t, mid FROM price_history WHERE market_id = ? ORDER BY t ASC");
  for (const m of markets) {
    ensurePriceHistory(db, m.id, m.yesBid, m.yesAsk);
    history[m.id] = midStmt.all(m.id).map((x) => ({ t: x.t, mid: x.mid }));
  }
  return { markets, history };
}

function getUserWithPositions(db, userId) {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!u) return null;
  const positions = db
    .prepare("SELECT market_id as marketId, side, qty, avg_cents as avgCents FROM positions WHERE user_id = ?")
    .all(userId);
  return {
    id: u.id,
    username: u.username,
    discord: u.discord,
    role: u.role,
    approved: !!u.approved,
    balance: u.balance,
    positions,
  };
}

module.exports = {
  openDatabase,
  normalizeDiscord,
  lastPrice,
  seedDefaultMarkets,
  seedAdmin,
  ensurePriceHistory,
  getMarketsPayload,
  getUserWithPositions,
  rowToMarket,
  DEFAULT_MARKETS,
  STARTING_C,
  ADMIN_USER,
  ADMIN_DISCORD,
};

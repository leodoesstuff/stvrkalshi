"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const {
  openDatabase,
  normalizeDiscord,
  lastPrice,
  seedDefaultMarkets,
  seedAdmin,
  ensurePriceHistory,
  getMarketsPayload,
  getUserWithPositions,
  rowToMarket,
  STARTING_C,
  ADMIN_USER,
} = require("./db");

const CENTS = 100;
const JWT_SECRET = process.env.JWT_SECRET || "grid-dev-secret-change-me";
const ADMIN_PASSWORD = process.env.GRID_ADMIN_PASSWORD || "QWERTYUIOP";
const PORT = Number(process.env.PORT) || 3000;

const dbPath = process.env.GRID_DB_PATH || path.join(__dirname, "data", "grid.sqlite");
const fs = require("fs");
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = openDatabase(dbPath);
seedDefaultMarkets(db);
seedAdmin(db, ADMIN_PASSWORD);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "512kb" }));

function noPrices(yesBid, yesAsk) {
  return { noBid: CENTS - yesAsk, noAsk: CENTS - yesBid };
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  const token = h && h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) {
    req.userId = null;
    return next();
  }
  try {
    const p = jwt.verify(token, JWT_SECRET);
    req.userId = p.sub;
  } catch {
    req.userId = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
  const u = getUserWithPositions(db, req.userId);
  if (!u) return res.status(401).json({ error: "Unauthorized" });
  req.user = u;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/markets", authMiddleware, (req, res) => {
  try {
    const payload = getMarketsPayload(db);
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const discord = normalizeDiscord(req.body.discord);
  if (!username || username.length < 2 || !password || password.length < 4) {
    return res.status(400).json({ error: "Invalid username or password" });
  }
  if (!discord) return res.status(400).json({ error: "Discord username required" });
  const du = discord.toLowerCase();
  if (
    db.prepare("SELECT 1 FROM users WHERE lower(discord) = ?").get(du)
  ) {
    return res.status(400).json({ error: "That Discord username is already registered" });
  }
  if (db.prepare("SELECT 1 FROM users WHERE lower(username) = lower(?)").get(username)) {
    return res.status(400).json({ error: "That username is taken" });
  }
  const id = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, discord, role, approved, balance, created_at)
     VALUES (?, ?, ?, ?, 'user', 0, 0, ?)`
  ).run(id, username, hash, discord, Date.now());
  res.status(201).json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Wrong username or password" });
  }
  const user = getUserWithPositions(db, row.id);
  const token = signToken(row.id);
  res.json({ token, user });
});

app.get("/api/me", authMiddleware, requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/leaderboard", authMiddleware, requireAuth, (req, res) => {
  const payload = getMarketsPayload(db);
  const marketMap = new Map(payload.markets.map((m) => [m.id, m]));
  function netWorthFor(userId) {
    const u = getUserWithPositions(db, userId);
    if (!u) return 0;
    let mtm = 0;
    for (const p of u.positions) {
      const m = marketMap.get(p.marketId);
      if (!m) continue;
      const mark =
        p.side === "yes" ? lastPrice(m.yesBid, m.yesAsk) : CENTS - lastPrice(m.yesBid, m.yesAsk);
      mtm += mark * p.qty;
    }
    return u.balance + mtm;
  }
  const rows = db
    .prepare(`SELECT id FROM users WHERE approved = 1 AND role = 'user' ORDER BY username`)
    .all();
  const ranked = rows
    .map((r) => ({
      id: r.id,
      netWorth: netWorthFor(r.id),
      user: getUserWithPositions(db, r.id),
    }))
    .sort((a, b) => b.netWorth - a.netWorth);
  res.json({ leaderboard: ranked });
});

app.get("/api/admin/pending", authMiddleware, requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare(`SELECT id, username, discord FROM users WHERE role = 'user' AND approved = 0`)
    .all();
  res.json({ pending: rows });
});

app.post("/api/admin/users/:id/approve", authMiddleware, requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(id);
  if (!row || row.approved) return res.status(404).json({ error: "User not found" });
  db.prepare("UPDATE users SET approved = 1, balance = ? WHERE id = ?").run(STARTING_C, id);
  res.json({ ok: true, user: getUserWithPositions(db, id) });
});

app.delete("/api/admin/users/:id", authMiddleware, requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user' AND approved = 0").get(id);
  if (!row) return res.status(404).json({ error: "Pending user not found" });
  db.prepare("DELETE FROM positions WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.post("/api/admin/markets", authMiddleware, requireAuth, requireAdmin, (req, res) => {
  const title = String(req.body.title || "").trim();
  const subtitle = String(req.body.subtitle || "").trim();
  let ticker = String(req.body.ticker || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const category = String(req.body.category || "League");
  const yesBid = parseInt(req.body.yesBid, 10);
  const yesAsk = parseInt(req.body.yesAsk, 10);
  const volume = Math.max(0, parseInt(req.body.volume, 10) || 0);
  if (!ticker) return res.status(400).json({ error: "Ticker required" });
  if (db.prepare("SELECT 1 FROM markets WHERE ticker = ?").get(ticker)) {
    return res.status(400).json({ error: "Ticker already used" });
  }
  if (yesBid < 1 || yesBid > 97 || yesAsk < 2 || yesAsk > 99 || yesAsk <= yesBid) {
    return res.status(400).json({ error: "Invalid bid/ask" });
  }
  const id = "bet-" + randomUUID().replace(/-/g, "").slice(0, 12);
  db.prepare(
    `INSERT INTO markets (id, ticker, title, subtitle, category, yes_bid, yes_ask, volume, builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(id, ticker, title, subtitle || "League resolution", category, yesBid, yesAsk, volume);
  const m = rowToMarket(db.prepare("SELECT * FROM markets WHERE id = ?").get(id));
  ensurePriceHistory(db, m.id, m.yesBid, m.yesAsk);
  res.status(201).json({ market: m });
});

app.delete("/api/markets/:id", authMiddleware, requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM markets WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Market not found" });
  if (row.builtin) {
    db.prepare("INSERT OR IGNORE INTO deleted_builtin_markets (market_id) VALUES (?)").run(id);
  } else {
    db.prepare("DELETE FROM markets WHERE id = ?").run(id);
  }
  db.prepare("DELETE FROM price_history WHERE market_id = ?").run(id);
  res.json({ ok: true });
});

app.post("/api/trade", authMiddleware, requireAuth, (req, res) => {
  const u = req.user;
  if (!u.approved && u.role !== "admin") {
    return res.status(403).json({ error: "Account not approved" });
  }
  const marketId = String(req.body.marketId || "");
  const side = req.body.side === "no" ? "no" : "yes";
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 0);
  const mrow = db.prepare("SELECT * FROM markets WHERE id = ?").get(marketId);
  if (!mrow) return res.status(404).json({ error: "Market not found" });
  const deleted = db.prepare("SELECT 1 FROM deleted_builtin_markets WHERE market_id = ?").get(marketId);
  if (mrow.builtin && deleted) return res.status(404).json({ error: "Market not found" });

  const m = rowToMarket(mrow);
  const ask = side === "yes" ? m.yesAsk : noPrices(m.yesBid, m.yesAsk).noAsk;
  const cost = ask * qty;
  if (cost > u.balance) return res.status(400).json({ error: "Not enough C" });

  const trade = db.transaction(() => {
    db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(cost, u.id);
    const ex = db
      .prepare("SELECT qty, avg_cents FROM positions WHERE user_id = ? AND market_id = ? AND side = ?")
      .get(u.id, marketId, side);
    if (ex) {
      const totalQty = ex.qty + qty;
      const newAvg = Math.round((ex.avg_cents * ex.qty + ask * qty) / totalQty);
      db.prepare(
        "UPDATE positions SET qty = ?, avg_cents = ? WHERE user_id = ? AND market_id = ? AND side = ?"
      ).run(totalQty, newAvg, u.id, marketId, side);
    } else {
      db.prepare(
        "INSERT INTO positions (user_id, market_id, side, qty, avg_cents) VALUES (?, ?, ?, ?, ?)"
      ).run(u.id, marketId, side, qty, ask);
    }
    db.prepare("UPDATE markets SET volume = volume + ? WHERE id = ?").run(qty, marketId);
    const mid = lastPrice(m.yesBid, m.yesAsk);
    db.prepare("INSERT INTO price_history (market_id, t, mid) VALUES (?, ?, ?)").run(
      marketId,
      Date.now(),
      mid
    );
    const countRow = db.prepare("SELECT COUNT(*) as c FROM price_history WHERE market_id = ?").get(marketId);
    const c = countRow.c;
    if (c > 160) {
      const toRemove = c - 160;
      const oldIds = db
        .prepare("SELECT id FROM price_history WHERE market_id = ? ORDER BY t ASC LIMIT ?")
        .all(marketId, toRemove);
      for (const r of oldIds) {
        db.prepare("DELETE FROM price_history WHERE id = ?").run(r.id);
      }
    }
  });

  try {
    trade();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Trade failed" });
  }

  const user = getUserWithPositions(db, u.id);
  const payload = getMarketsPayload(db);
  res.json({ user, markets: payload.markets, history: payload.history });
});

const staticDir = path.join(__dirname, "..");
app.use(express.static(staticDir));

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(staticDir, "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => {
  console.log(`Grid server http://localhost:${PORT}`);
});

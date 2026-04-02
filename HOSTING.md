# Hosting Grid (with backend)

The app is a **static frontend** (`index.html`, `styles.css`, `app.js`) plus a **Node.js API** that uses **SQLite** for shared data across all users.

## Local development

1. Install [Node.js](https://nodejs.org/) (LTS).
2. In a terminal:

```bash
cd kalshi-like/server
npm install
cd ..
npm start
```

3. Open **http://localhost:3000** (same origin — the API is at `/api/*`).

The database file is created at `server/data/grid.sqlite` (override with `GRID_DB_PATH`).

### Environment variables (optional)

Create `server/.env` (see `server/.env.example`):

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default `3000`) |
| `JWT_SECRET` | Signing key for login tokens — **set a long random string in production** |
| `GRID_ADMIN_PASSWORD` | Password for the seeded admin account (`admin` / Discord `LeagueAdmin`) |
| `GRID_DB_PATH` | Absolute path to SQLite file if you want it outside `server/data/` |

## Production deployment

You need a host that can run **Node.js** and keep one process running (or use a platform “Web Service”).

### Render / Railway / Fly.io

1. Set the **root directory** to `kalshi-like` (or the repo root that contains `server/` and the HTML assets).
2. **Build command:** `cd server && npm install` (or install from repo root if you add a workspace).
3. **Start command:** `node server/index.js` (or `npm start` from `kalshi-like` with the provided `package.json`).
4. Set `JWT_SECRET` and optionally `GRID_ADMIN_PASSWORD` in the platform’s environment UI.
5. Use a **persistent disk** or volume for `server/data/` so SQLite survives restarts.

### VPS (systemd / PM2)

1. Clone the repo, run `npm install` in `server/`.
2. Run `node server/index.js` behind **nginx** reverse proxy to port 3000 with HTTPS.
3. Point nginx `root` at the `kalshi-like` folder for static files, or rely on Express (it already serves `index.html` and static assets).

### Important

- **HTTPS** in production so tokens are not sent in clear text.
- **Back up** `grid.sqlite` regularly.
- Do **not** commit real `JWT_SECRET` or database files to git.

## API overview

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/health` | Health check |
| GET | `/api/markets` | Markets + price history (public) |
| POST | `/api/auth/register` | New account (pending approval) |
| POST | `/api/auth/login` | Returns JWT |
| GET | `/api/me` | Current user (requires `Authorization: Bearer …`) |
| GET | `/api/leaderboard` | Approved players |
| POST | `/api/trade` | Place order |
| POST | `/api/admin/markets` | Create bet (admin) |
| DELETE | `/api/markets/:id` | Delete bet (admin) |
| GET | `/api/admin/pending` | Pending sign-ups (admin) |
| POST | `/api/admin/users/:id/approve` | Approve user (admin) |
| DELETE | `/api/admin/users/:id` | Reject pending user (admin) |

Opening `index.html` directly as `file://` will **not** work with the API; always use the server URL.

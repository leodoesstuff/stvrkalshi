(function () {
  "use strict";

  const CENTS = 100;
  const TOKEN_KEY = "grid_token";
  const API = "/api";

  const state = {
    token: null,
    me: null,
    markets: [],
    history: {},
  };

  const ui = {
    category: "all",
    search: "",
    selectedId: null,
  };

  function normalizeDiscord(s) {
    let t = String(s || "").trim();
    t = t.replace(/^@+/, "");
    if (t.includes("#")) t = t.split("#")[0].trim();
    return t;
  }

  function userBalance(u) {
    if (!u) return 0;
    return typeof u.balance === "number" ? u.balance : 0;
  }

  function currentUser() {
    return state.me;
  }

  function allMarkets() {
    return state.markets;
  }

  function getMarket(id) {
    return state.markets.find((m) => m.id === id);
  }

  function getMidPoints(marketId) {
    const h = state.history[marketId];
    return Array.isArray(h) ? h : [];
  }

  function formatC(amount) {
    const n = Math.round(amount);
    const s = Math.abs(n).toLocaleString("en-US");
    return (n < 0 ? "−" : "") + s + " C";
  }

  function formatVol(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
    return String(Math.round(n));
  }

  function noPrices(yesBid, yesAsk) {
    return {
      noBid: CENTS - yesAsk,
      noAsk: CENTS - yesBid,
    };
  }

  function lastPrice(yesBid, yesAsk) {
    return Math.round((yesBid + yesAsk) / 2);
  }

  function filteredMarkets() {
    const q = ui.search.trim().toLowerCase();
    return state.markets.filter((m) => {
      if (ui.category !== "all" && m.category !== ui.category) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.ticker.toLowerCase().includes(q) ||
        (m.subtitle && m.subtitle.toLowerCase().includes(q))
      );
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  async function api(path, opts) {
    const headers = Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || {});
    if (state.token) headers.Authorization = "Bearer " + state.token;
    const r = await fetch(API + path, Object.assign({}, opts, { headers }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || r.statusText || "Request failed");
      err.status = r.status;
      throw err;
    }
    return data;
  }

  function applyMarketsPayload(payload) {
    state.markets = payload.markets || [];
    state.history = payload.history || {};
  }

  async function loadMarkets() {
    const payload = await api("/markets", { method: "GET" });
    applyMarketsPayload(payload);
  }

  async function refreshMe() {
    const data = await api("/me", { method: "GET" });
    state.me = data.user;
  }

  function drawSparkline(canvas, points) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!points || points.length < 2) return;
    const mids = points.map((p) => p.mid);
    const min = Math.min(...mids) - 1;
    const max = Math.max(...mids) + 1;
    const pad = 3;
    const rng = max - min || 1;
    ctx.strokeStyle = "rgba(0, 162, 255, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((p.mid - min) / rng) * (h - 2 * pad);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function drawAreaChart(canvas, points, cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!points || points.length < 2) return;
    const mids = points.map((p) => p.mid);
    const min = Math.min(...mids) - 1;
    const max = Math.max(...mids) + 1;
    const padX = 8;
    const padY = 10;
    const rng = max - min || 1;
    const line = [];
    points.forEach((p, i) => {
      const x = padX + (i / (points.length - 1)) * (cssW - 2 * padX);
      const y = cssH - padY - ((p.mid - min) / rng) * (cssH - 2 * padY);
      line.push({ x, y, mid: p.mid });
    });
    const grd = ctx.createLinearGradient(0, 0, 0, cssH);
    grd.addColorStop(0, "rgba(0, 162, 255, 0.35)");
    grd.addColorStop(1, "rgba(0, 162, 255, 0)");
    ctx.beginPath();
    ctx.moveTo(line[0].x, cssH - padY);
    line.forEach((pt) => ctx.lineTo(pt.x, pt.y));
    ctx.lineTo(line[line.length - 1].x, cssH - padY);
    ctx.closePath();
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(0, 210, 106, 0.95)";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    line.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.fillStyle = "#8b93a7";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(String(max) + "¢", cssW - padX, padY + 4);
    ctx.textAlign = "left";
    ctx.fillText(String(min) + "¢", padX, cssH - 4);
  }

  function drawAllSparklines() {
    document.querySelectorAll(".spark-canvas").forEach((canvas) => {
      const id = canvas.getAttribute("data-id");
      drawSparkline(canvas, getMidPoints(id));
    });
  }

  const els = {
    authScreen: document.getElementById("auth-screen"),
    pendingScreen: document.getElementById("pending-screen"),
    pendingDiscordLine: document.getElementById("pending-discord-line"),
    btnPendingLogout: document.getElementById("btn-pending-logout"),
    app: document.getElementById("app"),
    formLogin: document.getElementById("form-login"),
    formRegister: document.getElementById("form-register"),
    authError: document.getElementById("auth-error"),
    navAdmin: document.getElementById("nav-admin"),
    thAdmin: document.getElementById("th-admin"),
    userPill: document.getElementById("user-pill"),
    btnLogout: document.getElementById("btn-logout"),
    cash: document.getElementById("cash-balance"),
    marketRows: document.getElementById("market-rows"),
    positionRows: document.getElementById("position-rows"),
    portfolioEmpty: document.getElementById("portfolio-empty"),
    search: document.getElementById("market-search"),
    categoryFilters: document.getElementById("category-filters"),
    viewMarkets: document.getElementById("view-markets"),
    viewPortfolio: document.getElementById("view-portfolio"),
    viewLeaderboard: document.getElementById("view-leaderboard"),
    leaderboardRows: document.getElementById("leaderboard-rows"),
    viewAdmin: document.getElementById("view-admin"),
    pendingApprovalRows: document.getElementById("pending-approval-rows"),
    pendingEmpty: document.getElementById("pending-empty"),
    adminCreateForm: document.getElementById("admin-create-form"),
    drawer: document.getElementById("drawer"),
    drawerBackdrop: document.getElementById("drawer-backdrop"),
    drawerClose: document.getElementById("drawer-close"),
    drawerTicker: document.getElementById("drawer-ticker"),
    drawerTitle: document.getElementById("drawer-title"),
    drawerMeta: document.getElementById("drawer-meta"),
    yesBid: document.getElementById("yes-bid"),
    yesAsk: document.getElementById("yes-ask"),
    noBid: document.getElementById("no-bid"),
    noAsk: document.getElementById("no-ask"),
    orderForm: document.getElementById("order-form"),
    qty: document.getElementById("qty"),
    estCost: document.getElementById("est-cost"),
    submitOrder: document.getElementById("submit-order"),
    toast: document.getElementById("toast"),
    drawerChart: document.getElementById("drawer-chart"),
    chartRangeLabel: document.getElementById("chart-range-label"),
  };

  function drawDrawerChart(marketId) {
    const canvas = els.drawerChart;
    if (!canvas || !canvas.parentElement) return;
    const wrap = canvas.parentElement;
    const cssW = Math.max(280, Math.min(wrap.clientWidth || 360, 520));
    const cssH = 140;
    const pts = getMidPoints(marketId);
    const n = pts.length;
    if (els.chartRangeLabel) {
      els.chartRangeLabel.textContent = n ? n + " pts · YES mid (¢)" : "No data";
    }
    drawAreaChart(canvas, pts, cssW, cssH);
  }

  function showAuthError(msg) {
    if (!msg) {
      els.authError.hidden = true;
      els.authError.textContent = "";
      return;
    }
    els.authError.hidden = false;
    els.authError.textContent = msg;
  }

  function showApp() {
    els.authScreen.classList.add("hidden");
    if (els.pendingScreen) els.pendingScreen.classList.add("hidden");
    els.app.classList.remove("hidden");
  }

  function showPending() {
    if (els.pendingScreen) {
      els.authScreen.classList.add("hidden");
      els.app.classList.add("hidden");
      els.pendingScreen.classList.remove("hidden");
      const u = currentUser();
      if (els.pendingDiscordLine && u) {
        els.pendingDiscordLine.textContent = "Discord: @" + (u.discord || "");
      }
    }
  }

  function showAuth() {
    els.app.classList.add("hidden");
    if (els.pendingScreen) els.pendingScreen.classList.add("hidden");
    els.authScreen.classList.remove("hidden");
    state.token = null;
    state.me = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  function updateRoleUi() {
    const u = currentUser();
    const isAdmin = u && u.role === "admin";
    els.navAdmin.classList.toggle("hidden", !isAdmin);
    els.thAdmin.classList.toggle("hidden", !isAdmin);
    if (u) {
      els.userPill.textContent =
        "@" + u.username + " · " + (u.discord || "?") + (isAdmin ? " · admin" : "");
    }
  }

  function renderCash() {
    const u = currentUser();
    if (!u) return;
    els.cash.textContent = formatC(userBalance(u));
  }

  function renderMarkets() {
    const u = currentUser();
    const isAdmin = u && u.role === "admin";
    const list = filteredMarkets();
    els.marketRows.innerHTML = list
      .map((m) => {
        const last = lastPrice(m.yesBid, m.yesAsk);
        let adminCell;
        if (isAdmin) {
          adminCell = `<td class="num admin-only"><button type="button" class="btn-danger btn-mini" data-del="${escapeHtml(
            m.id
          )}">Delete</button></td>`;
        } else {
          adminCell = `<td class="admin-only hidden" aria-hidden="true"></td>`;
        }
        return `
        <tr data-id="${escapeHtml(m.id)}">
          <td class="event-cell">
            ${escapeHtml(m.title)}
            <span class="event-sub">${escapeHtml(m.subtitle || "")} · ${escapeHtml(m.category)}</span>
          </td>
          <td><span class="ticker">${escapeHtml(m.ticker)}</span></td>
          <td class="num mono price-yes">${m.yesBid}¢</td>
          <td class="num mono price-yes">${m.yesAsk}¢</td>
          <td class="num mono">${last}¢</td>
          <td class="num mono">${formatVol(m.volume)}</td>
          <td class="spark-cell"><canvas class="spark-canvas" data-id="${escapeHtml(
            m.id
          )}" width="88" height="36" role="img" aria-label="YES mid trend"></canvas></td>
          ${adminCell}
        </tr>
      `;
      })
      .join("");

    requestAnimationFrame(function () {
      drawAllSparklines();
    });

    els.marketRows.querySelectorAll("tr").forEach((row) => {
      row.addEventListener("click", (e) => {
        const t = e.target;
        if (t && t.closest && t.closest("button[data-del]")) return;
        openDrawer(row.dataset.id);
      });
    });

    els.marketRows.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeMarket(btn.getAttribute("data-del"));
      });
    });
  }

  async function removeMarket(id) {
    const m = getMarket(id);
    if (!m) return;
    if (!confirm("Delete this bet from the board? Positions stay in portfolios but the market will disappear.")) return;
    try {
      await api("/markets/" + encodeURIComponent(id), { method: "DELETE" });
      await loadMarkets();
      if (ui.selectedId === id) closeDrawer();
      initCategories();
      renderMarkets();
      await renderLeaderboard();
      showToast("Bet deleted.");
    } catch (e) {
      showToast(e.message || "Failed to delete");
    }
  }

  function renderPortfolio() {
    const u = currentUser();
    if (!u) return;
    const hasAny = u.positions.length > 0;
    els.portfolioEmpty.classList.toggle("visible", !hasAny);

    els.positionRows.innerHTML = u.positions
      .map((p) => {
        const m = getMarket(p.marketId);
        if (!m) {
          return `
          <tr>
            <td colspan="6" class="muted">Orphan position (${escapeHtml(p.marketId)}) — market removed</td>
          </tr>`;
        }
        const mark =
          p.side === "yes" ? lastPrice(m.yesBid, m.yesAsk) : CENTS - lastPrice(m.yesBid, m.yesAsk);
        const costBasis = p.avgCents * p.qty;
        const mtm = mark * p.qty;
        const pnl = mtm - costBasis;
        const sideLabel = p.side === "yes" ? "YES" : "NO";
        const pnlClass = pnl >= 0 ? "price-yes" : "price-no";
        return `
        <tr>
          <td>${escapeHtml(m.title)}<br/><span class="ticker">${escapeHtml(m.ticker)}</span></td>
          <td><span class="mono ${p.side === "yes" ? "price-yes" : "price-no"}">${sideLabel}</span></td>
          <td class="num mono">${p.qty}</td>
          <td class="num mono">${p.avgCents}¢</td>
          <td class="num mono">${mark}¢</td>
          <td class="num mono ${pnlClass}">${pnl >= 0 ? "+" : ""}${formatC(pnl)}</td>
        </tr>
      `;
      })
      .join("");
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }

  function openDrawer(id) {
    const m = getMarket(id);
    if (!m) return;
    ui.selectedId = id;
    const { noBid, noAsk } = noPrices(m.yesBid, m.yesAsk);
    els.drawerTicker.textContent = m.ticker;
    els.drawerTitle.textContent = m.title;
    els.drawerMeta.textContent = (m.subtitle || "") + " · " + m.category;
    els.yesBid.textContent = m.yesBid + "¢";
    els.yesAsk.textContent = m.yesAsk + "¢";
    els.noBid.textContent = noBid + "¢";
    els.noAsk.textContent = noAsk + "¢";
    els.drawer.classList.add("open");
    els.drawer.setAttribute("aria-hidden", "false");
    updateEstCost();
    requestAnimationFrame(function () {
      drawDrawerChart(id);
    });
  }

  function closeDrawer() {
    els.drawer.classList.remove("open");
    els.drawer.setAttribute("aria-hidden", "true");
    ui.selectedId = null;
  }

  function getOrderSide() {
    const r = els.orderForm.querySelector('input[name="side"]:checked');
    return r ? r.value : "yes";
  }

  function updateEstCost() {
    const u = currentUser();
    const m = getMarket(ui.selectedId);
    if (!u || !m) return;
    const qty = Math.max(1, parseInt(els.qty.value, 10) || 0);
    const side = getOrderSide();
    const ask = side === "yes" ? m.yesAsk : noPrices(m.yesBid, m.yesAsk).noAsk;
    const cost = ask * qty;
    els.estCost.textContent = formatC(cost);
    const can = cost <= userBalance(u);
    els.submitOrder.disabled = !can || qty < 1;
  }

  async function placeOrder(e) {
    e.preventDefault();
    const u = currentUser();
    const m = getMarket(ui.selectedId);
    if (!u || !m) return;
    const qty = Math.max(1, parseInt(els.qty.value, 10) || 0);
    const side = getOrderSide();
    try {
      const data = await api("/trade", {
        method: "POST",
        body: JSON.stringify({
          marketId: m.id,
          side,
          qty,
        }),
      });
      state.me = data.user;
      applyMarketsPayload({ markets: data.markets, history: data.history });
      renderCash();
      renderMarkets();
      renderPortfolio();
      await renderLeaderboard();
      if (ui.selectedId === m.id) {
        requestAnimationFrame(function () {
          drawDrawerChart(m.id);
        });
      }
      const ask = side === "yes" ? m.yesAsk : noPrices(m.yesBid, m.yesAsk).noAsk;
      const cost = ask * qty;
      showToast(`Bought ${qty} ${side.toUpperCase()} @ ${ask}¢ — ${m.ticker} · ${formatC(cost)}`);
      updateEstCost();
    } catch (err) {
      showToast(err.message || "Trade failed");
    }
  }

  function initCategories() {
    const cats = ["all", ...new Set(state.markets.map((m) => m.category))];
    els.categoryFilters.innerHTML = cats
      .map((c) => {
        const label = c === "all" ? "All" : c;
        const active = ui.category === c ? " active" : "";
        return `<button type="button" class="filter-chip${active}" data-cat="${escapeHtml(c)}">${escapeHtml(
          label
        )}</button>`;
      })
      .join("");

    els.categoryFilters.querySelectorAll(".filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.category = btn.dataset.cat;
        els.categoryFilters.querySelectorAll(".filter-chip").forEach((b) => {
          b.classList.toggle("active", b.dataset.cat === ui.category);
        });
        renderMarkets();
      });
    });
  }

  function initNav() {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        els.viewMarkets.classList.toggle("hidden", view !== "markets");
        els.viewPortfolio.classList.toggle("hidden", view !== "portfolio");
        if (els.viewLeaderboard) {
          els.viewLeaderboard.classList.toggle("hidden", view !== "leaderboard");
        }
        els.viewAdmin.classList.toggle("hidden", view !== "admin");
        if (view === "leaderboard") renderLeaderboard();
        if (view === "admin") renderPendingApprovals();
      });
    });
  }

  async function onLoginSubmit(e) {
    e.preventDefault();
    showAuthError("");
    const fd = new FormData(els.formLogin);
    const username = String(fd.get("username") || "").trim();
    const password = String(fd.get("password") || "");
    try {
      state.token = null;
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      state.token = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      state.me = data.user;
      if (!data.user.approved && data.user.role !== "admin") {
        showPending();
        return;
      }
      await loadMarkets();
      enterApp();
    } catch (err) {
      showAuthError(err.message || "Login failed");
    }
  }

  async function onRegisterSubmit(e) {
    e.preventDefault();
    showAuthError("");
    const fd = new FormData(els.formRegister);
    const username = String(fd.get("username") || "").trim();
    const password = String(fd.get("password") || "");
    const discord = normalizeDiscord(fd.get("discord"));
    if (!discord) {
      showAuthError("Discord username is required.");
      return;
    }
    try {
      state.token = null;
      localStorage.removeItem(TOKEN_KEY);
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password, discord }),
      });
      showToast("Account created. Wait for an admin to approve you, then sign in.");
      els.formRegister.reset();
      const loginTab = document.querySelector('.auth-tab[data-auth="login"]');
      if (loginTab) loginTab.click();
    } catch (err) {
      showAuthError(err.message || "Registration failed");
    }
  }

  function enterApp() {
    showApp();
    updateRoleUi();
    ui.search = "";
    els.search.value = "";
    ui.category = "all";
    initCategories();
    renderCash();
    renderMarkets();
    renderPortfolio();
    renderLeaderboard();
    renderPendingApprovals();
  }

  async function renderLeaderboard() {
    if (!els.leaderboardRows) return;
    const me = currentUser();
    try {
      const data = await api("/leaderboard", { method: "GET" });
      const ranked = data.leaderboard || [];
      els.leaderboardRows.innerHTML = ranked
        .map((row, i) => {
          const u = row.user;
          const isYou = me && u.id === me.id;
          const you = isYou ? ' <span class="badge-you">You</span>' : "";
          return `
        <tr class="${isYou ? "is-you" : ""}">
          <td class="num mono">${i + 1}</td>
          <td class="mono">${escapeHtml(u.discord)}${you}</td>
          <td>${escapeHtml(u.username)}</td>
          <td class="num mono">${formatC(userBalance(u))}</td>
          <td class="num mono">${formatC(row.netWorth)}</td>
        </tr>`;
        })
        .join("");
    } catch {
      els.leaderboardRows.innerHTML = "";
    }
  }

  async function renderPendingApprovals() {
    if (!els.pendingApprovalRows || !els.pendingEmpty) return;
    try {
      const data = await api("/admin/pending", { method: "GET" });
      const rows = data.pending || [];
      els.pendingEmpty.classList.toggle("visible", rows.length === 0);
      els.pendingApprovalRows.innerHTML = rows
        .map(
          (u) => `
      <tr data-id="${escapeHtml(u.id)}">
        <td class="mono">${escapeHtml(u.discord)}</td>
        <td>${escapeHtml(u.username)}</td>
        <td class="num">
          <button type="button" class="btn primary btn-mini" data-approve="${escapeHtml(u.id)}">Approve</button>
          <button type="button" class="btn-danger btn-mini" data-reject="${escapeHtml(u.id)}">Reject</button>
        </td>
      </tr>`
        )
        .join("");
      els.pendingApprovalRows.querySelectorAll("[data-approve]").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          approveUser(btn.getAttribute("data-approve"));
        });
      });
      els.pendingApprovalRows.querySelectorAll("[data-reject]").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          rejectUser(btn.getAttribute("data-reject"));
        });
      });
    } catch {
      els.pendingApprovalRows.innerHTML = "";
    }
  }

  async function approveUser(id) {
    try {
      await api("/admin/users/" + encodeURIComponent(id) + "/approve", { method: "POST" });
      await renderPendingApprovals();
      await renderLeaderboard();
      showToast("Approved — 1,000 C granted.");
    } catch (e) {
      showToast(e.message || "Failed");
    }
  }

  async function rejectUser(id) {
    if (!confirm("Reject and delete this sign-up?")) return;
    try {
      await api("/admin/users/" + encodeURIComponent(id), { method: "DELETE" });
      if (currentUser() && currentUser().id === id) {
        showToast("Your sign-up was rejected.");
        logout();
        return;
      }
      await renderPendingApprovals();
      await renderLeaderboard();
      showToast("Sign-up rejected.");
    } catch (e) {
      showToast(e.message || "Failed");
    }
  }

  function logout() {
    closeDrawer();
    showAuth();
    showAuthError("");
  }

  async function onAdminCreate(e) {
    e.preventDefault();
    const u = currentUser();
    if (!u || u.role !== "admin") return;
    const fd = new FormData(els.adminCreateForm);
    const title = String(fd.get("title") || "").trim();
    const subtitle = String(fd.get("subtitle") || "").trim();
    const ticker = String(fd.get("ticker") || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const category = String(fd.get("category") || "League");
    const yesBid = parseInt(fd.get("yesBid"), 10);
    const yesAsk = parseInt(fd.get("yesAsk"), 10);
    const volume = Math.max(0, parseInt(fd.get("volume"), 10) || 0);
    try {
      await api("/admin/markets", {
        method: "POST",
        body: JSON.stringify({
          title,
          subtitle,
          ticker,
          category,
          yesBid,
          yesAsk,
          volume,
        }),
      });
      await loadMarkets();
      els.adminCreateForm.reset();
      const yb = els.adminCreateForm.querySelector('[name="yesBid"]');
      const ya = els.adminCreateForm.querySelector('[name="yesAsk"]');
      if (yb) yb.value = "40";
      if (ya) ya.value = "45";
      initCategories();
      renderMarkets();
      await renderLeaderboard();
      showToast("Bet published: " + ticker);
    } catch (err) {
      showToast(err.message || "Failed to create bet");
    }
  }

  function initAuthTabs() {
    document.querySelectorAll(".auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const mode = tab.dataset.auth;
        document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
        els.formLogin.classList.toggle("hidden", mode !== "login");
        els.formRegister.classList.toggle("hidden", mode !== "register");
        showAuthError("");
      });
    });
  }

  async function boot() {
    initAuthTabs();
    els.formLogin.addEventListener("submit", onLoginSubmit);
    els.formRegister.addEventListener("submit", onRegisterSubmit);
    els.btnLogout.addEventListener("click", logout);
    if (els.btnPendingLogout) els.btnPendingLogout.addEventListener("click", logout);

    els.search.addEventListener("input", () => {
      ui.search = els.search.value;
      renderMarkets();
    });

    els.drawerBackdrop.addEventListener("click", closeDrawer);
    els.drawerClose.addEventListener("click", closeDrawer);
    els.orderForm.addEventListener("submit", placeOrder);
    els.qty.addEventListener("input", updateEstCost);
    els.orderForm.querySelectorAll('input[name="side"]').forEach((r) => {
      r.addEventListener("change", updateEstCost);
    });
    els.adminCreateForm.addEventListener("submit", onAdminCreate);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.drawer.classList.contains("open")) closeDrawer();
    });

    initNav();

    window.addEventListener("resize", function () {
      if (ui.selectedId && els.drawer.classList.contains("open")) {
        drawDrawerChart(ui.selectedId);
      }
    });

    state.token = localStorage.getItem(TOKEN_KEY);
    if (state.token) {
      try {
        const data = await api("/me", { method: "GET" });
        state.me = data.user;
        if (!state.me.approved && state.me.role !== "admin") {
          showPending();
        } else {
          await loadMarkets();
          enterApp();
        }
      } catch {
        state.token = null;
        localStorage.removeItem(TOKEN_KEY);
        state.me = null;
        showAuth();
      }
    } else {
      showAuth();
    }
  }

  boot();
})();

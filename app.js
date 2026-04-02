(function () {
  "use strict";

  const TOKEN_KEY = "grid_token";
  const API_URL = "PASTE_YOUR_GOOGLE_SCRIPT_URL_HERE";

  const state = {
    token: null,
    me: null,
    markets: [],
    history: {}
  };

  // 🔥 REPLACED API FUNCTION (THIS IS THE MAGIC)
  async function api(path, opts = {}) {
    const body = opts.body ? JSON.parse(opts.body) : {};

    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        path: path,
        token: state.token,
        ...body
      })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  function $(id) {
    return document.getElementById(id);
  }

  async function loadMarkets() {
    const data = await api("/markets");
    state.markets = data.markets;
    renderMarkets();
  }

  function renderMarkets() {
    const container = $("market-rows");
    container.innerHTML = "";

    state.markets.forEach(m => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${m.title}</td>
        <td>${m.ticker}</td>
        <td class="num">${m.yesBid}¢</td>
        <td class="num">${m.yesAsk}¢</td>
        <td class="num">${Math.round((m.yesBid+m.yesAsk)/2)}¢</td>
        <td class="num">${m.volume}</td>
        <td></td>
      `;

      row.onclick = () => openTrade(m);
      container.appendChild(row);
    });
  }

  function openTrade(m) {
    const qty = prompt("Contracts?");
    if (!qty) return;

    const side = confirm("OK = YES, Cancel = NO") ? "yes" : "no";

    api("/trade", {
      method: "POST",
      body: JSON.stringify({
        marketId: m.id,
        side: side,
        qty: parseInt(qty)
      })
    }).then(() => {
      loadMarkets();
      alert("Trade placed");
    });
  }

  async function login(username, password) {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    state.token = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);

    $("auth-screen").classList.add("hidden");
    $("app").classList.remove("hidden");

    loadMarkets();
  }

  function initAuth() {
    $("form-login").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      login(fd.get("username"), fd.get("password"));
    };
  }

  function boot() {
    initAuth();

    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      state.token = token;
      $("auth-screen").classList.add("hidden");
      $("app").classList.remove("hidden");
      loadMarkets();
    }
  }

  boot();

})();

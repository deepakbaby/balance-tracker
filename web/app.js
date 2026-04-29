const STORAGE_KEY = "deepak.balance-tracker.snapshots.v1";
const API_BASE = localStorage.getItem("balance-api-base") || "http://localhost:8787";
const CRYPTO_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  MATIC: "matic-network",
  LINK: "chainlink",
};

const seedState = {
  accounts: [],
  transactions: [],
  holdings: [],
  chats: [
    {
      id: crypto.randomUUID(),
      role: "agent",
      text: "Ready. Try: added 1500 to account1, withdraw 200 from account2 for renovation, or bought 2 AAPL at 170 now 190.",
      createdAt: new Date().toISOString(),
    },
  ],
  snapshots: [],
};

let state = loadState();
let isAuthenticated = false;

const els = {
  netWorth: document.querySelector("#netWorth"),
  netWorthDelta: document.querySelector("#netWorthDelta"),
  cashTotal: document.querySelector("#cashTotal"),
  portfolioTotal: document.querySelector("#portfolioTotal"),
  pnlTotal: document.querySelector("#pnlTotal"),
  portfolioLiveValue: document.querySelector("#portfolioLiveValue"),
  portfolioLivePnl: document.querySelector("#portfolioLivePnl"),
  portfolioKpis: document.querySelector("#portfolioKpis"),
  portfolioXray: document.querySelector("#portfolioXray"),
  portfolioXrayLabel: document.querySelector("#portfolioXrayLabel"),
  priceStatus: document.querySelector("#priceStatus"),
  activityList: document.querySelector("#activityList"),
  accountList: document.querySelector("#accountList"),
  holdingList: document.querySelector("#holdingList"),
  accountBars: document.querySelector("#accountBars"),
  categoryBars: document.querySelector("#categoryBars"),
  accountSplitLabel: document.querySelector("#accountSplitLabel"),
  chart: document.querySelector("#netWorthChart"),
  analysisChart: document.querySelector("#analysisChart"),
  monthlyInflow: document.querySelector("#monthlyInflow"),
  monthlyOutflow: document.querySelector("#monthlyOutflow"),
  savingsRate: document.querySelector("#savingsRate"),
  runwayMonths: document.querySelector("#runwayMonths"),
  signalList: document.querySelector("#signalList"),
  signalCount: document.querySelector("#signalCount"),
  chatLog: document.querySelector("#chatLog"),
  chatInput: document.querySelector("#chatInput"),
  lockScreen: document.querySelector("#lockScreen"),
};

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return seedState;
  try {
    return { ...seedState, snapshots: JSON.parse(stored).snapshots || [] };
  } catch {
    return seedState;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ snapshots: state.snapshots }));
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 401) {
    isAuthenticated = false;
    showLock();
    throw new Error("Unauthorized");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "API request failed");
  return data;
}

async function loadServerState() {
  const [accounts, transactions, holdings, chats] = await Promise.all([
    api("/api/accounts"),
    api("/api/transactions"),
    api("/api/holdings"),
    api("/api/chat"),
  ]);
  state.accounts = accounts.map(normalizeAccount);
  state.transactions = transactions.map(normalizeTransaction).reverse();
  state.holdings = holdings.map(normalizeHolding);
  state.chats = chats.length ? chats.map(normalizeChat) : seedState.chats;
  render();
}

function normalizeAccount(account) {
  return {
    id: account.id,
    name: account.name,
    balance: Number(account.balance || 0),
    createdAt: account.created_at,
  };
}

function normalizeTransaction(tx) {
  return {
    id: tx.id,
    accountId: tx.account_id,
    accountName: tx.account_name,
    amount: Number(tx.amount || 0),
    category: tx.category,
    note: tx.note,
    createdAt: tx.created_at,
  };
}

function normalizeHolding(holding) {
  return {
    id: holding.id,
    symbol: holding.symbol,
    quantity: Number(holding.quantity || 0),
    cost: Number(holding.cost || 0),
    price: Number(holding.price || 0),
    lastPriceAt: holding.last_price_at,
    createdAt: holding.created_at,
  };
}

function normalizeChat(message) {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.created_at,
  };
}

function money(value) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value || 0);
}

function totalCash() {
  return state.accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
}

function portfolioValue() {
  return state.holdings.reduce((sum, holding) => sum + holding.quantity * holding.price, 0);
}

function portfolioCost() {
  return state.holdings.reduce((sum, holding) => sum + holding.quantity * holding.cost, 0);
}

function portfolioPnl() {
  return portfolioValue() - portfolioCost();
}

function portfolioPnlPercent() {
  const cost = portfolioCost();
  return cost ? (portfolioPnl() / cost) * 100 : 0;
}

function netWorth() {
  return totalCash() + portfolioValue();
}

function snapshot() {
  const value = netWorth();
  const today = new Date().toISOString().slice(0, 10);
  const existing = state.snapshots.find((item) => item.date === today);
  if (existing) existing.value = value;
  else state.snapshots.push({ date: today, value });
  state.snapshots = state.snapshots.slice(-60);
}

function render() {
  snapshot();
  saveState();
  const cash = totalCash();
  const portfolio = portfolioValue();
  const pnl = portfolio - portfolioCost();
  const worth = cash + portfolio;
  const previous = state.snapshots.length > 1 ? state.snapshots[state.snapshots.length - 2].value : worth;
  const delta = worth - previous;

  els.netWorth.textContent = money(worth);
  els.cashTotal.textContent = money(cash);
  els.portfolioTotal.textContent = money(portfolio);
  els.pnlTotal.textContent = money(pnl);
  els.pnlTotal.className = pnl >= 0 ? "positive" : "negative";
  renderPortfolioSummary();
  els.netWorthDelta.textContent = delta === 0 ? "No movement yet" : `${delta > 0 ? "+" : ""}${money(delta)} since last snapshot`;

  renderAccounts();
  renderHoldings();
  renderActivity();
  renderBars();
  renderInsights();
  renderChat();
  renderLineChart(els.chart, 190);
  renderLineChart(els.analysisChart, 150);
}

function renderPortfolioSummary() {
  const value = portfolioValue();
  const cost = portfolioCost();
  const pnl = portfolioPnl();
  const pnlPercent = portfolioPnlPercent();
  const lastUpdate = latestPriceUpdate();
  const best = bestHolding();
  els.portfolioLiveValue.textContent = money(value);
  els.portfolioLivePnl.textContent = `${pnl >= 0 ? "+" : ""}${money(pnl)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`;
  els.portfolioLivePnl.className = pnl >= 0 ? "positive" : "negative";
  els.priceStatus.textContent = lastUpdate ? `Live prices updated ${lastUpdate}` : "Manual prices";
  els.portfolioKpis.innerHTML = `
    ${kpiPill("Invested", money(cost))}
    ${kpiPill("Return", `${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%`, pnl >= 0 ? "positive" : "negative")}
    ${kpiPill("Best", best ? best.symbol : "--", best?.pnl >= 0 ? "positive" : "negative")}
  `;
  renderPortfolioXray();
}

function kpiPill(label, value, className = "") {
  return `
    <article class="kpi-pill">
      <span>${escapeHtml(label)}</span>
      <strong class="${className}">${escapeHtml(value)}</strong>
    </article>
  `;
}

function renderPortfolioXray() {
  if (!state.holdings.length) {
    els.portfolioXrayLabel.textContent = "Asset mix";
    els.portfolioXray.innerHTML = `<p class="muted">Add holdings to see your stock and crypto exposure.</p>`;
    return;
  }

  const mix = state.holdings.reduce((map, holding) => {
    const bucket = CRYPTO_IDS[holding.symbol] ? "Crypto" : "Stocks / ETFs";
    map[bucket] = (map[bucket] || 0) + holding.quantity * holding.price;
    return map;
  }, {});
  const total = Math.max(Object.values(mix).reduce((sum, value) => sum + value, 0), 1);
  els.portfolioXrayLabel.textContent = `${Object.keys(mix).length} asset class${Object.keys(mix).length === 1 ? "" : "es"}`;
  els.portfolioXray.innerHTML = Object.entries(mix)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => barRow(name, `${money(value)} · ${Math.round((value / total) * 100)}%`, value / total))
    .join("");
}

function bestHolding() {
  return state.holdings
    .map((holding) => ({
      symbol: holding.symbol,
      pnl: holding.quantity * holding.price - holding.quantity * holding.cost,
    }))
    .sort((a, b) => b.pnl - a.pnl)[0];
}

function renderAccounts() {
  if (!state.accounts.length) {
    els.accountList.innerHTML = `<p class="muted">No accounts yet.</p>`;
    return;
  }

  els.accountList.innerHTML = state.accounts
    .map((account) => {
      const count = state.transactions.filter((item) => item.accountId === account.id).length;
      return `
        <article class="account-card">
          <div class="account-top">
            <strong>${escapeHtml(account.name)}</strong>
            <strong>${money(account.balance)}</strong>
          </div>
          <small>${count} transaction${count === 1 ? "" : "s"}</small>
        </article>
      `;
    })
    .join("");
}

function renderHoldings() {
  if (!state.holdings.length) {
    els.holdingList.innerHTML = `<p class="muted">No holdings yet. Add one manually or say “bought 2 AAPL at 170 now 190”.</p>`;
    return;
  }

  els.holdingList.innerHTML = state.holdings
    .map((holding) => {
      const value = holding.quantity * holding.price;
      const pnl = value - holding.quantity * holding.cost;
      const pnlPercent = holding.cost ? (pnl / (holding.quantity * holding.cost)) * 100 : 0;
      const updated = holding.lastPriceAt ? `Updated ${timeAgo(holding.lastPriceAt)}` : "Manual price";
      return `
        <article class="holding-card">
          <div class="holding-top">
            <strong>${escapeHtml(holding.symbol)}</strong>
            <strong>${money(value)}</strong>
          </div>
          <div class="holding-meta">
            <small>${holding.quantity} units at ${money(holding.price)}</small>
            <small class="${pnl >= 0 ? "positive" : "negative"}">${pnl >= 0 ? "+" : ""}${money(pnl)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)</small>
          </div>
          <small>${escapeHtml(updated)}</small>
        </article>
      `;
    })
    .join("");
}

function renderActivity() {
  const rows = state.transactions.slice(-6).reverse();
  if (!rows.length) {
    els.activityList.innerHTML = `<p class="muted">Your recent account movements will show here.</p>`;
    return;
  }

  els.activityList.innerHTML = rows
    .map((tx) => {
      const account = state.accounts.find((item) => item.id === tx.accountId);
      return `
        <div class="activity-item">
          <div class="activity-line">
            <strong>${escapeHtml(tx.note || tx.category)}</strong>
            <strong class="${tx.amount >= 0 ? "positive" : "negative"}">${money(tx.amount)}</strong>
          </div>
          <small>${escapeHtml(account?.name || "Unknown")} · ${new Date(tx.createdAt).toLocaleDateString()}</small>
        </div>
      `;
    })
    .join("");
}

function renderBars() {
  const cash = Math.max(Math.abs(totalCash()), 1);
  els.accountSplitLabel.textContent = `${state.accounts.length} account${state.accounts.length === 1 ? "" : "s"}`;
  els.accountBars.innerHTML = state.accounts.length
    ? state.accounts
        .map((account) => barRow(account.name, money(account.balance), Math.abs(account.balance) / cash))
        .join("")
    : `<p class="muted">No account balances yet.</p>`;

  const month = new Date().toISOString().slice(0, 7);
  const categories = state.transactions
    .filter((tx) => tx.createdAt.startsWith(month) && tx.amount < 0)
    .reduce((map, tx) => {
      map[tx.category] = (map[tx.category] || 0) + Math.abs(tx.amount);
      return map;
    }, {});
  const max = Math.max(...Object.values(categories), 1);
  els.categoryBars.innerHTML = Object.keys(categories).length
    ? Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => barRow(name, money(value), value / max))
        .join("")
    : `<p class="muted">Spending categories appear after withdrawals.</p>`;
}

function renderInsights() {
  const month = new Date().toISOString().slice(0, 7);
  const monthlyTransactions = state.transactions.filter((tx) => tx.createdAt.startsWith(month));
  const inflow = monthlyTransactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const outflow = monthlyTransactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const saved = inflow - outflow;
  const savingsRate = inflow > 0 ? Math.round((saved / inflow) * 100) : 0;
  const runway = outflow > 0 ? totalCash() / outflow : null;
  const signals = buildSignals(inflow, outflow, savingsRate, runway);

  els.monthlyInflow.textContent = money(inflow);
  els.monthlyOutflow.textContent = money(outflow);
  els.savingsRate.textContent = `${savingsRate}%`;
  els.savingsRate.className = savingsRate >= 0 ? "positive" : "negative";
  els.runwayMonths.textContent = runway === null ? "--" : `${Math.max(runway, 0).toFixed(1)} mo`;
  els.signalCount.textContent = `${signals.length} active`;
  els.signalList.innerHTML = signals
    .map((signal) => `
      <article class="signal-card">
        <span>${escapeHtml(signal.type)}</span>
        <strong>${escapeHtml(signal.title)}</strong>
        <small class="muted">${escapeHtml(signal.detail)}</small>
      </article>
    `)
    .join("");
}

function buildSignals(inflow, outflow, savingsRate, runway) {
  const signals = [];
  const worth = netWorth();
  const cash = totalCash();
  const portfolio = portfolioValue();
  const pnl = portfolio - portfolioCost();
  const largestOutflow = state.transactions
    .filter((tx) => tx.amount < 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];

  if (inflow || outflow) {
    signals.push({
      type: "Cash flow",
      title: savingsRate >= 0 ? `You kept ${savingsRate}% of this month's inflow` : `Outflows are ${money(Math.abs(inflow - outflow))} above inflow`,
      detail: `${money(inflow)} in and ${money(outflow)} out this month.`,
    });
  } else {
    signals.push({
      type: "Cash flow",
      title: "No monthly movement logged yet",
      detail: "Deposits and withdrawals will unlock savings rate, runway, and burn insights.",
    });
  }

  signals.push({
    type: "Allocation",
    title: worth > 0 ? `${Math.round((portfolio / worth) * 100)}% invested, ${Math.round((cash / worth) * 100)}% cash` : "Allocation is waiting for balances",
    detail: "Useful for checking whether your cash buffer and invested assets match your plan.",
  });

  if (runway !== null) {
    signals.push({
      type: "Runway",
      title: runway >= 6 ? "Cash runway looks comfortable" : "Cash runway is thin",
      detail: `At this month's outflow pace, current cash covers about ${Math.max(runway, 0).toFixed(1)} months.`,
    });
  }

  if (state.holdings.length) {
    signals.push({
      type: "Portfolio",
      title: pnl >= 0 ? `Portfolio is up ${money(pnl)}` : `Portfolio is down ${money(Math.abs(pnl))}`,
      detail: `${state.holdings.length} holding${state.holdings.length === 1 ? "" : "s"} tracked at manual prices.`,
    });
  }

  if (largestOutflow) {
    signals.push({
      type: "Largest spend",
      title: `${money(Math.abs(largestOutflow.amount))} for ${largestOutflow.note || largestOutflow.category}`,
      detail: "This highlights the single biggest logged cash movement.",
    });
  }

  return signals.slice(0, 5);
}

function barRow(label, value, ratio) {
  return `
    <div class="bar-row">
      <div class="bar-top">
        <strong>${escapeHtml(label)}</strong>
        <span>${value}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(ratio * 100, 2)}%"></div></div>
    </div>
  `;
}

function renderChat() {
  els.chatLog.innerHTML = state.chats
    .slice(-30)
    .map((message) => `<div class="message ${message.role}">${escapeHtml(message.text)}</div>`)
    .join("");
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function renderLineChart(target, height) {
  const width = 640;
  const points = state.snapshots.length ? state.snapshots : [{ date: "now", value: netWorth() }];
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - ((point.value - min) / span) * (height - 24) - 12;
    return `${x},${y}`;
  });

  target.setAttribute("viewBox", `0 0 ${width} ${height}`);
  target.innerHTML = `
    <defs>
      <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0f766e" />
        <stop offset="100%" stop-color="#b7791f" />
      </linearGradient>
    </defs>
    <line x1="0" y1="${height - 12}" x2="${width}" y2="${height - 12}" stroke="#dce3ec" stroke-width="2" />
    <polyline points="${coords.join(" ")}" fill="none" stroke="url(#lineGradient)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function addChat(role, text) {
  state.chats.push({ id: crypto.randomUUID(), role, text, createdAt: new Date().toISOString() });
}

async function refreshLivePrices() {
  if (!state.holdings.length) {
    els.priceStatus.textContent = "Add holdings first";
    return;
  }

  els.priceStatus.textContent = "Refreshing live prices...";
  sessionStorage.setItem("portfolio-live-enabled", "true");
  const results = await Promise.allSettled(state.holdings.map((holding) => fetchLivePrice(holding.symbol)));
  let updated = 0;
  const prices = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && Number.isFinite(result.value)) {
      state.holdings[index].price = result.value;
      state.holdings[index].lastPriceAt = new Date().toISOString();
      prices.push({ symbol: state.holdings[index].symbol, price: result.value });
      updated += 1;
    }
  });

  els.priceStatus.textContent = updated ? `Updated ${updated}/${state.holdings.length} live prices` : "Live prices unavailable";
  if (prices.length) {
    await api("/api/prices", { method: "POST", body: JSON.stringify({ prices }) });
    await loadServerState();
    return;
  }
  render();
}

async function fetchLivePrice(symbol) {
  const cleanSymbol = symbol.toUpperCase();
  if (CRYPTO_IDS[cleanSymbol]) return fetchCryptoPrice(cleanSymbol);
  return fetchYahooPrice(cleanSymbol);
}

async function fetchCryptoPrice(symbol) {
  const id = CRYPTO_IDS[symbol];
  const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=eur`);
  if (!response.ok) throw new Error("Crypto price failed");
  const data = await response.json();
  const price = data[id]?.eur;
  if (!Number.isFinite(price)) throw new Error("Crypto price missing");
  return price;
}

async function fetchYahooPrice(symbol) {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`);
  if (!response.ok) throw new Error("Ticker price failed");
  const data = await response.json();
  const result = data.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice || result?.meta?.previousClose;
  if (!Number.isFinite(price)) throw new Error("Ticker price missing");
  return price;
}

function latestPriceUpdate() {
  const latest = state.holdings
    .map((holding) => holding.lastPriceAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  return latest ? timeAgo(latest) : "";
}

function timeAgo(iso) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === tab));
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
  });
});

document.querySelector("#addAccountButton").addEventListener("click", () => {
  document.querySelector("#accountForm").classList.toggle("hidden");
});

document.querySelector("#addHoldingButton").addEventListener("click", () => {
  document.querySelector("#holdingForm").classList.toggle("hidden");
});

document.querySelector("#refreshPricesButton").addEventListener("click", () => {
  refreshLivePrices();
});

document.querySelector("#accountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#accountName").value.trim();
  const balance = Number(document.querySelector("#accountBalance").value);
  if (!name) return;
  await api("/api/accounts", { method: "POST", body: JSON.stringify({ name, balance }) });
  event.target.reset();
  event.target.classList.add("hidden");
  await loadServerState();
});

document.querySelector("#holdingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/holdings", {
    method: "POST",
    body: JSON.stringify({
      symbol: document.querySelector("#holdingSymbol").value.trim().toUpperCase(),
      quantity: Number(document.querySelector("#holdingQuantity").value),
      cost: Number(document.querySelector("#holdingCost").value),
      price: Number(document.querySelector("#holdingPrice").value),
    }),
  });
  event.target.reset();
  event.target.classList.add("hidden");
  await loadServerState();
});

document.querySelector("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  addChat("user", text);
  els.chatInput.value = "";
  render();
  await api("/api/chat", { method: "POST", body: JSON.stringify({ message: text }) });
  await loadServerState();
});

document.querySelector("#lockButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  isAuthenticated = false;
  showLock();
});

document.querySelector("#pinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.querySelector("#usernameInput").value.trim();
  const password = document.querySelector("#pinInput").value;
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    isAuthenticated = true;
    els.lockScreen.classList.remove("active");
    document.querySelector("#pinInput").value = "";
    await loadServerState();
  } catch {
    document.querySelector("#pinInput").value = "";
    document.querySelector("#pinInput").placeholder = "Wrong password";
  }
});

function showLock() {
  if (isAuthenticated) return;
  els.lockScreen.classList.add("active");
}

async function boot() {
  try {
    await api("/api/me");
    isAuthenticated = true;
    els.lockScreen.classList.remove("active");
    await loadServerState();
  } catch {
    showLock();
    render();
  }
}

boot();
window.setInterval(() => {
  const liveEnabled = sessionStorage.getItem("portfolio-live-enabled") === "true";
  if (liveEnabled && state.holdings.length && document.visibilityState === "visible") refreshLivePrices();
}, 5 * 60 * 1000);

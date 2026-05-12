const STORAGE_KEY = "deepak.balance-tracker.snapshots.v1";
const API_BASE = localStorage.getItem("balance-api-base") || (location.hostname === "localhost" ? "http://localhost:8787" : "");
const CURRENCY = "EUR";
const CRYPTO_IDS = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", ADA: "cardano",
  XRP: "ripple", DOGE: "dogecoin", AVAX: "avalanche-2", DOT: "polkadot",
  MATIC: "matic-network", LINK: "chainlink"
};
const seedState = {
  accounts: [], transactions: [], holdings: [], portfolioCash: 0, portfolioEvents: [], fxRates: { EUR: 1, USD: 0.92 },
  chats: [{ id: crypto.randomUUID(), role: "agent", text: "Ready.", createdAt: new Date().toISOString() }],
  snapshots: []
};

let state = loadState();
let isAuthenticated = false;

// ----------------------------------------
// Theme management
// ----------------------------------------
const THEME_KEY = "balance-theme";
function getThemePref() { return localStorage.getItem(THEME_KEY) || "system"; }
function applyTheme(pref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.querySelectorAll("#themeSegmented button").forEach(b => {
    b.classList.toggle("active", b.dataset.themeValue === pref);
  });
}
function setThemePref(pref) {
  localStorage.setItem(THEME_KEY, pref);
  applyTheme(pref);
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getThemePref() === "system") applyTheme("system");
});

// ----------------------------------------
// Haptic helper (no-op when unsupported)
// ----------------------------------------
function haptic(kind = "light") {
  if (!navigator.vibrate) return;
  const map = { light: 10, success: [10, 30, 10], warning: [15, 50, 15] };
  navigator.vibrate(map[kind] || 10);
}

// ----------------------------------------
// Icons + list row primitive
// ----------------------------------------
const ICONS = {
  income: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`,
  expense: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m5 12 7 7 7-7"/></svg>`,
  transfer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h12"/><path d="m15 3 4 4-4 4"/><path d="M17 17H5"/><path d="m9 21-4-4 4-4"/></svg>`,
  mortgage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/></svg>`,
  revalue: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`,
  wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5h15a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13"/><path d="M17 13h4"/></svg>`,
  house: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h5v-5h4v5h5v-9.5"/></svg>`,
  debt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9h4a2.5 2.5 0 0 1 0 5H9"/><path d="M9 14v3"/></svg>`,
  generic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
};

function categoryIconKind(category) {
  if (!category) return "generic";
  const c = category.toLowerCase();
  if (c === "income" || c === "salary") return "income";
  if (c === "transfer") return "transfer";
  if (c.startsWith("mortgage")) return "mortgage";
  if (c === "revalue") return "revalue";
  if (c === "expense" || c === "manual") return "expense";
  return "expense";
}

function accountIconKind(account) {
  const type = account?.type || "cash";
  if (type === "asset") return "house";
  if (type === "liability") return "debt";
  return "wallet";
}

function txIconTint(tx) {
  const kind = categoryIconKind(tx.category);
  if (kind === "income") return "mint";
  if (kind === "expense") return "coral";
  if (kind === "transfer") return "sky";
  if (kind === "mortgage") return "gold";
  if (kind === "revalue") return "muted";
  return "muted";
}

function listRow({ icon = "generic", tint = "muted", title, subtitle, value, valueClass = "", trailing, chevron = false, dataId, dataAction, className = "" }) {
  const trailingHtml = trailing
    ? `<div class="row-trailing">${trailing}</div>`
    : value != null
      ? `<div class="row-trailing"><strong class="${valueClass}">${value}</strong></div>`
      : "";
  return `
    <div class="list-row ${className}" ${dataId ? `data-id="${dataId}"` : ""} ${dataAction ? `data-action="${dataAction}"` : ""}>
      <span class="row-icon row-icon-${tint}">${ICONS[icon] || ICONS.generic}</span>
      <div class="row-body">
        <strong>${title}</strong>
        ${subtitle ? `<small>${subtitle}</small>` : ""}
      </div>
      ${trailingHtml}
      ${chevron ? `<span class="row-chevron">${ICONS.chevron}</span>` : ""}
    </div>`;
}
let holdingSort = "value";
const chartRanges = { netWorth: "1W", portfolio: "1W" };
const RANGE_DAYS = { "1W": 7, "1M": 30, "1Y": 365, "3Y": 365 * 3, "5Y": 365 * 5 };

const els = {
  globalLoader: document.querySelector("#globalLoader"),
  toastContainer: document.querySelector("#toastContainer"),
  netWorth: document.querySelector("#netWorth"),
  netWorthDelta: document.querySelector("#netWorthDelta"),
  allocationBar: document.querySelector("#allocationBar"),
  allocationLegend: document.querySelector("#allocationLegend"),
  compositionPanel: document.querySelector("#compositionPanel"),
  compositionLabel: document.querySelector("#compositionLabel"),
  cashTotal: document.querySelector("#cashTotal"),
  portfolioTotal: document.querySelector("#portfolioTotal"),
  assetsTotal: document.querySelector("#assetsTotal"),
  assetsTile: document.querySelector("#assetsTile"),
  debtTotal: document.querySelector("#debtTotal"),
  debtTile: document.querySelector("#debtTile"),
  portfolioLiveValue: document.querySelector("#portfolioLiveValue"),
  portfolioLivePnl: document.querySelector("#portfolioLivePnl"),
  portfolioKpis: document.querySelector("#portfolioKpis"),
  portfolioXray: document.querySelector("#portfolioXray"),
  portfolioActionMenu: document.querySelector("#portfolioActionMenu"),
  priceStatus: document.querySelector("#priceStatus"),
  activityList: document.querySelector("#activityList"),
  accountList: document.querySelector("#accountList"),
  holdingList: document.querySelector("#holdingList"),
  accountBars: document.querySelector("#accountBars"),
  categoryBars: document.querySelector("#categoryBars"),
  accountSplitLabel: document.querySelector("#accountSplitLabel"),
  evolutionLabel: document.querySelector("#evolutionLabel"),
  chart: document.querySelector("#netWorthChart"),
  analysisChart: document.querySelector("#analysisChart"),
  monthlyInflow: document.querySelector("#monthlyInflow"),
  monthlyOutflow: document.querySelector("#monthlyOutflow"),
  totalAssetsCard: document.querySelector("#totalAssetsCard"),
  totalDebtCard: document.querySelector("#totalDebtCard"),
  propertyEquityCard: document.querySelector("#propertyEquityCard"),
  principalPaidCard: document.querySelector("#principalPaidCard"),
  savingsMixCard: document.querySelector("#savingsMixCard"),
  savingsRate: document.querySelector("#savingsRate"),
  runwayMonths: document.querySelector("#runwayMonths"),
  portfolioProfit: document.querySelector("#portfolioProfit"),
  investedShare: document.querySelector("#investedShare"),
  topHolding: document.querySelector("#topHolding"),
  worthMove: document.querySelector("#worthMove"),
  signalList: document.querySelector("#signalList"),
  signalCount: document.querySelector("#signalCount"),
  chatLog: document.querySelector("#chatLog"),
  chatInput: document.querySelector("#chatInput"),
  lockScreen: document.querySelector("#lockScreen"),
  
  // detail views
  accountDetailView: document.querySelector("#accountDetailView"),
  holdingDetailView: document.querySelector("#holdingDetailView"),
  
  // modals
  modalBackdrop: document.querySelector("#modalBackdrop"),
  modalTitle: document.querySelector("#modalTitle"),
  modalHeaderAccessory: document.querySelector("#modalHeaderAccessory"),
  modalFormFields: document.querySelector("#modalFormFields"),
  genericForm: document.querySelector("#genericForm"),
  modalDeleteBtn: document.querySelector("#modalDeleteBtn"),
  modalSaveBtn: document.querySelector('#genericForm button[type="submit"]')
};

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return seedState;
  try { return { ...seedState, snapshots: JSON.parse(stored).snapshots || [] }; } 
  catch { return seedState; }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ snapshots: state.snapshots }));
}

function showToast(message, type = "success") {
  if (type === "error") haptic("warning");
  else if (type === "success") haptic("success");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

let activeRequests = 0;
async function api(path, options = {}) {
  activeRequests++;
  els.globalLoader.style.width = "30%";
  els.globalLoader.classList.add("active");
  try {
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
    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();
    let data = {};
    if (raw && contentType.includes("application/json")) {
      data = JSON.parse(raw);
    } else if (raw) {
      const message = response.ok
        ? `${path} returned HTML instead of JSON. Check the API proxy/backend deployment.`
        : `${path} returned ${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    if (!response.ok) throw new Error(data.error || "API request failed");
    return data;
  } catch (err) {
    if (err.message !== "Unauthorized") showToast(err.message, "error");
    throw err;
  } finally {
    activeRequests--;
    if (activeRequests === 0) {
      els.globalLoader.style.width = "100%";
      setTimeout(() => {
        els.globalLoader.classList.remove("active");
        els.globalLoader.style.width = "0%";
      }, 300);
    }
  }
}

async function loadServerState() {
  const [accounts, transactions, holdings, chats, analysis, portfolio, fx] = await Promise.all([
    api("/api/accounts"),
    api("/api/transactions"),
    api("/api/holdings"),
    api("/api/chat"),
    api("/api/analysis"),
    api("/api/portfolio").catch(() => ({ cash: 0, events: [] })),
    api("/api/fx").catch(() => ({ rates: seedState.fxRates }))
  ]);
  state.accounts = accounts.map(a => ({ id: a.id, name: a.name, balance: Number(a.balance || 0), type: a.type || "cash", createdAt: a.created_at }));
  state.transactions = transactions.map(tx => ({
    id: tx.id, accountId: tx.account_id, accountName: tx.account_name,
    amount: Number(tx.amount || 0), category: tx.category, note: tx.note, createdAt: tx.created_at
  })).reverse();
  state.holdings = holdings.map(h => ({
    id: h.id, symbol: h.symbol, quantity: Number(h.quantity || 0), cost: Number(h.cost || 0),
    price: Number(h.price || 0), previousClose: h.previous_close != null ? Number(h.previous_close) : null,
    currency: cleanCurrency(h.currency), lastPriceAt: h.last_price_at, createdAt: h.created_at
  }));
  state.chats = chats.length ? chats.map(c => ({ 
    id: c.id, role: c.role, text: c.text, createdAt: c.created_at, 
    action_id: c.action_id, action_status: c.action_status 
  })) : seedState.chats;
  state.analysis = analysis;
  state.portfolioCash = Number(portfolio.cash || 0);
  state.portfolioEvents = portfolio.events || [];
  state.fxRates = { ...seedState.fxRates, ...(fx.rates || {}) };
  render();
}

function money(value) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency", currency: CURRENCY,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2
  }).format(value || 0);
}

function compactMoney(value) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency", currency: CURRENCY, notation: "compact",
    maximumFractionDigits: 1
  }).format(value || 0);
}

function accountsOfType(type) { return state.accounts.filter(a => (a.type || "cash") === type); }
function totalCash() { return accountsOfType("cash").reduce((sum, acc) => sum + acc.balance, 0); }
function totalAssets() { return accountsOfType("asset").reduce((sum, acc) => sum + acc.balance, 0); }
function totalLiabilities() { return accountsOfType("liability").reduce((sum, acc) => sum + acc.balance, 0); }

const PERSPECTIVE_LABEL = { net: "Net worth", gross: "Gross assets", liquid: "Liquid wealth" };
let currentPerspective = "net";
function worthForPerspective(perspective) {
  const cash = totalCash(), assets = totalAssets(), portfolio = portfolioValue();
  if (perspective === "gross") return cash + assets + portfolio;
  if (perspective === "liquid") return cash + portfolio;
  return cash + assets + portfolio - totalLiabilities();
}
function cleanCurrency(value) {
  const currency = String(value || "EUR").toUpperCase();
  return currency === "USD" ? "USD" : "EUR";
}
function toEur(value, currency = "EUR") { return (Number(value) || 0) * (state.fxRates?.[cleanCurrency(currency)] || 1); }
function currencyMoney(value, currency = "EUR") {
  return new Intl.NumberFormat("en-BE", {
    style: "currency", currency: cleanCurrency(currency),
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2
  }).format(value || 0);
}
function holdingValueEur(h) { return toEur(h.quantity * h.price, h.currency); }
function holdingCostEur(h) { return toEur(h.quantity * h.cost, h.currency); }
function holdingPnlEur(h) { return holdingValueEur(h) - holdingCostEur(h); }
function inferCurrency(symbol) { return String(symbol || "").includes(".") ? "EUR" : "USD"; }
function currencyOptions(selected = "EUR") {
  const currency = cleanCurrency(selected);
  return `<option value="EUR" ${currency === "EUR" ? "selected" : ""}>EUR</option><option value="USD" ${currency === "USD" ? "selected" : ""}>USD</option>`;
}
function currencySlider(selected = "EUR") {
  const currency = cleanCurrency(selected);
  return `
    <div class="currency-slider" role="group" aria-label="Currency">
      ${["EUR", "USD"].map(code => `
        <button type="button" class="${code === currency ? "active" : ""}" data-currency-option="${code}" aria-pressed="${code === currency}">
          ${code}
        </button>
      `).join("")}
    </div>`;
}
function setModalCurrency(currency) {
  const value = cleanCurrency(currency);
  const input = els.modalFormFields.querySelector('input[name="currency"]');
  if (input) input.value = value;
  els.modalHeaderAccessory.querySelectorAll("[data-currency-option]").forEach(button => {
    const active = button.dataset.currencyOption === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
function bindModalCurrencySlider() {
  els.modalHeaderAccessory.querySelectorAll("[data-currency-option]").forEach(button => {
    button.addEventListener("click", () => setModalCurrency(button.dataset.currencyOption));
  });
}
function portfolioAssetValue() { return state.holdings.reduce((sum, h) => sum + holdingValueEur(h), 0); }
function portfolioValue() { return portfolioAssetValue() + Math.max(state.portfolioCash || 0, 0); }
function portfolioCost() { return state.holdings.reduce((sum, h) => sum + holdingCostEur(h), 0); }
function portfolioPnl() { return portfolioAssetValue() - portfolioCost(); }
function portfolioPnlPercent() { const cost = portfolioCost(); return cost ? (portfolioPnl() / cost) * 100 : 0; }
function netWorth() { return worthForPerspective(currentPerspective); }

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
  const cash = totalCash(), portfolio = portfolioValue();
  const assets = totalAssets(), liabilities = totalLiabilities();
  const worth = worthForPerspective(currentPerspective);

  const perspectiveLabel = document.querySelector("#perspectiveLabel");
  if (perspectiveLabel) perspectiveLabel.textContent = PERSPECTIVE_LABEL[currentPerspective];
  els.netWorth.textContent = money(worth);
  els.cashTotal.textContent = money(cash);
  els.portfolioTotal.textContent = money(portfolio);
  if (els.assetsTotal) {
    els.assetsTotal.textContent = money(assets);
    els.assetsTile.hidden = assets === 0;
  }
  if (els.debtTotal) {
    els.debtTotal.textContent = `-${money(liabilities)}`;
    els.debtTile.hidden = liabilities === 0;
  }

  renderPortfolioSummary();
  renderAccounts();
  renderHoldings();
  renderActivity();
  renderBars();
  renderInsights();
  renderChat();
  const trendPoints = filterPointsForRange(buildNetWorthTrend(), chartRanges.netWorth);
  const trendText = `${chartRanges.netWorth} · ${trendPoints.length} data point${trendPoints.length === 1 ? "" : "s"}`;
  els.evolutionLabel.textContent = trendText;
  renderLineChart(els.chart, 200, trendPoints);
  renderLineChart(els.analysisChart, 160, trendPoints);
  renderHeroDelta(trendPoints);
  renderAllocationBar(cash, assets, portfolio);
}

function renderHeroDelta(trendPoints) {
  if (!trendPoints || trendPoints.length < 2) {
    els.netWorthDelta.hidden = true;
    return;
  }
  const startVal = trendPoints[0].value;
  const endVal = trendPoints.at(-1).value;
  const delta = endVal - startVal;
  const pct = startVal ? (delta / Math.abs(startVal)) * 100 : 0;
  const sign = delta > 0 ? "+" : "";
  els.netWorthDelta.hidden = false;
  els.netWorthDelta.textContent = `${sign}${money(delta)} (${sign}${pct.toFixed(1)}%) · ${chartRanges.netWorth}`;
  els.netWorthDelta.className = delta >= 0 ? "positive" : "negative";
}

function renderAllocationBar(cash, assets, portfolio) {
  if (currentPerspective === "liquid") assets = 0;
  const total = cash + assets + portfolio;
  if (els.compositionPanel) els.compositionPanel.hidden = total <= 0;
  if (els.compositionLabel) els.compositionLabel.textContent = total > 0 ? money(total) : "";
  if (total <= 0) {
    els.allocationBar.hidden = true;
    return;
  }
  els.allocationBar.hidden = false;
  const segments = [
    { kind: "cash", label: "Cash", value: cash },
    { kind: "property", label: "Property", value: assets },
    { kind: "portfolio", label: "Portfolio", value: portfolio },
  ];
  els.allocationBar.querySelectorAll(".allocation-segment").forEach(seg => {
    const item = segments.find(s => s.kind === seg.dataset.kind);
    const pct = item ? (item.value / total) * 100 : 0;
    seg.style.width = `${pct}%`;
    seg.hidden = pct === 0;
  });
  els.allocationLegend.innerHTML = segments
    .filter(s => s.value > 0)
    .map(s => `<span class="allocation-tag" data-kind="${s.kind}"><i></i>${s.label} ${Math.round((s.value / total) * 100)}%</span>`)
    .join("");
}

function renderPortfolioSummary() {
  const value = portfolioValue(), cost = portfolioCost(), pnl = portfolioPnl(), pnlPercent = portfolioPnlPercent();
  els.portfolioLiveValue.textContent = money(value);
  els.portfolioLivePnl.textContent = `${pnl >= 0 ? "+" : ""}${money(pnl)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`;
  els.portfolioLivePnl.className = pnl >= 0 ? "positive" : "negative";
  const lastUpdate = state.holdings.map(h => h.lastPriceAt).filter(Boolean).sort().at(-1);
  els.priceStatus.textContent = lastUpdate ? `Updated ${timeAgo(lastUpdate)}` : "Manual prices";

  const best = state.holdings.map(h => ({ symbol: h.symbol, pnl: holdingPnlEur(h) })).sort((a, b) => b.pnl - a.pnl)[0];
  els.portfolioKpis.innerHTML = `
    <article class="kpi-pill"><span>Invested</span><strong>${money(cost)}</strong></article>
    <article class="kpi-pill"><span>Return</span><strong class="${pnl >= 0 ? 'positive' : 'negative'}">${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%</strong></article>
    <article class="kpi-pill"><span>Best</span><strong class="${best?.pnl >= 0 ? 'positive' : 'negative'}">${best ? best.symbol : "--"}</strong></article>
  `;

  if (!state.holdings.length && !(state.portfolioCash > 0)) {
    els.portfolioXray.innerHTML = `<p class="muted" style="margin-top: 10px;">Add holdings or move cash to see portfolio charts.</p>`;
    return;
  }
  renderPortfolioGrowth();
}

function renderPortfolioGrowth() {
  const value = portfolioAssetValue();
  const cost = portfolioCost();
  const pnl = value - cost;
  const pnlPercent = cost ? (pnl / cost) * 100 : 0;
  const points = filterPointsForRange(buildPortfolioGrowthPoints(), chartRanges.portfolio);

  els.portfolioXray.innerHTML = `
    <div class="portfolio-carousel" aria-label="Portfolio charts">
      <section class="portfolio-slide">
        <div class="growth-summary">
          <article><span>Invested cash</span><strong>${money(cost)}</strong></article>
          <article><span>Assets value</span><strong>${money(value)}</strong></article>
          <article><span>Profit</span><strong class="${pnl >= 0 ? "positive" : "negative"}">${pnl >= 0 ? "+" : ""}${money(pnl)} · ${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%</strong></article>
        </div>
        <div class="chart-wrap portfolio-growth-wrap">
          <svg id="portfolioGrowthChart" preserveAspectRatio="none" role="img" aria-label="Invested cash and current portfolio value over time"></svg>
        </div>
        <div class="growth-legend">
          <span><i class="legend-value"></i>Current assets</span>
          <span><i class="legend-cost"></i>Invested cash</span>
        </div>
      </section>
      <section class="portfolio-slide">
        ${renderPortfolioAllocationPie()}
      </section>
    </div>
  `;
  bindAllocationInteractions();
  const svg = document.querySelector("#portfolioGrowthChart");
  if (svg && points.length) renderDualLineChart(svg, 180, points);
}

function renderDualLineChart(target, height, points) {
  const width = target.clientWidth;
  if (!width) {
    requestAnimationFrame(() => renderDualLineChart(target, height, points));
    return;
  }
  target.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const valuesAll = points.flatMap(p => [p.value, p.cost]);
  const low = Math.min(...valuesAll);
  const high = Math.max(...valuesAll);
  const padSpan = Math.max((high - low) * 0.08, Math.max(Math.abs(high), 1) * 0.02);
  const yMin = Math.min(low - padSpan, 0);
  const yMax = high + padSpan;
  const yRange = (yMax - yMin) || 1;
  const padL = 6, padR = 6, padT = 16, padB = 22;
  const plotW = Math.max(width - padL - padR, 1);
  const plotH = Math.max(height - padT - padB, 1);
  const xFor = i => padL + (i / Math.max(points.length - 1, 1)) * plotW;
  const yFor = v => padT + (1 - ((v - yMin) / yRange)) * plotH;

  const valueData = points.map((p, i) => ({ date: p.date, value: p.value, x: xFor(i), y: yFor(p.value) }));
  const costData = points.map((p, i) => ({ date: p.date, value: p.cost, x: xFor(i), y: yFor(p.cost) }));
  const valuePath = `M${valueData.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}`;
  const costPath = `M${costData.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}`;
  const last = valueData.at(-1);
  const first = valueData[0];
  const areaPath = `${valuePath} L${last.x.toFixed(1)} ${(padT + plotH).toFixed(1)} L${first.x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
  const up = valueData.at(-1).value >= valueData[0].value;
  const stroke = up ? "var(--good)" : "var(--danger)";

  const yTicks = 4;
  let yAxis = "";
  for (let i = 0; i <= yTicks; i++) {
    const v = yMax - (i / yTicks) * yRange;
    const y = padT + (i / yTicks) * plotH;
    yAxis += `<line x1="${padL}" x2="${width - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.08" stroke-width="1"/>`;
    if (i < yTicks) {
      yAxis += `<text x="${padL + 2}" y="${(y - 4).toFixed(1)}" text-anchor="start" font-size="10" fill="currentColor" fill-opacity="0.6">${compactMoney(v)}</text>`;
    }
  }

  const xTicks = Math.min(4, points.length - 1);
  let xAxis = "";
  for (let i = 0; i <= xTicks; i++) {
    const idx = Math.round((i / xTicks) * (points.length - 1));
    const x = xFor(idx);
    xAxis += `<text x="${x.toFixed(1)}" y="${height - 4}" text-anchor="${i === 0 ? "start" : i === xTicks ? "end" : "middle"}" font-size="10" fill="currentColor" fill-opacity="0.55">${formatChartDate(points[idx].date)}</text>`;
  }

  target._chartData = valueData;
  target._chartWidth = width;
  target._chartHeight = height;
  target.innerHTML = `
    ${yAxis}
    <path d="${areaPath}" fill="${stroke}" fill-opacity="0.12"/>
    <path d="${costPath}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-dasharray="4 4" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${valuePath}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${xAxis}
    <line class="chart-crosshair" y1="${padT}" y2="${padT + plotH}" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3,4" opacity="0"/>
    <circle class="chart-marker" r="4" fill="var(--surface-1)" stroke="${stroke}" stroke-width="2.5" opacity="0"/>
  `;
  setupChartInteraction(target);
}

const ALLOCATION_PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#14b8a6", "#f97316", "#ec4899", "#22c55e", "#3b82f6",
  "#eab308", "#a855f7"
];
const CASH_COLOR = "#0ea5e9";

function renderPortfolioAllocationPie() {
  const availableCash = Math.max(state.portfolioCash || 0, 0);
  const segments = state.holdings
    .map(h => ({ id: h.id, label: h.symbol, kind: "holding", value: holdingValueEur(h) }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((s, i) => ({ ...s, color: ALLOCATION_PALETTE[i % ALLOCATION_PALETTE.length] }));
  if (availableCash > 0) segments.push({ id: "cash", label: "Cash", kind: "cash", value: availableCash, color: CASH_COLOR });
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (!total) {
    return `
      <div class="allocation-empty">
        <strong>${money(0)}</strong>
        <small class="muted">Add holdings or cash to see allocation.</small>
      </div>`;
  }

  const stack = segments.map(s => {
    const pct = (s.value / total) * 100;
    return `<span class="alloc-stack-segment" style="width:${pct.toFixed(2)}%;background:${s.color}" title="${escapeHtml(s.label)} · ${pct.toFixed(1)}%"></span>`;
  }).join("");

  const rows = segments.map(s => {
    const pct = (s.value / total) * 100;
    return `
      <div class="alloc-row">
        <span class="alloc-dot" style="background:${s.color}"></span>
        <strong>${escapeHtml(s.label)}</strong>
        <span class="muted alloc-pct">${pct.toFixed(1)}%</span>
        <strong class="alloc-value">${money(s.value)}</strong>
      </div>`;
  }).join("");

  return `
    <div class="allocation-summary">
      <span>Portfolio allocation</span>
      <strong>${money(total)}</strong>
    </div>
    <div class="alloc-stack">${stack}</div>
    <div class="alloc-list">${rows}</div>
  `;
}

function bindAllocationInteractions() {
  const hero = document.querySelector(".allocation-hero[data-allocation-segments]");
  if (!hero) return;
  let segments;
  try { segments = JSON.parse(decodeURIComponent(hero.dataset.allocationSegments)); }
  catch { return; }
  const total = Number(hero.dataset.allocationTotal) || 1;
  const center = hero.querySelector("#allocationPieCenter");
  const breakdown = document.querySelector("#allocationBreakdown");

  const setActive = idx => {
    hero.querySelectorAll("[data-allocation-idx]").forEach(el => {
      el.classList.toggle("is-active", Number(el.dataset.allocationIdx) === idx);
    });
    if (idx == null) {
      center.innerHTML = `<span class="allocation-pie-label">Total</span><strong>${money(total)}</strong>`;
      breakdown.innerHTML = "";
      return;
    }
    const s = segments[idx];
    const pct = (s.value / total) * 100;
    center.innerHTML = `<span class="allocation-pie-label" style="color:${s.color}">${escapeHtml(s.label)}</span><strong>${money(s.value)}</strong><small>${pct.toFixed(1)}%</small>`;
    if (s.kind === "holding") {
      const h = state.holdings.find(x => x.id === s.id);
      const pnl = h ? holdingPnlEur(h) : 0;
      const pnlClass = pnl >= 0 ? "positive" : "negative";
      const sign = pnl >= 0 ? "+" : "";
      breakdown.innerHTML = `
        <article>
          <span>${escapeHtml(s.label)} · ${h ? `${h.quantity} @ ${currencyMoney(h.price, h.currency)}` : ""}</span>
          <strong>${money(s.value)} <small class="${pnlClass}">${sign}${money(pnl)}</small></strong>
          <button type="button" class="allocation-open-btn" data-allocation-open="${escapeHtml(s.id)}">Open ${escapeHtml(s.label)} →</button>
        </article>`;
    } else {
      breakdown.innerHTML = `
        <article>
          <span>Available cash</span>
          <strong>${money(s.value)}</strong>
        </article>`;
    }
  };

  hero.addEventListener("click", e => {
    const target = e.target.closest("[data-allocation-idx]");
    if (!target) return;
    const idx = Number(target.dataset.allocationIdx);
    const currentlyActive = target.classList.contains("is-active");
    setActive(currentlyActive ? null : idx);
  });
  document.addEventListener("click", e => {
    const openBtn = e.target.closest("[data-allocation-open]");
    if (!openBtn) return;
    const id = openBtn.dataset.allocationOpen;
    if (id && id !== "cash") openHoldingDetail(id);
  });
}

function buildPortfolioGrowthPoints() {
  const today = new Date().toISOString().slice(0, 10);
  const buckets = state.holdings.reduce((map, holding) => {
    const date = dateKey(holding.createdAt) || today;
    const current = holdingValueEur(holding);
    const invested = holdingCostEur(holding);
    const bucket = map.get(date) || { value: 0, cost: 0 };
    bucket.value += current;
    bucket.cost += invested;
    map.set(date, bucket);
    return map;
  }, new Map());

  const dates = [...buckets.keys()].sort();
  let runningValue = 0;
  let runningCost = 0;
  const points = [];
  if (dates[0]) points.push({ date: addDays(dates[0], -1), value: 0, cost: 0 });
  dates.forEach((date) => {
    const bucket = buckets.get(date);
    runningValue += bucket.value;
    runningCost += bucket.cost;
    points.push({ date, value: runningValue, cost: runningCost });
  });

  if (!points.length || points.at(-1).date !== today) {
    points.push({ date: today, value: runningValue, cost: runningCost });
  }

  return points;
}

function renderAccounts() {
  if (!state.accounts.length) {
    els.accountList.innerHTML = `<div class="empty-state"><svg><use href="#icon-wallet"></use></svg><h3>No Accounts</h3><p>Add one to start.</p></div>`;
    return;
  }
  const renderCard = (acc) => {
    const count = state.transactions.filter(tx => tx.accountId === acc.id).length;
    const type = acc.type || "cash";
    const tint = type === "asset" ? "sky" : type === "liability" ? "coral" : "mint";
    const valueClass = type === "liability" ? "negative" : "";
    const displayBalance = type === "liability" ? `-${money(acc.balance)}` : money(acc.balance);
    return listRow({
      icon: accountIconKind(acc),
      tint,
      title: escapeHtml(acc.name),
      subtitle: `${count} transaction${count === 1 ? "" : "s"}`,
      value: displayBalance,
      valueClass,
      chevron: true,
      dataId: acc.id,
    });
  };
  const section = (title, accounts, total, totalClass = "") => {
    if (!accounts.length) return "";
    return `
      <div class="account-section">
        <div class="account-section-head">
          <h3>${title}</h3>
          <strong class="${totalClass}">${total}</strong>
        </div>
        <div class="list-grouped">${accounts.map(renderCard).join("")}</div>
      </div>`;
  };
  const cash = accountsOfType("cash");
  const assets = accountsOfType("asset");
  const liabilities = accountsOfType("liability");
  els.accountList.innerHTML =
    section("Cash", cash, money(totalCash())) +
    section("Assets", assets, money(totalAssets())) +
    section("Liabilities", liabilities, `-${money(totalLiabilities())}`, "negative");
  bindCardActions(els.accountList, openAccountDetail, openEditAccount);
}

function renderHoldings() {
  if (!state.holdings.length) {
    els.holdingList.innerHTML = `<div class="empty-state"><svg><use href="#icon-portfolio"></use></svg><h3>No Holdings</h3><p>Buy to start.</p></div>`;
    return;
  }
  const sortedHoldings = [...state.holdings].sort((a, b) => {
    const aValue = holdingValueEur(a), bValue = holdingValueEur(b);
    const aPnl = holdingPnlEur(a), bPnl = holdingPnlEur(b);
    return holdingSort === "pnl" ? bPnl - aPnl : bValue - aValue;
  });
  els.holdingList.innerHTML = sortedHoldings.map(h => holdingRow(h)).join("");
  bindCardActions(els.holdingList, openHoldingDetail, openEditHolding);
}

function holdingRow(h) {
  const value = holdingValueEur(h), pnl = holdingPnlEur(h), cost = holdingCostEur(h);
  const pnlPercent = cost ? (pnl / cost) * 100 : 0;
  const pnlClass = pnl >= 0 ? "positive" : "negative";
  const trailing = `
    <strong>${money(value)}</strong>
    <small class="${pnlClass}">${pnl >= 0 ? "+" : ""}${money(pnl)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)</small>
  `;
  const sym = (h.symbol || "?").toUpperCase();
  const tints = ["mint", "sky", "gold", "coral", "muted"];
  const tint = tints[sym.charCodeAt(0) % tints.length];
  const disc = `<span class="symbol-disc symbol-disc-${tint}">${escapeHtml(sym.slice(0, 2))}</span>`;
  return `
    <div class="list-row" data-id="${h.id}">
      ${disc}
      <div class="row-body">
        <strong>${escapeHtml(sym)} <small class="muted">${escapeHtml(h.currency || "")}</small></strong>
        <small>${h.quantity} × ${currencyMoney(h.price, h.currency)}</small>
      </div>
      <div class="row-trailing">${trailing}</div>
      <span class="row-chevron">${ICONS.chevron}</span>
    </div>`;
}

function renderActivity() {
  const rows = state.transactions.slice(-6).reverse();
  if (!rows.length) {
    els.activityList.innerHTML = `<div class="empty-state"><h3>No Activity</h3><p>New entries appear here.</p></div>`;
    return;
  }
  els.activityList.innerHTML = rows.map(tx => activityRow(tx)).join("");
  bindCardActions(els.activityList, null, openEditTx);
}

function activityRow(tx) {
  const kind = categoryIconKind(tx.category);
  const tint = txIconTint(tx);
  const valueClass = tx.amount >= 0 ? "positive" : "negative";
  return listRow({
    icon: kind,
    tint,
    title: escapeHtml(tx.note || tx.category || "Transaction"),
    subtitle: `${escapeHtml(tx.accountName || "Unknown")} · ${new Date(tx.createdAt).toLocaleDateString()}`,
    value: `${tx.amount >= 0 ? "+" : ""}${money(tx.amount)}`,
    valueClass,
    dataId: tx.id,
  });
}

function renderBars() {
  const accountMax = Math.max(
    ...state.accounts.map(a => Math.abs(a.balance)),
    1,
  );
  els.accountSplitLabel.textContent = `${state.accounts.length} account${state.accounts.length === 1 ? "" : "s"}`;
  els.accountBars.innerHTML = state.accounts.length
    ? state.accounts.map(acc => {
        const type = acc.type || "cash";
        const display = type === "liability" ? `-${money(acc.balance)}` : money(acc.balance);
        const label = type === "cash" ? acc.name : `${acc.name} · ${type}`;
        return barRow(label, display, Math.abs(acc.balance) / accountMax);
      }).join("")
    : `<p class="muted">No balances yet.</p>`;

  const month = new Date().toISOString().slice(0, 7);
  const categories = state.transactions
    .filter(tx => tx.createdAt.startsWith(month) && tx.amount < 0 && !NON_CASHFLOW_CATEGORIES.has(tx.category))
    .reduce((map, tx) => {
      map[tx.category] = (map[tx.category] || 0) + Math.abs(tx.amount);
      return map;
    }, {});
  const max = Math.max(...Object.values(categories), 1);
  els.categoryBars.innerHTML = Object.keys(categories).length
    ? Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([name, val]) => barRow(name, money(val), val / max)).join("")
    : `<p class="muted">No outflows yet.</p>`;
}

const NON_CASHFLOW_CATEGORIES = new Set(["transfer", "revalue", "mortgage-principal"]);

function renderInsights() {
  const month = new Date().toISOString().slice(0, 7);
  const monthlyTx = state.transactions.filter(tx => tx.createdAt.startsWith(month));
  const cashflowTx = monthlyTx.filter(tx => !NON_CASHFLOW_CATEGORIES.has(tx.category));
  const inflow = cashflowTx.filter(tx => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const outflow = cashflowTx.filter(tx => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const principalPaid = monthlyTx
    .filter(tx => tx.category === "mortgage-principal")
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const assetsTotal = totalAssets();
  const liabilitiesTotal = totalLiabilities();
  const assetsAll = totalCash() + assetsTotal + portfolioValue();
  const propertyEquity = assetsTotal - liabilitiesTotal;
  const saved = inflow - outflow;
  const savingsRate = inflow > 0 ? Math.round((saved / inflow) * 100) : 0;
  const runway = outflow > 0 ? totalCash() / outflow : null;

  els.monthlyInflow.textContent = money(inflow);
  els.monthlyOutflow.textContent = money(outflow);
  els.savingsRate.textContent = `${savingsRate}%`;
  els.savingsRate.className = savingsRate >= 0 ? "positive" : "negative";
  els.runwayMonths.textContent = runway === null ? "--" : `${Math.max(runway, 0).toFixed(1)} mo`;
  const profit = portfolioPnl();
  const profitPercent = portfolioCost() ? (profit / portfolioCost()) * 100 : 0;
  els.portfolioProfit.textContent = `${profit >= 0 ? "+" : ""}${money(profit)} · ${profitPercent >= 0 ? "+" : ""}${profitPercent.toFixed(2)}%`;
  els.portfolioProfit.className = profit >= 0 ? "positive" : "negative";
  const investedShare = netWorth() > 0 ? Math.round((portfolioValue() / netWorth()) * 100) : 0;
  els.investedShare.textContent = `${investedShare}%`;
  els.investedShare.className = investedShare >= 70 ? "positive" : "";
  const topHolding = state.holdings
    .map(h => ({ symbol: h.symbol, value: holdingValueEur(h) }))
    .sort((a, b) => b.value - a.value)[0];
  els.topHolding.textContent = topHolding ? `${topHolding.symbol} · ${money(topHolding.value)}` : "--";
  const previousWorth = state.snapshots.length > 1 ? state.snapshots[state.snapshots.length - 2].value : netWorth();
  const worthMove = netWorth() - previousWorth;
  els.worthMove.textContent = worthMove === 0 ? "Flat" : `${worthMove > 0 ? "+" : ""}${money(worthMove)}`;
  els.worthMove.className = worthMove >= 0 ? "positive" : "negative";

  els.totalAssetsCard.textContent = money(assetsAll);
  els.totalDebtCard.textContent = liabilitiesTotal > 0 ? `-${money(liabilitiesTotal)}` : money(0);
  els.totalDebtCard.className = liabilitiesTotal > 0 ? "negative" : "";
  els.propertyEquityCard.textContent = assetsTotal > 0 ? money(propertyEquity) : "--";
  els.propertyEquityCard.className = propertyEquity >= 0 ? "positive" : "negative";
  els.principalPaidCard.textContent = principalPaid > 0 ? money(principalPaid) : money(0);
  els.principalPaidCard.className = principalPaid > 0 ? "positive" : "";

  const cashSaved = Math.max(inflow - outflow, 0);
  const totalSaved = cashSaved + principalPaid;
  if (totalSaved > 0) {
    const loanPct = Math.round((principalPaid / totalSaved) * 100);
    els.savingsMixCard.textContent = `${loanPct}% loan · ${100 - loanPct}% cash`;
    els.savingsMixCard.className = "";
  } else {
    els.savingsMixCard.textContent = "--";
    els.savingsMixCard.className = "muted";
  }

  const signals = [];
  if (inflow || outflow) signals.push({ type: "Flow", title: savingsRate >= 0 ? `${savingsRate}% saved` : "Outflow heavy", detail: `${money(inflow)} in · ${money(outflow)} out` });
  signals.push({ type: "Mix", title: netWorth() > 0 ? `${investedShare}% invested` : "Waiting", detail: `${money(portfolioValue())} portfolio` });
  if (topHolding) signals.push({ type: "Exposure", title: topHolding.symbol, detail: `${Math.round((topHolding.value / Math.max(portfolioAssetValue(), 1)) * 100)}% of assets` });
  if (state.portfolioCash > 0) signals.push({ type: "Cash", title: money(state.portfolioCash), detail: "available in portfolio" });
  if (worthMove !== 0) signals.push({ type: "Move", title: `${worthMove > 0 ? "+" : ""}${money(worthMove)}`, detail: "since last snapshot" });
  if (liabilitiesTotal > 0) {
    const debtRatio = assetsAll > 0 ? Math.round((liabilitiesTotal / assetsAll) * 100) : 100;
    signals.push({ type: "Debt", title: `${debtRatio}% leverage`, detail: `${money(liabilitiesTotal)} owed on ${money(assetsAll)}` });
  }
  if (principalPaid > 0) signals.push({ type: "Equity", title: `+${money(principalPaid)}`, detail: "principal paid this month" });

  els.signalCount.textContent = `${signals.length} active`;
  const tintForSignal = {
    Flow: "mint", Mix: "sky", Exposure: "gold", Cash: "mint",
    Move: "sky", Debt: "coral", Equity: "mint",
  };
  const iconForSignal = {
    Flow: "income", Mix: "revalue", Exposure: "generic", Cash: "wallet",
    Move: "transfer", Debt: "debt", Equity: "mortgage",
  };
  els.signalList.innerHTML = signals.map(s => listRow({
    icon: iconForSignal[s.type] || "generic",
    tint: tintForSignal[s.type] || "muted",
    title: escapeHtml(s.title),
    subtitle: `${escapeHtml(s.type)} · ${escapeHtml(s.detail)}`,
  })).join("");
}

function barRow(label, value, ratio) {
  return `
    <div class="bar-row">
      <div class="bar-top">
        <strong>${escapeHtml(label)}</strong>
        <span>${value}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(ratio * 100, 2)}%"></div></div>
    </div>`;
}

function renderChat() {
  els.chatLog.innerHTML = state.chats.slice(-30).map(msg => {
    if (msg.role === 'pending') {
      return `<div class="message pending"><div class="dot-flashing"></div></div>`;
    }
    
    let html = `<div class="message ${msg.role}">${escapeHtml(msg.text)}</div>`;
    
    // Add interactive actions for OpenClaw confirmation requests
    if (msg.action_id && msg.action_status === "pending") {
      html += `
        <div class="message action-prompt" data-action="${msg.action_id}">
          <button class="action-btn cancel-btn">Cancel</button>
          <button class="action-btn confirm-btn">Confirm</button>
        </div>`;
    }
    return html;
  }).join("");
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function buildNetWorthTrend(perspective = currentPerspective) {
  const currentWorth = worthForPerspective(perspective);
  const accountTypeById = new Map(state.accounts.map(a => [a.id, a.type || "cash"]));
  const contribOf = (tx) => {
    const type = accountTypeById.get(tx.accountId) || "cash";
    const amt = Number(tx.amount || 0);
    if (perspective === "gross") return type === "liability" ? 0 : amt;
    if (perspective === "liquid") return type === "cash" ? amt : 0;
    return type === "liability" ? -amt : amt;
  };
  const today = new Date().toISOString().slice(0, 10);
  const pointsByDate = new Map([[today, currentWorth]]);
  const transactionTotalsByDate = state.transactions.reduce((map, tx) => {
    const date = dateKey(tx.createdAt);
    if (!date || date > today) return map;
    map.set(date, (map.get(date) || 0) + contribOf(tx));
    return map;
  }, new Map());

  let runningWorth = currentWorth;
  const transactionDates = [...transactionTotalsByDate.keys()].sort().reverse();
  transactionDates.forEach((date) => {
    if (date !== today) pointsByDate.set(date, runningWorth);
    runningWorth -= transactionTotalsByDate.get(date);
  });

  const earliestTransactionDate = transactionDates.at(-1);
  if (earliestTransactionDate) {
    pointsByDate.set(addDays(earliestTransactionDate, -1), runningWorth);
  }

  state.snapshots.forEach((point) => {
    const date = dateKey(point.date);
    const value = Number(point.value);
    if (date && Number.isFinite(value)) pointsByDate.set(date, value);
  });

  const oldestAllowed = addDays(today, -59);
  const points = [...pointsByDate.entries()]
    .filter(([date]) => date >= oldestAllowed && date <= today)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length < 2) {
    return [
      { date: addDays(today, -1), value: currentWorth },
      { date: today, value: currentWorth }
    ];
  }

  return points;
}

function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(dateKeyValue, days) {
  const date = new Date(`${dateKeyValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function filterPointsForRange(points, range) {
  if (!points.length) return points;
  const cutoff = addDays(new Date().toISOString().slice(0, 10), -(RANGE_DAYS[range] || RANGE_DAYS["1M"]));
  const inRange = points.filter((point) => point.date >= cutoff);
  const previous = [...points].reverse().find((point) => point.date < cutoff);
  const filtered = previous ? [previous, ...inRange] : inRange;
  return filtered.length ? filtered : points.slice(-2);
}

function renderLineChart(target, height, points = buildNetWorthTrend()) {
  const width = target.clientWidth;
  if (!width) {
    requestAnimationFrame(() => renderLineChart(target, height, points));
    return;
  }
  target.setAttribute("viewBox", `0 0 ${width} ${height}`);
  attachChartResizeObserver(target, height);
  if (!points.length) { target.innerHTML = ""; return; }
  const values = points.map(p => p.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padSpan = Math.max((high - low) * 0.08, Math.max(Math.abs(high), 1) * 0.02);
  const yMin = low - padSpan;
  const yMax = high + padSpan;
  const yRange = (yMax - yMin) || 1;
  const padL = 6, padR = 6, padT = 16, padB = 22;
  const plotW = Math.max(width - padL - padR, 1);
  const plotH = Math.max(height - padT - padB, 1);

  const chartData = points.map((p, i) => ({
    ...p,
    x: padL + (i / Math.max(points.length - 1, 1)) * plotW,
    y: padT + (1 - ((p.value - yMin) / yRange)) * plotH,
  }));
  const coords = chartData.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  const linePath = `M${coords.join(" L")}`;
  const last = chartData.at(-1);
  const first = chartData[0];
  const areaPath = `${linePath} L${last.x.toFixed(1)} ${(padT + plotH).toFixed(1)} L${first.x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
  const up = values.at(-1) >= values[0];
  const stroke = up ? "var(--good)" : "var(--danger)";

  // 4 y-axis grid lines, labels sit just above each line at the left edge
  const yTicks = 4;
  let yAxis = "";
  for (let i = 0; i <= yTicks; i++) {
    const v = yMax - (i / yTicks) * yRange;
    const y = padT + (i / yTicks) * plotH;
    yAxis += `<line x1="${padL}" x2="${width - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.08" stroke-width="1"/>`;
    if (i < yTicks) {
      yAxis += `<text x="${padL + 2}" y="${(y - 4).toFixed(1)}" text-anchor="start" font-size="10" fill="currentColor" fill-opacity="0.6">${compactMoney(v)}</text>`;
    }
  }

  // up to 4 x-axis date ticks
  const xTicks = Math.min(4, points.length - 1);
  let xAxis = "";
  for (let i = 0; i <= xTicks; i++) {
    const idx = Math.round((i / xTicks) * (points.length - 1));
    const x = chartData[idx].x;
    xAxis += `<text x="${x.toFixed(1)}" y="${height - 4}" text-anchor="${i === 0 ? "start" : i === xTicks ? "end" : "middle"}" font-size="10" fill="currentColor" fill-opacity="0.55">${formatChartDate(points[idx].date)}</text>`;
  }

  target._chartData = chartData;
  target._chartWidth = width;
  target._chartHeight = height;
  target.innerHTML = `
    ${yAxis}
    <path d="${areaPath}" fill="${stroke}" fill-opacity="0.12"/>
    <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${xAxis}
    <line class="chart-crosshair" y1="${padT}" y2="${padT + plotH}" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3,4" opacity="0"/>
    <circle class="chart-marker" r="4" fill="var(--surface-1)" stroke="${stroke}" stroke-width="2.5" opacity="0"/>
  `;
  setupChartInteraction(target);
}

function attachChartResizeObserver(target, height) {
  if (target._chartObserved || !window.ResizeObserver) return;
  target._chartObserved = true;
  let lastWidth = target.clientWidth;
  const obs = new ResizeObserver(() => {
    const w = target.clientWidth;
    if (!w || w === lastWidth) return;
    lastWidth = w;
    renderLineChart(target, height);
  });
  obs.observe(target);
}

function setupChartInteraction(target) {
  if (target._chartInteractive) return;
  target._chartInteractive = true;

  const update = (event) => {
    const points = target._chartData || [];
    if (!points.length) return;
    const rect = target.getBoundingClientRect();
    const x = Math.min(Math.max(((event.clientX - rect.left) / rect.width) * target._chartWidth, 0), target._chartWidth);
    const nearest = points.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best, points[0]);
    const crosshair = target.querySelector(".chart-crosshair");
    const marker = target.querySelector(".chart-marker");
    const tooltip = ensureChartTooltip(target);

    crosshair.setAttribute("x1", nearest.x);
    crosshair.setAttribute("x2", nearest.x);
    crosshair.setAttribute("opacity", "0.5");
    marker.setAttribute("cx", nearest.x);
    marker.setAttribute("cy", nearest.y);
    marker.setAttribute("opacity", "1");
    const formatValue = target._formatValue || money;
    tooltip.textContent = `${formatChartDate(nearest.date)} · ${formatValue(nearest.value)}`;
    tooltip.classList.add("active");
    tooltip.style.left = `${(nearest.x / target._chartWidth) * 100}%`;
    tooltip.style.top = `${Math.max((nearest.y / target._chartHeight) * 100, 12)}%`;
  };

  const hide = () => {
    target.querySelector(".chart-crosshair")?.setAttribute("opacity", "0");
    target.querySelector(".chart-marker")?.setAttribute("opacity", "0");
    ensureChartTooltip(target).classList.remove("active");
  };

  target.addEventListener("pointerdown", (event) => {
    target.setPointerCapture?.(event.pointerId);
    update(event);
  });
  target.addEventListener("pointermove", update);
  target.addEventListener("pointerleave", hide);
}

function ensureChartTooltip(target) {
  let tooltip = target.parentElement.querySelector(".chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    target.parentElement.appendChild(tooltip);
  }
  return tooltip;
}

function formatChartDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ----------------------------------------
// Chat & Interaction
// ----------------------------------------
document.querySelector("#chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  els.chatInput.value = "";
  
  state.chats.push({ id: crypto.randomUUID(), role: "user", text, createdAt: new Date().toISOString() });
  const pendingId = crypto.randomUUID();
  state.chats.push({ id: pendingId, role: "pending" });
  renderChat();
  
  try {
    const res = await api("/api/chat", { method: "POST", body: JSON.stringify({ message: text }) });
    state.chats = state.chats.filter(c => c.id !== pendingId);
    await loadServerState();
    showToast("Transaction logged!");
  } catch (err) {
    state.chats = state.chats.filter(c => c.id !== pendingId);
    renderChat();
  }
});

// ----------------------------------------
// Overlay stack — wires iOS swipe-back / Android back to close topmost overlay
// ----------------------------------------
const overlayStack = [];
function pushOverlay(closeUI) {
  overlayStack.push(closeUI);
  history.pushState({ overlay: overlayStack.length }, "");
}
function dismissTopOverlay() {
  if (overlayStack.length) history.back();
}
window.addEventListener("popstate", () => {
  const closeUI = overlayStack.pop();
  if (closeUI) closeUI();
});

// ----------------------------------------
// Modals & Editing
// ----------------------------------------
let currentModalAction = null;

function openModal(title, fieldsHtml, onSave, onDelete, options = {}) {
  els.modalTitle.textContent = title;
  els.modalHeaderAccessory.innerHTML = options.headerAccessoryHtml || "";
  els.modalFormFields.innerHTML = fieldsHtml;
  els.modalDeleteBtn.style.display = onDelete ? "block" : "none";
  els.modalSaveBtn.style.display = options.hideSave ? "none" : "inline-flex";
  els.modalSaveBtn.textContent = options.saveLabel || "Save Changes";
  currentModalAction = { onSave, onDelete };
  els.modalBackdrop.classList.add("active");
  pushOverlay(closeModalUI);
}

function closeModalUI() {
  els.modalBackdrop.classList.remove("active");
  currentModalAction = null;
  els.modalHeaderAccessory.innerHTML = "";
  els.modalSaveBtn.style.display = "inline-flex";
  els.modalSaveBtn.textContent = "Save Changes";
  els.genericForm.reset();
}

function closeModal() { dismissTopOverlay(); }

els.modalBackdrop.addEventListener("click", e => { if (e.target === els.modalBackdrop) closeModal(); });
document.querySelector("#modalCloseBtn").addEventListener("click", closeModal);
document.querySelector("#modalCancelBtn").addEventListener("click", closeModal);

els.genericForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentModalAction?.onSave) return closeModal();
  try {
    await currentModalAction.onSave(new FormData(els.genericForm));
    closeModal();
  } catch (err) {
    showToast(err.message || "Save failed", "error");
  }
});

els.modalDeleteBtn.addEventListener("click", async () => {
  if (!confirm("Are you sure you want to delete this?") || !currentModalAction?.onDelete) return;
  try {
    await currentModalAction.onDelete();
    closeModal();
  } catch (err) {
    showToast(err.message || "Delete failed", "error");
  }
});

function openEditAccount(id) {
  const acc = state.accounts.find(a => a.id === id);
  if (!acc) return;
  openModal("Edit Account", `
    <label class="tx-field"><span>Name</span>
      <input name="name" value="${escapeHtml(acc.name)}" required />
    </label>
    <label class="tx-field"><span>Type</span>
      <select name="type">${accountTypeOptions(acc.type || "cash")}</select>
    </label>
    <label class="tx-field"><span>Balance</span>
      <input name="balance" type="number" inputmode="decimal" step="0.01" value="${acc.balance}" required />
    </label>
  `, async fd => {
    await api(`/api/accounts/${id}`, { method: "PUT", body: JSON.stringify({
      name: fd.get("name"), balance: fd.get("balance"), type: fd.get("type"),
    }) });
    await loadServerState(); showToast("Account updated");
  }, async () => {
    await api(`/api/accounts/${id}`, { method: "DELETE" });
    await loadServerState(); showToast("Account deleted");
  });
}

function openEditHolding(id) {
  const holding = state.holdings.find(h => h.id === id);
  if (!holding) return;
  openModal("Edit Holding", `
    <input name="symbol" value="${escapeHtml(holding.symbol)}" required />
    <input name="quantity" type="number" inputmode="decimal" step="0.000001" value="${holding.quantity}" required />
    <input name="cost" type="number" inputmode="decimal" step="0.01" value="${holding.cost}" required />
    <input name="price" type="number" inputmode="decimal" step="0.01" value="${holding.price}" required />
    <select name="currency" aria-label="Currency">${currencyOptions(holding.currency)}</select>
  `, async fd => {
    await api(`/api/holdings/${id}`, { method: "PUT", body: JSON.stringify(Object.fromEntries(fd)) });
    await loadServerState(); showToast("Holding updated");
  }, async () => {
    await api(`/api/holdings/${id}`, { method: "DELETE" });
    await loadServerState(); showToast("Holding deleted");
  });
}

function openEditTx(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  openModal("Edit Transaction", `
    <label class="tx-field"><span>Account</span>
      <select name="account_id" required>${accountOptions(tx.accountId)}</select>
    </label>
    <label class="tx-field"><span>Amount</span>
      <input name="amount" type="number" inputmode="decimal" step="0.01" value="${tx.amount}" required />
    </label>
    <label class="tx-field"><span>Category</span>
      <input name="category" value="${escapeHtml(tx.category)}" required />
    </label>
    <label class="tx-field"><span>Note</span>
      <input name="note" value="${escapeHtml(tx.note)}" />
    </label>
  `, async fd => {
    await api(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(Object.fromEntries(fd)) });
    await loadServerState(); showToast("Transaction updated");
  }, async () => {
    await api(`/api/transactions/${id}`, { method: "DELETE" });
    await loadServerState(); showToast("Transaction deleted");
  });
}

function bindCardActions(rootEl, openDetail, openEdit) {
  rootEl.querySelectorAll(".edit-account, .edit-holding, .edit-tx, [data-action='edit']").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      openEdit(btn.dataset.id);
    });
  });
  rootEl.querySelectorAll(".account-card, .holding-row, .list-row[data-id]").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest(".action-btn, [data-action='edit']")) return;
      const id = card.dataset.id;
      if (openDetail) openDetail(id);
      else if (openEdit) openEdit(id);
    });
  });
}

document.body.addEventListener("click", e => {
  if (e.target.matches(".confirm-btn")) {
    const actionId = e.target.closest(".action-prompt").dataset.action;
    handleAgentAction(actionId, "confirm");
  } else if (e.target.matches(".cancel-btn")) {
    const actionId = e.target.closest(".action-prompt").dataset.action;
    handleAgentAction(actionId, "cancel");
  }
});

async function handleAgentAction(id, type) {
  try {
    await api(`/api/agent/${type}/${id}`, { method: "POST" });
    await loadServerState();
    showToast(`Action ${type}ed!`, type === "confirm" ? "success" : "error");
  } catch(err) {}
}

// ----------------------------------------
// Detail Views
// ----------------------------------------
function openAccountDetail(id) {
  const acc = state.accounts.find(a => a.id === id);
  if (!acc) return;
  document.querySelector("#accountDetailTitle").textContent = acc.name;
  document.querySelector("#accountDetailBalance").textContent = money(acc.balance);
  
  const txs = state.transactions.filter(t => t.accountId === id);
  const thisMonth = txs.filter(t => t.createdAt.startsWith(new Date().toISOString().slice(0, 7)));
  const net = thisMonth.reduce((s, t) => s + t.amount, 0);
  document.querySelector("#accountDetailNet").textContent = money(net);
  document.querySelector("#accountDetailNet").className = net >= 0 ? "positive" : "negative";

  const txListEl = document.querySelector("#accountDetailTxList");
  txListEl.innerHTML = txs.length
    ? txs.map(tx => activityRow(tx)).join("")
    : `<p class="muted">No transactions found.</p>`;
  bindCardActions(txListEl, null, openEditTx);
  els.accountDetailView.dataset.id = id;
  els.accountDetailView.classList.add("active");
  pushOverlay(() => els.accountDetailView.classList.remove("active"));
}

function setSignedMetric(el, signedText, isPositive) {
  el.textContent = signedText;
  el.classList.remove("positive", "negative", "muted");
  el.classList.add(isPositive == null ? "muted" : isPositive ? "positive" : "negative");
}

function openHoldingDetail(id) {
  const h = state.holdings.find(x => x.id === id);
  if (!h) return;
  document.querySelector("#holdingDetailTitle").textContent = h.symbol;
  document.querySelector("#holdingDetailValue").textContent = money(holdingValueEur(h));
  const pnl = holdingPnlEur(h);
  document.querySelector("#holdingDetailPnl").textContent = `${pnl >= 0 ? '+' : ''}${money(pnl)}`;
  document.querySelector("#holdingDetailPnl").className = pnl >= 0 ? "positive" : "negative";
  document.querySelector("#holdingDetailQty").textContent = h.quantity;
  document.querySelector("#holdingDetailPrice").textContent = currencyMoney(h.price, h.currency);
  document.querySelector("#holdingDetailCost").textContent = currencyMoney(h.cost, h.currency);
  document.querySelector("#holdingDetailPriceDate").textContent = h.lastPriceAt ? `Updated ${new Date(h.lastPriceAt).toLocaleString()}` : "Manual";

  const dayEl = document.querySelector("#holdingDetailDayChange");
  if (h.previousClose && h.previousClose > 0) {
    const dayDelta = (h.price - h.previousClose) * h.quantity;
    const dayPct = ((h.price - h.previousClose) / h.previousClose) * 100;
    const sign = dayDelta >= 0 ? "+" : "";
    setSignedMetric(dayEl, `${sign}${currencyMoney(dayDelta, h.currency)} (${sign}${dayPct.toFixed(2)}%)`, dayDelta >= 0);
  } else {
    setSignedMetric(dayEl, "—", null);
  }

  const sinceEl = document.querySelector("#holdingDetailSinceBuy");
  const totalCost = h.cost * h.quantity;
  if (totalCost > 0) {
    const sinceDelta = (h.price - h.cost) * h.quantity;
    const sincePct = ((h.price - h.cost) / h.cost) * 100;
    const sign = sinceDelta >= 0 ? "+" : "";
    setSignedMetric(sinceEl, `${sign}${currencyMoney(sinceDelta, h.currency)} (${sign}${sincePct.toFixed(2)}%)`, sinceDelta >= 0);
  } else {
    setSignedMetric(sinceEl, "—", null);
  }

  els.holdingDetailView.dataset.id = id;
  els.holdingDetailView.classList.add("active");
  loadHoldingChart(h, currentChartRange);
  pushOverlay(() => els.holdingDetailView.classList.remove("active"));
}

let currentChartRange = "1mo";

async function loadHoldingChart(holding, range) {
  const chartEl = document.querySelector("#holdingChart");
  chartEl.innerHTML = `<div class="chart-state muted">Loading…</div>`;
  document.querySelectorAll("#holdingChartRanges button").forEach(b => {
    b.classList.toggle("active", b.dataset.range === range);
  });
  try {
    const data = await api(`/api/price-history?symbol=${encodeURIComponent(holding.symbol)}&range=${range}`);
    if (!data?.points?.length) {
      chartEl.innerHTML = `<div class="chart-state muted">No data</div>`;
      return;
    }
    renderHoldingSparkline(chartEl, data.points, holding);
  } catch {
    chartEl.innerHTML = `<div class="chart-state muted">Could not load chart</div>`;
  }
}

function renderHoldingSparkline(chartEl, points, holding) {
  const w = chartEl.clientWidth || 360;
  const h = 180;
  const padL = 6, padR = 6, padT = 16, padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const closes = points.map(p => p.c);
  const avgCost = holding && holding.cost > 0 ? holding.cost : null;
  const minSrc = avgCost != null ? Math.min(Math.min(...closes), avgCost) : Math.min(...closes);
  const maxSrc = avgCost != null ? Math.max(Math.max(...closes), avgCost) : Math.max(...closes);
  const span = (maxSrc - minSrc) || 1;
  const padSpan = span * 0.08;
  const yMin = minSrc - padSpan, yMax = maxSrc + padSpan;
  const yRange = yMax - yMin;
  const yFor = v => padT + ((yMax - v) / yRange) * plotH;
  const xFor = i => padL + (i / Math.max(points.length - 1, 1)) * plotW;
  const chartData = points.map((p, i) => ({
    date: p.t,
    value: p.c,
    x: xFor(i),
    y: yFor(p.c),
  }));
  const coords = chartData.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  const linePath = `M${coords.join(" L")}`;
  const last = chartData.at(-1);
  const first = chartData[0];
  const areaPath = `${linePath} L${last.x.toFixed(1)} ${padT + plotH} L${first.x.toFixed(1)} ${padT + plotH} Z`;
  const up = closes.at(-1) >= closes[0];
  const stroke = up ? "var(--good)" : "var(--danger)";

  const fmtPrice = v => v >= 100 ? v.toFixed(0) : v.toFixed(2);

  // Y-axis grid + labels inline above each grid line
  const yTicks = 4;
  let yAxis = "";
  for (let i = 0; i <= yTicks; i++) {
    const v = yMax - (i / yTicks) * yRange;
    const y = padT + (i / yTicks) * plotH;
    yAxis += `<line x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.08" stroke-width="1"/>`;
    if (i < yTicks) {
      yAxis += `<text x="${padL + 2}" y="${(y - 4).toFixed(1)}" text-anchor="start" font-size="10" fill="currentColor" fill-opacity="0.6">${fmtPrice(v)}</text>`;
    }
  }

  // X-axis date ticks
  const xTicks = Math.min(4, points.length - 1);
  let xAxis = "";
  for (let i = 0; i <= xTicks; i++) {
    const idx = Math.round((i / xTicks) * (points.length - 1));
    const x = chartData[idx].x;
    xAxis += `<text x="${x.toFixed(1)}" y="${h - 4}" text-anchor="${i === 0 ? "start" : i === xTicks ? "end" : "middle"}" font-size="10" fill="currentColor" fill-opacity="0.55">${formatChartDate(points[idx].t)}</text>`;
  }

  let avgLine = "";
  let avgLabel = "";
  if (avgCost != null && avgCost >= yMin && avgCost <= yMax) {
    const y = yFor(avgCost).toFixed(1);
    avgLine = `<line x1="${padL}" x2="${w - padR}" y1="${y}" y2="${y}" stroke="currentColor" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.5"/>`;
    avgLabel = `<text x="${w - padR - 2}" y="${(Number(y) - 3).toFixed(1)}" text-anchor="end" font-size="10" fill="currentColor" fill-opacity="0.7">Avg ${fmtPrice(avgCost)}</text>`;
  }

  chartEl.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="holding-chart-svg" aria-label="Price history">
      ${yAxis}
      <path d="${areaPath}" fill="${stroke}" fill-opacity="0.12"/>
      <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${avgLine}
      ${avgLabel}
      ${xAxis}
      <line class="chart-crosshair" y1="${padT}" y2="${padT + plotH}" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3,4" opacity="0"/>
      <circle class="chart-marker" r="4" fill="var(--surface-1)" stroke="${stroke}" stroke-width="2.5" opacity="0"/>
    </svg>`;
  const svg = chartEl.querySelector("svg");
  svg._chartData = chartData;
  svg._chartWidth = w;
  svg._chartHeight = h;
  svg._formatValue = fmtPrice;
  setupChartInteraction(svg);
}

document.querySelector("#holdingChartRanges").addEventListener("click", e => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  currentChartRange = btn.dataset.range;
  const id = els.holdingDetailView.dataset.id;
  const h = state.holdings.find(x => x.id === id);
  if (h) loadHoldingChart(h, currentChartRange);
});

document.querySelector("#closeAccountDetail").addEventListener("click", dismissTopOverlay);
document.querySelector("#closeHoldingDetail").addEventListener("click", dismissTopOverlay);
document.querySelector("#editAccountDetail").addEventListener("click", () => {
  const id = els.accountDetailView.dataset.id;
  if (id) openEditAccount(id);
});
document.querySelector("#editHoldingDetail").addEventListener("click", () => {
  const id = els.holdingDetailView.dataset.id;
  if (id) openEditHolding(id);
});

// Swipe-from-left-edge to dismiss detail views
function enableSwipeBack(viewEl) {
  let startX = 0, startY = 0, dx = 0, startedAt = 0, tracking = false;
  viewEl.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (t.clientX > 28) return;
    tracking = true;
    startX = t.clientX;
    startY = t.clientY;
    startedAt = Date.now();
    viewEl.style.transition = "none";
  }, { passive: true });
  viewEl.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 20) {
      tracking = false;
      viewEl.style.transform = "";
      viewEl.style.transition = "";
      return;
    }
    if (dx > 0) viewEl.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  viewEl.addEventListener("touchend", () => {
    if (!tracking) return;
    tracking = false;
    const elapsed = Date.now() - startedAt;
    const velocity = dx / Math.max(elapsed, 1);
    viewEl.style.transition = "transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)";
    if (dx > 80 || velocity > 0.4) {
      viewEl.style.transform = `translateX(100%)`;
      setTimeout(() => {
        viewEl.style.transform = "";
        viewEl.style.transition = "";
        dismissTopOverlay();
      }, 200);
    } else {
      viewEl.style.transform = "";
    }
    dx = 0;
  });
}
enableSwipeBack(els.accountDetailView);
enableSwipeBack(els.holdingDetailView);

// Pull-to-refresh on the main scroller
(function enablePullToRefresh() {
  const indicator = document.createElement("div");
  indicator.className = "pull-indicator";
  indicator.innerHTML = `<div class="pull-spinner"></div>`;
  document.body.appendChild(indicator);

  let startY = 0, dy = 0, tracking = false, refreshing = false;
  const threshold = 70;

  function isOverlayOpen() {
    return overlayStack.length > 0 || els.accountDetailView.classList.contains("active") || els.holdingDetailView.classList.contains("active");
  }

  window.addEventListener("touchstart", (e) => {
    if (refreshing || isOverlayOpen()) return;
    if (window.scrollY > 0) return;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0) {
      indicator.style.transform = "";
      indicator.style.opacity = "";
      return;
    }
    const pull = Math.min(dy * 0.5, threshold + 20);
    indicator.style.transform = `translate(-50%, ${pull}px)`;
    indicator.style.opacity = Math.min(pull / threshold, 1).toString();
  }, { passive: true });

  window.addEventListener("touchend", async () => {
    if (!tracking) return;
    tracking = false;
    if (dy > threshold && !refreshing) {
      refreshing = true;
      indicator.classList.add("active");
      indicator.style.transform = `translate(-50%, ${threshold}px)`;
      try {
        await loadServerState();
        haptic("success");
      } finally {
        indicator.classList.remove("active");
        indicator.style.transform = "";
        indicator.style.opacity = "";
        refreshing = false;
      }
    } else {
      indicator.style.transform = "";
      indicator.style.opacity = "";
    }
    dy = 0;
  });
})();

// Original Add Forms
const ACCOUNT_TYPES = [
  { value: "cash", label: "Cash (bank, wallet)" },
  { value: "asset", label: "Asset (house, car)" },
  { value: "liability", label: "Liability (mortgage, loan)" },
];

function accountTypeOptions(selected) {
  return ACCOUNT_TYPES
    .map(t => `<option value="${t.value}"${t.value === selected ? " selected" : ""}>${t.label}</option>`)
    .join("");
}

function openNewAccountModal() {
  openModal("New Account", `
    <label class="tx-field"><span>Name</span>
      <input name="name" placeholder="Account name" required />
    </label>
    <label class="tx-field"><span>Type</span>
      <select name="type">${accountTypeOptions("cash")}</select>
    </label>
    <label class="tx-field"><span>Opening balance</span>
      <input name="balance" type="number" inputmode="decimal" step="0.01" placeholder="0.00" required />
    </label>
    <small class="muted">For liabilities, enter the amount owed as a positive number.</small>
  `, async fd => {
    await api("/api/accounts", { method: "POST", body: JSON.stringify({
      name: fd.get("name"), balance: fd.get("balance"), type: fd.get("type"),
    }) });
    await loadServerState(); showToast("Account created");
  });
}

document.querySelector("#addAccountButton").addEventListener("click", openManualTxModal);
document.querySelector("#settingsAddAccountBtn").addEventListener("click", () => {
  document.querySelector("#settingsBackdrop").classList.remove("active");
  openNewAccountModal();
});

function togglePortfolioActionMenu() {
  els.portfolioActionMenu.classList.toggle("active");
}

function closePortfolioActionMenu() {
  els.portfolioActionMenu.classList.remove("active");
}

function openBuyHoldingModal() {
  const defaultCurrency = "USD";
  openModal("Buy Holding", `
    <input name="symbol" placeholder="Symbol" autocomplete="off" required />
    <input name="quantity" type="number" inputmode="decimal" step="0.000001" placeholder="Quantity" required />
    <input name="cost" type="number" inputmode="decimal" step="0.01" placeholder="Purchase price per unit" required />
    <input name="price" type="number" inputmode="decimal" step="0.01" placeholder="Current price (optional)" />
    <input name="currency" type="hidden" value="${defaultCurrency}" />
    <label class="cash-toggle">
      <input name="use_portfolio_cash" type="checkbox" />
      <span>
        <strong>Use portfolio cash</strong>
        <small>${money(state.portfolioCash || 0)} available</small>
      </span>
    </label>
  `, async fd => {
    const symbol = String(fd.get("symbol")).toUpperCase().trim();
    const cost = Number(fd.get("cost"));
    const manualPrice = Number(fd.get("price"));
    const currency = cleanCurrency(fd.get("currency"));
    const usePortfolioCash = fd.get("use_portfolio_cash") === "on";
    let price;
    try {
      price = await fetchLivePrice(symbol);
    } catch {
      price = Number.isFinite(manualPrice) && manualPrice > 0 ? manualPrice : cost;
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Ticker "${symbol}" returned no price. Double-check the symbol.`);
    }
    await api("/api/holdings", {
      method: "POST",
      body: JSON.stringify({ symbol, quantity: fd.get("quantity"), cost, price, currency, use_portfolio_cash: usePortfolioCash })
    });
    await loadServerState();
    showToast(`Holding ${symbol} added at ${currencyMoney(price, currency)}`);
  }, null, { headerAccessoryHtml: currencySlider(defaultCurrency) });
  const symbolInput = els.modalFormFields.querySelector('input[name="symbol"]');
  bindModalCurrencySlider();
  if (symbolInput) {
    attachTickerAutocomplete(symbolInput, "symbolSuggestions");
    symbolInput.addEventListener("input", () => {
      setModalCurrency(inferCurrency(symbolInput.value));
    });
  }
}

function openSellHoldingModal() {
  const defaultCurrency = "USD";
  openModal("Sell Holding", `
    <input name="symbol" placeholder="Ticker — VWCE, AAPL..." autocomplete="off" required />
    <input name="quantity" type="number" inputmode="decimal" step="0.000001" placeholder="Quantity to sell" required />
    <input name="price" type="number" inputmode="decimal" step="0.01" placeholder="Sale price per unit (optional)" />
    <input name="currency" type="hidden" value="${defaultCurrency}" />
    <small class="muted">Proceeds go to portfolio cash.</small>
  `, async fd => {
    const payload = Object.fromEntries(fd);
    payload.symbol = String(payload.symbol).toUpperCase().trim();
    delete payload.credit_account;
    const result = await api("/api/portfolio/sell", { method: "POST", body: JSON.stringify(payload) });
    await loadServerState();
    showToast(result.message || `Sold ${payload.quantity} ${payload.symbol}`);
  }, null, { saveLabel: "Record Sale", headerAccessoryHtml: currencySlider(defaultCurrency) });
  const symbolInput = els.modalFormFields.querySelector('input[name="symbol"]');
  bindModalCurrencySlider();
  if (symbolInput) {
    attachTickerAutocomplete(symbolInput, "sellSymbolSuggestions");
    symbolInput.addEventListener("input", () => {
      const symbol = symbolInput.value.toUpperCase().trim();
      const holding = state.holdings.find(h => h.symbol === symbol);
      setModalCurrency(holding?.currency || inferCurrency(symbol));
    });
  }
}

document.querySelector("#addHoldingButton").addEventListener("click", (event) => {
  event.stopPropagation();
  togglePortfolioActionMenu();
});

els.portfolioActionMenu.addEventListener("click", (event) => {
  const action = event.target.closest("[data-portfolio-action]")?.dataset.portfolioAction;
  if (!action) return;
  closePortfolioActionMenu();
  if (action === "buy") openBuyHoldingModal();
  if (action === "sell") openSellHoldingModal();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#portfolioActionMenu") && !event.target.closest("#addHoldingButton")) {
    closePortfolioActionMenu();
  }
});

document.querySelector("#addTxBtn").addEventListener("click", openManualTxModal);

function accountOptions(selectedId, filterType) {
  return state.accounts
    .filter(a => !filterType || (a.type || "cash") === filterType)
    .map(a => `<option value="${a.id}"${a.id === selectedId ? " selected" : ""}>${escapeHtml(a.name)}</option>`)
    .join("");
}

const TX_TYPE_LABELS = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  payment: "Payment",
  revalue: "Revalue",
};

function txTypesForAccount(accType) {
  if (accType === "asset") return ["revalue"];
  if (accType === "liability") return ["payment"];
  return ["expense", "income", "transfer"];
}

function openManualTxModal() {
  if (!state.accounts.length) return showToast("Add an account first in Settings", "error");
  const accountOptionsGrouped = () => {
    const group = (label, type) => {
      const items = accountsOfType(type);
      if (!items.length) return "";
      const opts = items.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
      return `<optgroup label="${label}">${opts}</optgroup>`;
    };
    return group("Cash", "cash") + group("Assets", "asset") + group("Liabilities", "liability");
  };

  openModal("New Transaction", `
    <label class="tx-field"><span>Account</span>
      <select name="account" required>${accountOptionsGrouped()}</select>
    </label>
    <div class="tx-type-tabs" role="tablist" aria-label="Transaction type"></div>
    <input type="hidden" name="type" value="" />
    <label class="tx-field tx-to-field hidden"><span>Destination</span>
      <select name="toAccount">${accountOptions(null, "cash")}</select>
    </label>
    <label class="tx-field tx-amount-field"><span>Amount</span>
      <input name="amount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" required />
    </label>
    <label class="tx-field tx-interest-field hidden"><span>Interest portion</span>
      <input name="interest" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" />
    </label>
    <label class="tx-field tx-newvalue-field hidden"><span>New value</span>
      <input name="newValue" type="number" inputmode="decimal" step="0.01" placeholder="0.00" />
    </label>
    <label class="tx-field tx-category-field"><span>Category</span>
      <input name="category" placeholder="Category" required />
    </label>
    <label class="tx-field tx-note-field"><span>Note</span>
      <input name="note" placeholder="Note" />
    </label>
  `, async fd => {
    const type = fd.get("type");
    const accountId = fd.get("account");
    const note = fd.get("note") || "";
    const acc = state.accounts.find(a => a.id === accountId);
    if (!acc) throw new Error("Pick an account");

    if (type === "revalue") {
      const newValue = Number(fd.get("newValue"));
      if (!Number.isFinite(newValue)) throw new Error("Enter the new value");
      const delta = newValue - acc.balance;
      if (delta === 0) throw new Error("New value matches current balance");
      await api("/api/transactions", { method: "POST", body: JSON.stringify({
        account_id: acc.id, amount: delta, category: "revalue",
        note: note || `Revalue to ${money(newValue)}`,
      }) });
      await loadServerState(); showToast("Revalued");
      return;
    }

    const amount = Math.abs(Number(fd.get("amount") || 0));
    if (!amount) throw new Error("Amount must be greater than zero");

    if (type === "payment") {
      const interest = Math.abs(Number(fd.get("interest") || 0));
      if (interest > amount) throw new Error("Interest cannot exceed total payment");
      const principal = amount - interest;
      if (principal <= 0) throw new Error("Principal portion must be greater than zero");
      const payNote = note || `EMI ${money(amount)} (${money(principal)} principal, ${money(interest)} interest)`;
      await api("/api/transactions", { method: "POST", body: JSON.stringify({
        account_id: acc.id, amount: -principal, category: "mortgage-principal", note: payNote,
      }) });
      await loadServerState(); showToast("Payment saved");
      return;
    }

    if (type === "transfer") {
      const toAccountId = fd.get("toAccount");
      if (!toAccountId || toAccountId === acc.id) throw new Error("Pick a different destination account");
      const toAcc = state.accounts.find(a => a.id === toAccountId);
      const transferNote = note || `transfer ${acc.name}→${toAcc?.name || ""}`;
      await api("/api/transactions", { method: "POST", body: JSON.stringify({
        account_id: acc.id, amount: -amount, category: "transfer", note: transferNote,
      }) });
      await api("/api/transactions", { method: "POST", body: JSON.stringify({
        account_id: toAccountId, amount: amount, category: "transfer", note: transferNote,
      }) });
      await loadServerState(); showToast("Transfer saved");
      return;
    }

    const signed = type === "income" ? amount : -amount;
    const category = fd.get("category") || (type === "income" ? "income" : "expense");
    await api("/api/transactions", { method: "POST", body: JSON.stringify({
      account_id: acc.id, amount: signed, category, note,
    }) });
    await loadServerState(); showToast("Transaction saved");
  });

  const form = els.genericForm;
  const accountSelect = form.querySelector('select[name="account"]');
  const tabsEl = form.querySelector(".tx-type-tabs");
  const typeInput = form.querySelector('input[name="type"]');
  const toField = form.querySelector(".tx-to-field");
  const toSelect = toField.querySelector("select");
  const amountField = form.querySelector(".tx-amount-field");
  const amountInput = amountField.querySelector("input");
  const interestField = form.querySelector(".tx-interest-field");
  const newValueField = form.querySelector(".tx-newvalue-field");
  const newValueInput = newValueField.querySelector("input");
  const catField = form.querySelector(".tx-category-field");
  const catInput = catField.querySelector("input");

  function applyType(type) {
    typeInput.value = type;
    tabsEl.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.txType === type));
    const isTransfer = type === "transfer";
    const isPayment = type === "payment";
    const isRevalue = type === "revalue";
    toField.classList.toggle("hidden", !isTransfer);
    toSelect.required = isTransfer;
    interestField.classList.toggle("hidden", !isPayment);
    amountField.classList.toggle("hidden", isRevalue);
    amountInput.required = !isRevalue;
    newValueField.classList.toggle("hidden", !isRevalue);
    newValueInput.required = isRevalue;
    catField.classList.toggle("hidden", isTransfer || isPayment || isRevalue);
    catInput.required = !isTransfer && !isPayment && !isRevalue;
  }

  function refreshForAccount() {
    const accId = accountSelect.value;
    const acc = state.accounts.find(a => a.id === accId);
    const accType = acc?.type || "cash";
    const types = txTypesForAccount(accType);
    tabsEl.innerHTML = types
      .map((t, i) => `<button type="button" data-tx-type="${t}"${i === 0 ? ' class="active"' : ""}>${TX_TYPE_LABELS[t]}</button>`)
      .join("");
    if (acc) newValueInput.placeholder = String(acc.balance);
    applyType(types[0]);
  }

  tabsEl.addEventListener("click", e => {
    const btn = e.target.closest("[data-tx-type]");
    if (btn) applyType(btn.dataset.txType);
  });
  accountSelect.addEventListener("change", refreshForAccount);
  refreshForAccount();
}

document.querySelector("#refreshPricesButton").addEventListener("click", async () => {
  if (!state.holdings.length) return showToast("Add holdings first", "error");
  showToast("Fetching live prices...");
  const results = await Promise.allSettled(state.holdings.map(h => fetchLivePrice(h.symbol)));
  const prices = [];
  results.forEach((r, i) => { if (r.status === "fulfilled" && Number.isFinite(r.value)) prices.push({ symbol: state.holdings[i].symbol, price: r.value }); });
  if (prices.length) {
    await api("/api/prices", { method: "POST", body: JSON.stringify({ prices }) });
    await loadServerState(); showToast(`Updated ${prices.length} prices`);
  } else { showToast("Live prices unavailable", "error"); }
});

async function searchTickers(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  const data = await api(`/api/ticker-search?q=${encodeURIComponent(q)}`);
  return data.results || [];
}

function attachTickerAutocomplete(inputEl, listId) {
  const list = document.createElement("datalist");
  list.id = listId;
  inputEl.setAttribute("list", listId);
  inputEl.parentNode.insertBefore(list, inputEl.nextSibling);
  let timer = null;
  inputEl.addEventListener("input", () => {
    clearTimeout(timer);
    const q = inputEl.value;
    timer = setTimeout(async () => {
      try {
        const matches = await searchTickers(q);
        list.innerHTML = matches
          .map(m => `<option value="${escapeHtml(m.symbol)}">${escapeHtml(m.name)} · ${escapeHtml(m.exchange)} · ${escapeHtml(m.type)}</option>`)
          .join("");
      } catch {}
    }, 250);
  });
}

async function fetchLivePrice(symbol) {
  const clean = symbol.toUpperCase(), id = CRYPTO_IDS[clean];
  if (id) {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${CURRENCY.toLowerCase()}`);
    return (await res.json())[id]?.[CURRENCY.toLowerCase()];
  }
  const data = await api(`/api/price?symbol=${encodeURIComponent(clean)}`);
  const price = data.price;
  if (!Number.isFinite(price)) throw new Error("Price missing");
  return price;
}

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const m = Math.floor(seconds / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function escapeHtml(v) { return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])); }

document.querySelectorAll("[data-tab]").forEach(btn => {
  const openTab = () => {
    const t = btn.dataset.tab;
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === t));
    document.querySelectorAll(".tab").forEach(i => i.classList.toggle("active", i.dataset.tab === t));
    haptic("light");
    window.dispatchEvent(new Event('resize'));
  };
  btn.addEventListener("click", openTab);
  btn.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openTab();
  });
});

document.querySelector("#perspectiveTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-perspective]");
  if (!btn) return;
  currentPerspective = btn.dataset.perspective;
  document.querySelectorAll("#perspectiveTabs button").forEach(b => b.classList.toggle("active", b === btn));
  haptic("light");
  render();
});

document.querySelectorAll("[data-chart-range] button").forEach(btn => {
  btn.addEventListener("click", () => {
    const group = btn.closest("[data-chart-range]");
    const chart = group.dataset.chartRange;
    chartRanges[chart] = btn.dataset.range;
    group.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === btn));
    render();
  });
});

document.querySelectorAll("[data-holding-sort] button").forEach(btn => {
  btn.addEventListener("click", () => {
    holdingSort = btn.dataset.sort || "value";
    btn.closest("[data-holding-sort]").querySelectorAll("button").forEach(item => item.classList.toggle("active", item === btn));
    renderHoldings();
  });
});

window.addEventListener('resize', () => { setTimeout(render, 10); });

const settingsBackdrop = document.querySelector("#settingsBackdrop");
function openSettings() {
  settingsBackdrop.classList.add("active");
  pushOverlay(() => settingsBackdrop.classList.remove("active"));
}
function closeSettings() { dismissTopOverlay(); }
document.querySelector("#settingsBtn").addEventListener("click", openSettings);
document.querySelector("#settingsCloseBtn").addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", e => { if (e.target === settingsBackdrop) closeSettings(); });

document.querySelector("#themeSegmented").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-theme-value]");
  if (!btn) return;
  setThemePref(btn.dataset.themeValue);
  haptic("light");
});
applyTheme(getThemePref());

// Compact top bar that fades in on scroll
(function enableCompactTopBar() {
  const bar = document.createElement("div");
  bar.className = "top-bar";
  bar.innerHTML = `<span class="top-bar-title"></span>`;
  document.body.appendChild(bar);
  const title = bar.querySelector(".top-bar-title");
  function update() {
    const visible = window.scrollY > 96;
    bar.classList.toggle("visible", visible);
    if (visible) {
      const h1 = document.querySelector(".view.active .view-header h1");
      if (h1) title.textContent = h1.textContent;
    }
  }
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
})();

document.querySelector("#lockButton").addEventListener("click", async () => {
  closeSettings();
  await api("/api/logout", { method: "POST" }).catch(() => {});
  isAuthenticated = false; showLock();
});

document.querySelector("#pinForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ username: document.querySelector("#usernameInput").value, password: document.querySelector("#pinInput").value }) });
    isAuthenticated = true; els.lockScreen.classList.remove("active");
    await loadServerState();
  } catch {
    document.querySelector("#pinInput").value = ""; document.querySelector("#pinInput").placeholder = "Try again";
  }
});

function showLock() { if (!isAuthenticated) els.lockScreen.classList.add("active"); }

document.querySelector("#currencySelector").value = CURRENCY;
document.querySelector("#currencySelector").addEventListener("change", (e) => {
  localStorage.setItem("balance-currency", e.target.value);
  window.location.reload();
});

async function boot() {
  try {
    await api("/api/me");
    isAuthenticated = true; els.lockScreen.classList.remove("active");
    await loadServerState();
  } catch { showLock(); render(); }
}
boot();

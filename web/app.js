const STORAGE_KEY = "deepak.balance-tracker.snapshots.v1";
const API_BASE = localStorage.getItem("balance-api-base") || (location.hostname === "localhost" ? "http://localhost:8787" : "");
const CURRENCY = localStorage.getItem("balance-currency") || "EUR";
const CRYPTO_IDS = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", ADA: "cardano",
  XRP: "ripple", DOGE: "dogecoin", AVAX: "avalanche-2", DOT: "polkadot",
  MATIC: "matic-network", LINK: "chainlink"
};

const seedState = {
  accounts: [], transactions: [], holdings: [],
  chats: [{ id: crypto.randomUUID(), role: "agent", text: "Ready. Try: added 1500 to account1, withdraw 200 from account2 for renovation, or bought 2 AAPL at 170 now 190.", createdAt: new Date().toISOString() }],
  snapshots: []
};

let state = loadState();
let isAuthenticated = false;

const els = {
  globalLoader: document.querySelector("#globalLoader"),
  toastContainer: document.querySelector("#toastContainer"),
  netWorth: document.querySelector("#netWorth"),
  netWorthDelta: document.querySelector("#netWorthDelta"),
  cashTotal: document.querySelector("#cashTotal"),
  portfolioTotal: document.querySelector("#portfolioTotal"),
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
  
  // detail views
  accountDetailView: document.querySelector("#accountDetailView"),
  holdingDetailView: document.querySelector("#holdingDetailView"),
  
  // modals
  modalBackdrop: document.querySelector("#modalBackdrop"),
  modalTitle: document.querySelector("#modalTitle"),
  modalFormFields: document.querySelector("#modalFormFields"),
  genericForm: document.querySelector("#genericForm"),
  modalDeleteBtn: document.querySelector("#modalDeleteBtn")
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
    const data = await response.json();
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
  const [accounts, transactions, holdings, chats, analysis] = await Promise.all([
    api("/api/accounts"), api("/api/transactions"), api("/api/holdings"), api("/api/chat"), api("/api/analysis")
  ]);
  state.accounts = accounts.map(a => ({ id: a.id, name: a.name, balance: Number(a.balance || 0), createdAt: a.created_at }));
  state.transactions = transactions.map(tx => ({
    id: tx.id, accountId: tx.account_id, accountName: tx.account_name,
    amount: Number(tx.amount || 0), category: tx.category, note: tx.note, createdAt: tx.created_at
  })).reverse();
  state.holdings = holdings.map(h => ({
    id: h.id, symbol: h.symbol, quantity: Number(h.quantity || 0), cost: Number(h.cost || 0),
    price: Number(h.price || 0), lastPriceAt: h.last_price_at, createdAt: h.created_at
  }));
  state.chats = chats.length ? chats.map(c => ({ 
    id: c.id, role: c.role, text: c.text, createdAt: c.created_at, 
    action_id: c.action_id, action_status: c.action_status 
  })) : seedState.chats;
  state.analysis = analysis;
  render();
}

function money(value) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency", currency: CURRENCY,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2
  }).format(value || 0);
}

function totalCash() { return state.accounts.reduce((sum, acc) => sum + acc.balance, 0); }
function portfolioValue() { return state.holdings.reduce((sum, h) => sum + h.quantity * h.price, 0); }
function portfolioCost() { return state.holdings.reduce((sum, h) => sum + h.quantity * h.cost, 0); }
function portfolioPnl() { return portfolioValue() - portfolioCost(); }
function portfolioPnlPercent() { const cost = portfolioCost(); return cost ? (portfolioPnl() / cost) * 100 : 0; }
function netWorth() { return totalCash() + portfolioValue(); }

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
  const cash = totalCash(), portfolio = portfolioValue(), worth = cash + portfolio;
  const previous = state.snapshots.length > 1 ? state.snapshots[state.snapshots.length - 2].value : worth;
  const delta = worth - previous;

  els.netWorth.textContent = money(worth);
  els.cashTotal.textContent = money(cash);
  els.portfolioTotal.textContent = money(portfolio);
  els.netWorthDelta.textContent = delta === 0 ? "No movement yet" : `${delta > 0 ? "+" : ""}${money(delta)} since last snapshot`;
  els.netWorthDelta.className = delta >= 0 ? "positive" : "negative";

  renderPortfolioSummary();
  renderAccounts();
  renderHoldings();
  renderActivity();
  renderBars();
  renderInsights();
  renderChat();
  renderLineChart(els.chart, 200);
  renderLineChart(els.analysisChart, 160);
}

function renderPortfolioSummary() {
  const value = portfolioValue(), cost = portfolioCost(), pnl = portfolioPnl(), pnlPercent = portfolioPnlPercent();
  els.portfolioLiveValue.textContent = money(value);
  els.portfolioLivePnl.textContent = `${pnl >= 0 ? "+" : ""}${money(pnl)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`;
  els.portfolioLivePnl.className = pnl >= 0 ? "positive" : "negative";
  const lastUpdate = state.holdings.map(h => h.lastPriceAt).filter(Boolean).sort().at(-1);
  els.priceStatus.textContent = lastUpdate ? `Updated ${timeAgo(lastUpdate)}` : "Manual prices";

  const best = state.holdings.map(h => ({ symbol: h.symbol, pnl: (h.price - h.cost) * h.quantity })).sort((a, b) => b.pnl - a.pnl)[0];
  els.portfolioKpis.innerHTML = `
    <article class="kpi-pill"><span>Invested</span><strong>${money(cost)}</strong></article>
    <article class="kpi-pill"><span>Return</span><strong class="${pnl >= 0 ? 'positive' : 'negative'}">${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%</strong></article>
    <article class="kpi-pill"><span>Best</span><strong class="${best?.pnl >= 0 ? 'positive' : 'negative'}">${best ? best.symbol : "--"}</strong></article>
  `;

  if (!state.holdings.length) {
    els.portfolioXrayLabel.textContent = "Asset mix";
    els.portfolioXray.innerHTML = `<p class="muted" style="margin-top: 10px;">Add holdings to see exposure.</p>`;
    return;
  }
  const mix = state.holdings.reduce((map, h) => {
    const bucket = CRYPTO_IDS[h.symbol] ? "Crypto" : "Stocks / ETFs";
    map[bucket] = (map[bucket] || 0) + h.quantity * h.price;
    return map;
  }, {});
  const total = Math.max(Object.values(mix).reduce((sum, v) => sum + v, 0), 1);
  els.portfolioXrayLabel.textContent = `${Object.keys(mix).length} class${Object.keys(mix).length === 1 ? "" : "es"}`;
  els.portfolioXray.innerHTML = Object.entries(mix)
    .sort((a, b) => b[1] - a[1])
    .map(([name, val]) => barRow(name, `${money(val)} · ${Math.round((val / total) * 100)}%`, val / total))
    .join("");
}

function renderAccounts() {
  if (!state.accounts.length) {
    els.accountList.innerHTML = `<div class="empty-state"><svg><use href="#icon-wallet"></use></svg><h3>No Accounts Yet</h3><p>Add an account to get started.</p></div>`;
    return;
  }
  els.accountList.innerHTML = state.accounts.map(acc => {
    const count = state.transactions.filter(tx => tx.accountId === acc.id).length;
    return `
      <article class="account-card" data-id="${acc.id}">
        <div class="account-top">
          <strong>${escapeHtml(acc.name)}</strong>
          <strong>${money(acc.balance)}</strong>
        </div>
        <small>${count} transaction${count === 1 ? "" : "s"}</small>
        <div class="card-actions">
          <button class="action-btn edit-account" data-id="${acc.id}" title="Edit">✎</button>
        </div>
      </article>`;
  }).join("");
  bindCardActions(els.accountList, openAccountDetail, openEditAccount);
}

function renderHoldings() {
  if (!state.holdings.length) {
    els.holdingList.innerHTML = `<div class="empty-state"><svg><use href="#icon-portfolio"></use></svg><h3>No Holdings</h3><p>Add assets or say "bought 2 AAPL".</p></div>`;
    return;
  }
  els.holdingList.innerHTML = state.holdings.map(h => {
    const value = h.quantity * h.price, pnl = value - (h.quantity * h.cost);
    const pnlPercent = h.cost ? (pnl / (h.quantity * h.cost)) * 100 : 0;
    return `
      <article class="holding-card" data-id="${h.id}">
        <div class="holding-top">
          <strong>${escapeHtml(h.symbol)}</strong>
          <strong>${money(value)}</strong>
        </div>
        <div class="holding-meta">
          <small>${h.quantity} units at ${money(h.price)}</small>
          <small class="${pnl >= 0 ? "positive" : "negative"}">${pnl >= 0 ? "+" : ""}${money(pnl)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)</small>
        </div>
        <div class="card-actions">
          <button class="action-btn edit-holding" data-id="${h.id}" title="Edit">✎</button>
        </div>
      </article>`;
  }).join("");
  bindCardActions(els.holdingList, openHoldingDetail, openEditHolding);
}

function renderActivity() {
  const rows = state.transactions.slice(-6).reverse();
  if (!rows.length) {
    els.activityList.innerHTML = `<div class="empty-state"><h3>No Activity</h3><p>Your recent transactions will appear here.</p></div>`;
    return;
  }
  els.activityList.innerHTML = rows.map(tx => `
    <div class="activity-item">
      <div class="activity-line">
        <strong>${escapeHtml(tx.note || tx.category)}</strong>
        <strong class="${tx.amount >= 0 ? "positive" : "negative"}">${money(tx.amount)}</strong>
      </div>
      <div class="activity-line" style="margin-top: 4px;">
        <small class="muted">${escapeHtml(tx.accountName || "Unknown")} · ${new Date(tx.createdAt).toLocaleDateString()}</small>
        <button class="action-btn edit-tx" data-id="${tx.id}" style="border:0; background:transparent;">✎</button>
      </div>
    </div>
  `).join("");
  bindCardActions(els.activityList, null, openEditTx);
}

function renderBars() {
  const cash = Math.max(Math.abs(totalCash()), 1);
  els.accountSplitLabel.textContent = `${state.accounts.length} account${state.accounts.length === 1 ? "" : "s"}`;
  els.accountBars.innerHTML = state.accounts.length
    ? state.accounts.map(acc => barRow(acc.name, money(acc.balance), Math.abs(acc.balance) / cash)).join("")
    : `<p class="muted">No account balances yet.</p>`;

  const month = new Date().toISOString().slice(0, 7);
  const categories = state.transactions.filter(tx => tx.createdAt.startsWith(month) && tx.amount < 0).reduce((map, tx) => {
    map[tx.category] = (map[tx.category] || 0) + Math.abs(tx.amount);
    return map;
  }, {});
  const max = Math.max(...Object.values(categories), 1);
  els.categoryBars.innerHTML = Object.keys(categories).length
    ? Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([name, val]) => barRow(name, money(val), val / max)).join("")
    : `<p class="muted">Spending categories appear after withdrawals.</p>`;
}

function renderInsights() {
  const month = new Date().toISOString().slice(0, 7);
  const monthlyTx = state.transactions.filter(tx => tx.createdAt.startsWith(month));
  const inflow = monthlyTx.filter(tx => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const outflow = monthlyTx.filter(tx => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const saved = inflow - outflow;
  const savingsRate = inflow > 0 ? Math.round((saved / inflow) * 100) : 0;
  const runway = outflow > 0 ? totalCash() / outflow : null;

  els.monthlyInflow.textContent = money(inflow);
  els.monthlyOutflow.textContent = money(outflow);
  els.savingsRate.textContent = `${savingsRate}%`;
  els.savingsRate.className = savingsRate >= 0 ? "positive" : "negative";
  els.runwayMonths.textContent = runway === null ? "--" : `${Math.max(runway, 0).toFixed(1)} mo`;

  const signals = [];
  if (inflow || outflow) signals.push({ type: "Cash flow", title: savingsRate >= 0 ? `Kept ${savingsRate}% of inflow` : `Outflows exceed inflow`, detail: `${money(inflow)} in, ${money(outflow)} out.` });
  signals.push({ type: "Allocation", title: netWorth() > 0 ? `${Math.round((portfolioValue() / netWorth()) * 100)}% invested` : "Waiting for balances", detail: "Check balance between cash and assets." });
  
  els.signalCount.textContent = `${signals.length} active`;
  els.signalList.innerHTML = signals.map(s => `
    <article class="signal-card">
      <span>${escapeHtml(s.type)}</span>
      <strong>${escapeHtml(s.title)}</strong>
      <small class="muted">${escapeHtml(s.detail)}</small>
    </article>
  `).join("");
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
          <button class="action-btn confirm-btn" style="border:1px solid var(--success); color:var(--success);">Confirm</button>
          <button class="action-btn cancel-btn" style="border:1px solid var(--error); color:var(--error);">Cancel</button>
        </div>`;
    }
    return html;
  }).join("");
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function renderLineChart(target, height) {
  const width = target.clientWidth || 640;
  target.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (width === 0) return; // Hidden
  const points = state.snapshots.length ? state.snapshots : [{ date: "now", value: netWorth() }];
  if (points.length < 2) {
    target.innerHTML = `<line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4,4" />`;
    return;
  }
  const values = points.map(p => p.value), min = Math.min(...values, 0), max = Math.max(...values, 1), span = max - min || 1;
  const coords = points.map((p, i) => `${(i / (points.length - 1)) * width},${height - ((p.value - min) / span) * (height - 24) - 12}`);
  target.innerHTML = `
    <defs><linearGradient id="g${target.id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#10b981"/><stop offset="100%" stop-color="#059669"/></linearGradient></defs>
    <polyline points="${coords.join(" ")}" fill="none" stroke="url(#g${target.id})" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  `;
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
// Modals & Editing
// ----------------------------------------
let currentModalAction = null;

function openModal(title, fieldsHtml, onSave, onDelete) {
  els.modalTitle.textContent = title;
  els.modalFormFields.innerHTML = fieldsHtml;
  els.modalDeleteBtn.style.display = onDelete ? "block" : "none";
  currentModalAction = { onSave, onDelete };
  els.modalBackdrop.classList.add("active");
}

function closeModal() {
  els.modalBackdrop.classList.remove("active");
  currentModalAction = null;
  els.genericForm.reset();
}

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
    <input name="name" value="${escapeHtml(acc.name)}" placeholder="Name" required />
    <input name="balance" type="number" inputmode="decimal" step="0.01" value="${acc.balance}" placeholder="Balance" required />
  `, async fd => {
    await api(`/api/accounts/${id}`, { method: "PUT", body: JSON.stringify({ name: fd.get("name"), balance: fd.get("balance") }) });
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
    <input name="account" value="${escapeHtml(tx.accountName)}" required />
    <input name="amount" type="number" inputmode="decimal" step="0.01" value="${tx.amount}" required />
    <input name="category" value="${escapeHtml(tx.category)}" required />
    <input name="note" value="${escapeHtml(tx.note)}" required />
  `, async fd => {
    await api(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(Object.fromEntries(fd)) });
    await loadServerState(); showToast("Transaction updated");
  }, async () => {
    await api(`/api/transactions/${id}`, { method: "DELETE" });
    await loadServerState(); showToast("Transaction deleted");
  });
}

function bindCardActions(rootEl, openDetail, openEdit) {
  rootEl.querySelectorAll(".edit-account, .edit-holding, .edit-tx").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      openEdit(Number(btn.dataset.id));
    });
  });
  if (openDetail) {
    rootEl.querySelectorAll(".account-card, .holding-card").forEach(card => {
      card.addEventListener("click", e => {
        if (e.target.closest(".action-btn")) return;
        openDetail(Number(card.dataset.id));
      });
    });
  }
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

  document.querySelector("#accountDetailTxList").innerHTML = txs.length ? txs.map(tx => `
    <div class="activity-item">
      <div class="activity-line">
        <strong>${escapeHtml(tx.note || tx.category)}</strong>
        <strong class="${tx.amount >= 0 ? 'positive' : 'negative'}">${money(tx.amount)}</strong>
      </div>
      <small class="muted">${new Date(tx.createdAt).toLocaleDateString()}</small>
    </div>
  `).join("") : `<p class="muted">No transactions found.</p>`;
  els.accountDetailView.classList.add("active");
}

function openHoldingDetail(id) {
  const h = state.holdings.find(x => x.id === id);
  if (!h) return;
  document.querySelector("#holdingDetailTitle").textContent = h.symbol;
  document.querySelector("#holdingDetailValue").textContent = money(h.quantity * h.price);
  const pnl = (h.quantity * h.price) - (h.quantity * h.cost);
  document.querySelector("#holdingDetailPnl").textContent = `${pnl >= 0 ? '+' : ''}${money(pnl)}`;
  document.querySelector("#holdingDetailPnl").className = pnl >= 0 ? "positive" : "negative";
  document.querySelector("#holdingDetailQty").textContent = h.quantity;
  document.querySelector("#holdingDetailPrice").textContent = money(h.price);
  document.querySelector("#holdingDetailCost").textContent = money(h.cost);
  document.querySelector("#holdingDetailPriceDate").textContent = h.lastPriceAt ? `Updated ${new Date(h.lastPriceAt).toLocaleString()}` : "Manual";
  
  els.holdingDetailView.dataset.id = id;
  els.holdingDetailView.classList.add("active");
}

document.querySelector("#closeAccountDetail").addEventListener("click", () => els.accountDetailView.classList.remove("active"));
document.querySelector("#closeHoldingDetail").addEventListener("click", () => els.holdingDetailView.classList.remove("active"));

document.querySelector("#updatePriceForm").addEventListener("submit", async e => {
  e.preventDefault();
  const id = Number(els.holdingDetailView.dataset.id);
  const h = state.holdings.find(x => x.id === id);
  const newPrice = Number(document.querySelector("#newPriceInput").value);
  if (h && newPrice) {
    await api(`/api/prices`, { method: "POST", body: JSON.stringify({ prices: [{ symbol: h.symbol, price: newPrice }] }) });
    showToast("Price updated");
    await loadServerState();
    openHoldingDetail(id); // Re-render
    document.querySelector("#newPriceInput").value = "";
  }
});

// Original Add Forms
document.querySelector("#addAccountButton").addEventListener("click", () => {
  openModal("New Account", `
    <input name="name" placeholder="Account name" required />
    <input name="balance" type="number" inputmode="decimal" step="0.01" placeholder="Opening balance" required />
  `, async fd => {
    await api("/api/accounts", { method: "POST", body: JSON.stringify({ name: fd.get("name"), balance: fd.get("balance") }) });
    await loadServerState(); showToast("Account created");
  });
});

document.querySelector("#addHoldingButton").addEventListener("click", () => {
  openModal("New Holding", `
    <input name="symbol" placeholder="Start typing — VWCE, AAPL, BTC..." autocomplete="off" required />
    <input name="quantity" type="number" inputmode="decimal" step="0.000001" placeholder="Quantity" required />
    <input name="cost" type="number" inputmode="decimal" step="0.01" placeholder="Purchase price per unit" required />
    <small class="muted">Pick from the dropdown to ensure the right exchange (e.g. VWCE.DE for Xetra).</small>
  `, async fd => {
    const symbol = String(fd.get("symbol")).toUpperCase().trim();
    const cost = Number(fd.get("cost"));
    let price;
    try {
      price = await fetchLivePrice(symbol);
    } catch {
      throw new Error(`Ticker "${symbol}" not found. For non-US ETFs add the exchange suffix (e.g. VWCE.DE).`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Ticker "${symbol}" returned no price. Double-check the symbol.`);
    }
    await api("/api/holdings", {
      method: "POST",
      body: JSON.stringify({ symbol, quantity: fd.get("quantity"), cost, price })
    });
    await loadServerState();
    showToast(`Holding ${symbol} added at live ${money(price)}`);
  });
  const symbolInput = els.modalFormFields.querySelector('input[name="symbol"]');
  if (symbolInput) attachTickerAutocomplete(symbolInput, "symbolSuggestions");
});

document.querySelector("#addTxBtn").addEventListener("click", () => {
  openModal("Manual Transaction", `
    <input name="account" placeholder="Account Name" required />
    <input name="amount" type="number" inputmode="decimal" step="0.01" placeholder="Amount (negative for outflow)" required />
    <input name="category" placeholder="Category" required />
    <input name="note" placeholder="Note" required />
  `, async fd => {
    await api("/api/transactions", { method: "POST", body: JSON.stringify(Object.fromEntries(fd)) });
    await loadServerState(); showToast("Transaction saved");
  });
});

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
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?range=1d&interval=1m`);
  const data = await res.json();
  const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
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
  btn.addEventListener("click", () => {
    const t = btn.dataset.tab;
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === t));
    document.querySelectorAll(".tab").forEach(i => i.classList.toggle("active", i.dataset.tab === t));
    window.dispatchEvent(new Event('resize')); 
  });
});

window.addEventListener('resize', () => { setTimeout(render, 10); });

const settingsBackdrop = document.querySelector("#settingsBackdrop");
function openSettings() { settingsBackdrop.classList.add("active"); }
function closeSettings() { settingsBackdrop.classList.remove("active"); }
document.querySelector("#settingsBtn").addEventListener("click", openSettings);
document.querySelector("#settingsCloseBtn").addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", e => { if (e.target === settingsBackdrop) closeSettings(); });

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

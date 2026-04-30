#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import uuid
import datetime
from urllib.parse import urlparse
import urllib.request
import urllib.error
import decimal

ROOT = Path(__file__).resolve().parents[1]

# Zero-dependency .env parser
env_file = ROOT / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                # Remove inline comments and wrapping quotes
                val = val.split(" #")[0].strip().strip('"').strip("'")
                os.environ.setdefault(key, val)

ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")
DB_URL = os.environ.get("DATABASE_URL", "postgresql://deepak:mysecretpassword@localhost:5432/balance_db")
HOST = os.environ.get("BALANCE_HOST", "127.0.0.1")
PORT = int(os.environ.get("BALANCE_PORT", "8787"))
APP_USER = os.environ.get("BALANCE_USER", "deepak")
APP_PASSWORD = os.environ.get("BALANCE_PASSWORD", "change-me")
SESSION_SECRET = os.environ.get("BALANCE_SESSION_SECRET", "dev-secret-change-me").encode()
SESSION_TTL = 60 * 60 * 24 * 14
ALLOWED_ORIGIN = os.environ.get("BALANCE_ALLOWED_ORIGIN", "http://localhost:4173")

# Extreme rate limit logic
FAILED_LOGINS = {}

@contextmanager
def db_cursor():
    conn = psycopg2.connect(DB_URL, cursor_factory=psycopg2.extras.DictCursor)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            yield cur
    finally:
        conn.close()


def init_db():
    try:
        with db_cursor() as cur:
            cur.execute("SELECT id FROM users WHERE username = %s", (APP_USER,))
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO users (username, password_hash) VALUES (%s, %s)",
                    (APP_USER, hash_password(APP_PASSWORD)),
                )
            cur.execute("SELECT id FROM accounts LIMIT 1")
            if not cur.fetchone():
                cur.execute("INSERT INTO accounts (name, balance) VALUES (%s, %s), (%s, %s)", 
                           ("account1", 0, "account2", 0))
    except psycopg2.errors.UndefinedTable:
        print("Database not migrated yet. Please run python3 api/migrate.py first.")


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260000)
    return f"{base64.b64encode(salt).decode()}:{base64.b64encode(digest).decode()}"


def verify_password(password, stored):
    try:
        salt_text, digest_text = stored.split(":", 1)
        salt = base64.b64decode(salt_text)
        digest = base64.b64decode(digest_text)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260000)
    return hmac.compare_digest(candidate, digest)


def sign_session(username):
    expires = int(time.time()) + SESSION_TTL
    payload = f"{username}:{expires}"
    sig = hmac.new(SESSION_SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()


def verify_session(token):
    if not token:
        return None
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        username, expires_text, sig = raw.rsplit(":", 2)
        payload = f"{username}:{expires_text}"
        expected = hmac.new(SESSION_SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        if int(expires_text) < int(time.time()):
            return None
        return username
    except Exception:
        return None


def rows_to_dicts(rows):
    res = []
    for row in rows:
        d = dict(row)
        for k, v in d.items():
            if isinstance(v, uuid.UUID):
                d[k] = str(v)
            if isinstance(v, datetime.datetime):
                d[k] = str(v)
            if isinstance(v, decimal.Decimal):
                d[k] = float(v)
        res.append(d)
    return res


def money(value):
    return f"EUR {value:,.2f}"


def category_for(note, is_out):
    if not is_out:
        return "income"
    if re.search(r"renovation|repair|paint|home|house", note):
        return "home"
    if re.search(r"food|restaurant|grocery", note):
        return "food"
    if re.search(r"travel|flight|hotel|taxi", note):
        return "travel"
    return "spending"


def find_or_create_account(cur, name):
    clean = re.sub(r"\s+", " ", name).strip()
    cur.execute("SELECT * FROM accounts WHERE lower(name) = lower(%s)", (clean,))
    row = cur.fetchone()
    if row:
        return dict(row)
    cur.execute("INSERT INTO accounts (name, balance) VALUES (%s, 0) RETURNING *", (clean,))
    return dict(cur.fetchone())


def upsert_holding(cur, symbol, quantity, cost, price):
    cur.execute("SELECT * FROM holdings WHERE symbol = %s", (symbol,))
    existing = cur.fetchone()
    if existing:
        is_deleted = existing.get("deleted_at") is not None
        existing_qty = 0.0 if is_deleted else float(existing["quantity"])
        existing_cost = 0.0 if is_deleted else float(existing["cost"])
        if quantity > 0:
            total_qty = existing_qty + quantity
            avg_cost = ((existing_qty * existing_cost) + (quantity * cost)) / total_qty if total_qty > 0 else cost
        else:
            total_qty = existing_qty
            avg_cost = existing_cost
        new_price = price if price > 0 else float(existing["price"])
        cur.execute(
            "UPDATE holdings SET quantity = %s, cost = %s, price = %s, last_price_at = CURRENT_TIMESTAMP, deleted_at = NULL WHERE id = %s",
            (total_qty, avg_cost, new_price, existing["id"]),
        )
    else:
        cur.execute(
            "INSERT INTO holdings (symbol, quantity, cost, price) VALUES (%s, %s, %s, %s)",
            (symbol, quantity, cost, price),
        )


def find_account(cur, name):
    if not name:
        return None
    clean = re.sub(r"\s+", " ", str(name)).strip()
    cur.execute("SELECT * FROM accounts WHERE lower(name) = lower(%s) AND deleted_at IS NULL", (clean,))
    row = cur.fetchone()
    return dict(row) if row else None


def resolve_insight(cur, topic, period_days):
    days = max(1, int(period_days or 30))
    if topic == "net_worth":
        t = get_totals(cur)
        return f"Net worth: {money(t['net_worth'])} (cash {money(t['cash'])} + portfolio {money(t['portfolio'])}). Unrealised PnL {money(t['pnl'])}."
    if topic == "spending_trend":
        cur.execute(
            "SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) v "
            "FROM transactions WHERE deleted_at IS NULL AND created_at > CURRENT_DATE - (%s || ' days')::interval",
            (days,)
        )
        cur_out = float(cur.fetchone()["v"])
        cur.execute(
            "SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) v "
            "FROM transactions WHERE deleted_at IS NULL "
            "AND created_at > CURRENT_DATE - (%s || ' days')::interval "
            "AND created_at <= CURRENT_DATE - (%s || ' days')::interval",
            (days * 2, days)
        )
        prev_out = float(cur.fetchone()["v"])
        delta = cur_out - prev_out
        pct = (delta / prev_out * 100) if prev_out > 0 else 0
        direction = "up" if delta > 0 else "down" if delta < 0 else "flat"
        return f"Spending last {days}d: {money(cur_out)} ({direction} {abs(pct):.1f}% vs prior {days}d which was {money(prev_out)})."
    if topic == "top_categories":
        cur.execute(
            "SELECT category, SUM(-amount) total FROM transactions "
            "WHERE deleted_at IS NULL AND amount < 0 AND created_at > CURRENT_DATE - (%s || ' days')::interval "
            "GROUP BY category ORDER BY total DESC LIMIT 5",
            (days,)
        )
        rows = cur.fetchall()
        if not rows:
            return f"No outflows in the last {days} days."
        items = ", ".join(f"{r['category']} {money(float(r['total']))}" for r in rows)
        return f"Top categories last {days}d: {items}."
    if topic == "savings_rate":
        cur.execute(
            "SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) inflow, "
            "COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) outflow "
            "FROM transactions WHERE deleted_at IS NULL AND created_at > CURRENT_DATE - (%s || ' days')::interval",
            (days,)
        )
        r = cur.fetchone()
        inflow, outflow = float(r["inflow"]), float(r["outflow"])
        rate = ((inflow - outflow) / inflow * 100) if inflow > 0 else 0
        return f"Savings rate last {days}d: {rate:.1f}% (in {money(inflow)}, out {money(outflow)})."
    if topic == "runway":
        cur.execute(
            "SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) v "
            "FROM transactions WHERE deleted_at IS NULL AND created_at > CURRENT_DATE - (%s || ' days')::interval",
            (days,)
        )
        outflow = float(cur.fetchone()["v"])
        monthly_burn = (outflow / days) * 30 if days > 0 else 0
        cur.execute("SELECT COALESCE(SUM(balance), 0) v FROM accounts WHERE deleted_at IS NULL")
        cash = float(cur.fetchone()["v"])
        if monthly_burn <= 0:
            return f"No outflow in the last {days}d — runway is effectively unlimited at current cash {money(cash)}."
        return f"Runway: {cash / monthly_burn:.1f} months at {money(monthly_burn)}/mo burn (cash {money(cash)})."
    if topic == "portfolio_pnl":
        t = get_totals(cur)
        pct = (t["pnl"] / t["cost"] * 100) if t["cost"] > 0 else 0
        return f"Portfolio: value {money(t['portfolio'])}, cost {money(t['cost'])}, unrealised PnL {money(t['pnl'])} ({pct:+.2f}%)."
    if topic == "biggest_transactions":
        cur.execute(
            "SELECT t.amount, t.note, t.category, a.name account_name FROM transactions t "
            "JOIN accounts a ON a.id = t.account_id "
            "WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL "
            "AND t.created_at > CURRENT_DATE - (%s || ' days')::interval "
            "ORDER BY ABS(t.amount) DESC LIMIT 5",
            (days,)
        )
        rows = cur.fetchall()
        if not rows:
            return f"No transactions in the last {days} days."
        items = "; ".join(f"{money(float(r['amount']))} {r['category']} ({r['account_name']})" for r in rows)
        return f"Biggest transactions last {days}d: {items}."
    if topic == "account_breakdown":
        cur.execute("SELECT name, balance FROM accounts WHERE deleted_at IS NULL ORDER BY balance DESC")
        rows = cur.fetchall()
        if not rows:
            return "No accounts yet."
        items = ", ".join(f"{r['name']} {money(float(r['balance']))}" for r in rows)
        return f"Accounts: {items}."
    if topic == "asset_allocation":
        cur.execute("SELECT symbol, quantity * price value FROM holdings WHERE deleted_at IS NULL")
        rows = cur.fetchall()
        total = sum(float(r["value"]) for r in rows)
        if total <= 0:
            return "No portfolio holdings yet."
        rows = sorted(rows, key=lambda r: float(r["value"]), reverse=True)
        items = ", ".join(f"{r['symbol']} {float(r['value']) / total * 100:.1f}%" for r in rows[:6])
        return f"Allocation (of {money(total)}): {items}."
    if topic == "recent_activity":
        n = min(max(1, days), 10) if days <= 10 else 7
        cur.execute(
            "SELECT t.amount, t.note, a.name account_name, t.created_at FROM transactions t "
            "JOIN accounts a ON a.id = t.account_id "
            "WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL "
            "ORDER BY t.created_at DESC LIMIT %s",
            (n,)
        )
        rows = cur.fetchall()
        if not rows:
            return "No recent transactions."
        items = "; ".join(f"{money(float(r['amount']))} {r['note'] or ''} ({r['account_name']})" for r in rows)
        return f"Last {n} transactions: {items}."
    return None


def handle_chat_command(text):
    with db_cursor() as cur:
        cur.execute("INSERT INTO chat_messages (role, text) VALUES (%s, %s)", ("user", text))
    
    try:
        req = urllib.request.Request("http://127.0.0.1:3001/chat", data=json.dumps({"message": text}).encode(), headers={'Content-Type': 'application/json'})
        response = urllib.request.urlopen(req, timeout=3)
        agent_resp = json.loads(response.read().decode())
    except Exception:
        agent_resp = mock_openclaw_response(text)
        
    action = agent_resp.get("action", "query")
    requires_confirmation = agent_resp.get("requires_confirmation", False)
    payload = json.dumps(agent_resp)

    with db_cursor() as cur:
        cur.execute("INSERT INTO agent_actions (action_type, payload_json, status) VALUES (%s, %s, %s) RETURNING id",
                              (action, payload, "pending" if requires_confirmation else "executed"))
        action_id = cur.fetchone()["id"]

        reply_text = agent_resp.get("replyText", "")
        if requires_confirmation:
            if not reply_text:
                reply_text = f"Do you confirm this {action}?"
        else:
            executed_reply = execute_agent_action(cur, action, agent_resp)
            if executed_reply:
                reply_text = executed_reply
            elif not reply_text:
                reply_text = f"Action {action} completed."
            action_id = None

        cur.execute("INSERT INTO chat_messages (role, text, action_id) VALUES (%s, %s, %s)", ("agent", reply_text, action_id))
        return {"reply": reply_text, "requires_confirmation": requires_confirmation, "action_id": action_id}

def execute_agent_action(cur, action, payload):
    if action == "create_transaction":
        account = find_or_create_account(cur, payload.get("account", "account1"))
        amount = float(payload.get("amount", 0))
        is_out = payload.get("type", "withdrawal") == "withdrawal"
        signed_amount = -amount if is_out else amount
        cur.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (signed_amount, account["id"]))
        cur.execute(
            "INSERT INTO transactions (account_id, amount, category, note) VALUES (%s, %s, %s, %s)",
            (account["id"], signed_amount, payload.get("category", "manual"), payload.get("note", ""))
        )
        return None
    if action == "update_holding":
        upsert_holding(cur, payload.get("symbol", "").upper(), float(payload.get("quantity", 0)), float(payload.get("cost", 0)), float(payload.get("price", 0)))
        return None
    if action == "create_account":
        name = str(payload.get("name", "")).strip()
        if not name:
            return "Cannot create an account without a name."
        opening = float(payload.get("opening_balance", 0) or 0)
        cur.execute(
            "INSERT INTO accounts (name, balance) VALUES (%s, %s) ON CONFLICT (name) DO UPDATE SET deleted_at = NULL, balance = EXCLUDED.balance",
            (name, opening),
        )
        return f"Account '{name}' ready with opening balance {money(opening)}."
    if action == "rename_account":
        old = find_account(cur, payload.get("old_name"))
        new_name = str(payload.get("new_name", "")).strip()
        if not old or not new_name:
            return "Could not rename — account not found or new name empty."
        cur.execute("UPDATE accounts SET name = %s WHERE id = %s", (new_name, old["id"]))
        return f"Renamed '{old['name']}' to '{new_name}'."
    if action == "delete_account":
        acc = find_account(cur, payload.get("name"))
        if not acc:
            return "Account not found."
        cur.execute("UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = %s", (acc["id"],))
        return f"Closed account '{acc['name']}'."
    if action == "transfer":
        src = find_account(cur, payload.get("from_account"))
        dst = find_account(cur, payload.get("to_account"))
        amount = float(payload.get("amount", 0) or 0)
        if not src or not dst or amount <= 0:
            return "Transfer skipped — accounts or amount missing."
        if src["id"] == dst["id"]:
            return "Source and destination accounts are the same."
        note = payload.get("note") or f"transfer {src['name']}→{dst['name']}"
        cur.execute("UPDATE accounts SET balance = balance - %s WHERE id = %s", (amount, src["id"]))
        cur.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (amount, dst["id"]))
        cur.execute("INSERT INTO transactions (account_id, amount, category, note) VALUES (%s, %s, %s, %s)",
                    (src["id"], -amount, "transfer", note))
        cur.execute("INSERT INTO transactions (account_id, amount, category, note) VALUES (%s, %s, %s, %s)",
                    (dst["id"], amount, "transfer", note))
        return f"Transferred {money(amount)} from '{src['name']}' to '{dst['name']}'."
    if action == "sell_holding":
        symbol = str(payload.get("symbol", "")).upper().strip()
        qty = float(payload.get("quantity", 0) or 0)
        cur.execute("SELECT * FROM holdings WHERE symbol = %s AND deleted_at IS NULL", (symbol,))
        existing = cur.fetchone()
        if not existing or qty <= 0:
            return f"Cannot sell — holding {symbol or '?'} not found or quantity invalid."
        ex_qty = float(existing["quantity"])
        if qty > ex_qty:
            return f"Cannot sell {qty} {symbol}; only {ex_qty} held."
        sale_price = float(payload.get("price") or existing["price"])
        proceeds = qty * sale_price
        realized = (sale_price - float(existing["cost"])) * qty
        new_qty = ex_qty - qty
        if new_qty <= 0:
            cur.execute("UPDATE holdings SET deleted_at = CURRENT_TIMESTAMP WHERE id = %s", (existing["id"],))
        else:
            cur.execute("UPDATE holdings SET quantity = %s WHERE id = %s", (new_qty, existing["id"]))
        credit_name = payload.get("credit_account")
        if credit_name:
            account = find_or_create_account(cur, credit_name)
            cur.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (proceeds, account["id"]))
            cur.execute("INSERT INTO transactions (account_id, amount, category, note) VALUES (%s, %s, %s, %s)",
                        (account["id"], proceeds, "investment", f"sell {qty} {symbol} @ {sale_price}"))
        return f"Sold {qty} {symbol} @ {money(sale_price)}. Proceeds {money(proceeds)}, realised PnL {money(realized)}."
    if action == "remove_holding":
        symbol = str(payload.get("symbol", "")).upper().strip()
        cur.execute("UPDATE holdings SET deleted_at = CURRENT_TIMESTAMP WHERE symbol = %s AND deleted_at IS NULL", (symbol,))
        return f"Removed holding {symbol}." if cur.rowcount else f"No active holding {symbol} to remove."
    if action == "insight":
        topic = str(payload.get("topic", "")).strip()
        period = payload.get("period_days") or (7 if topic == "recent_activity" else 30)
        return resolve_insight(cur, topic, period) or "I don't know that insight topic yet."
    return None

def mock_openclaw_response(text):
    normalized = text.strip().lower()
    tx_match = re.search(
        r"\b(added|add|deposit|deposited|withdraw|withdrew|spent|paid|remove|removed)\b\s+€?([0-9]+(?:\.[0-9]+)?)\s+(?:to|from|in|into)?\s*([a-z0-9 _-]+?)(?:\s+for\s+(.+))?$",
        normalized, re.I
    )
    if tx_match:
        verb, raw_amount, account_name, note = tx_match.groups()
        amt = float(raw_amount)
        is_out = verb in ["withdraw", "withdrew", "spent", "paid", "remove", "removed"]
        cat = category_for(note or verb, is_out)
        return {
            "action": "create_transaction", "account": account_name, "amount": amt,
            "type": "withdrawal" if is_out else "deposit", "category": cat, "note": note or verb,
            "requires_confirmation": amt > 5000,
            "replyText": f"Staged withdrawal of €{amt} for {cat}. Please confirm." if amt > 5000 else f"Automatically recorded {amt} for {note or verb}."
        }
    return {"action": "query", "replyText": "I couldn't parse that reliably. Please use standard phrases like 'added 100 to account1'."}


def get_totals(cur):
    cur.execute("SELECT COALESCE(SUM(balance), 0) value FROM accounts WHERE deleted_at IS NULL")
    cash = float(cur.fetchone()["value"])
    cur.execute("SELECT COALESCE(SUM(quantity * price), 0) value FROM holdings WHERE deleted_at IS NULL")
    portfolio = float(cur.fetchone()["value"])
    cur.execute("SELECT COALESCE(SUM(quantity * cost), 0) value FROM holdings WHERE deleted_at IS NULL")
    cost = float(cur.fetchone()["value"])
    return {"cash": cash, "portfolio": portfolio, "cost": cost, "pnl": portfolio - cost, "net_worth": cash + portfolio}


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_headers()

    def do_GET(self):
        if not self.require_auth():
            return
        route = urlparse(self.path).path
        with db_cursor() as cur:
            if route == "/api/me":
                return self.json({"user": APP_USER})
            if route == "/api/summary":
                return self.json(get_totals(cur))
            if route == "/api/accounts":
                cur.execute("SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY balance DESC")
                return self.json(rows_to_dicts(cur.fetchall()))
            if route == "/api/transactions":
                cur.execute(
                    "SELECT t.*, a.name account_name FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY t.created_at DESC LIMIT 200"
                )
                return self.json(rows_to_dicts(cur.fetchall()))
            if route == "/api/holdings":
                cur.execute("SELECT * FROM holdings WHERE deleted_at IS NULL ORDER BY symbol")
                
                def stringify_h(row):
                    d = dict(row)
                    d["id"] = str(d["id"])
                    for field in ["quantity", "cost", "price"]: d[field] = float(d[field])
                    if d.get("created_at"): d["created_at"] = str(d["created_at"])
                    if d.get("last_price_at"): d["last_price_at"] = str(d["last_price_at"])
                    return d
                return self.json([stringify_h(r) for r in cur.fetchall()])
            if route == "/api/analysis":
                cur.execute("""
                    SELECT COALESCE(SUM(amount), 0) as total, category
                    FROM transactions 
                    WHERE deleted_at IS NULL AND created_at > CURRENT_DATE - INTERVAL '30 days'
                    GROUP BY category
                """)
                rows = cur.fetchall()
                inflow = sum(r['total'] for r in rows if r['total'] > 0)
                outflow = abs(sum(r['total'] for r in rows if r['total'] < 0))
                savings_rate = ((inflow - outflow) / inflow * 100) if inflow > 0 else 0
                
                cur.execute("SELECT COALESCE(SUM(balance), 0) value FROM accounts WHERE deleted_at IS NULL")
                cash = float(cur.fetchone()["value"])
                runway = round(cash / outflow, 1) if outflow > 0 else 999
                
                return self.json({
                    "thirty_day_inflow": float(inflow),
                    "thirty_day_outflow": float(outflow),
                    "savings_rate_pct": float(savings_rate),
                    "runway_months": float(runway),
                    "categories": {r['category']: float(r['total']) for r in rows}
                })
            if route == "/api/chat":
                cur.execute("SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 100")
                chats = rows_to_dicts(cur.fetchall())
                for c in chats:
                    c["id"] = str(c["id"])
                    if c.get("created_at"): c["created_at"] = str(c["created_at"])
                    if c.get("action_id"):
                        c["action_id"] = str(c["action_id"])
                        cur.execute("SELECT * FROM agent_actions WHERE id = %s", (c["action_id"],))
                        action = cur.fetchone()
                        c["action_status"] = action["status"] if action else "unknown"
                return self.json(list(reversed(chats)))
        self.not_found()

    def do_POST(self):
        route = urlparse(self.path).path
        if route == "/api/login":
            body = self.body()
            with db_cursor() as cur:
                cur.execute("SELECT * FROM users WHERE username = %s", (body.get("username"),))
                row = cur.fetchone()
                
                req_ip = self.client_address[0]
                if FAILED_LOGINS.get(req_ip, 0) > 5:
                    return self.json({"error": "Too many failed attempts. Locked."}, 429)

                if row and verify_password(body.get("password", ""), row["password_hash"]):
                    token = sign_session(row["username"])
                    FAILED_LOGINS[req_ip] = 0
                    self.send_response(200)
                    cookie_str = f"balance_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_TTL}"
                    if ENVIRONMENT == "production": cookie_str += "; Secure"
                    self.send_header("Set-Cookie", cookie_str)
                    payload = json.dumps({"ok": True}).encode("utf-8")
                    self.send_header("Content-Length", str(len(payload)))
                    self.send_headers()
                    self.wfile.write(payload)
                    return
                else:
                    FAILED_LOGINS[req_ip] = FAILED_LOGINS.get(req_ip, 0) + 1
                    
            return self.json({"error": "Invalid login"}, 401)
        if not self.require_auth():
            return
        body = self.body()
        route = urlparse(self.path).path
        with db_cursor() as cur:
            if route == "/api/logout":
                self.send_response(200)
                self.send_header("Set-Cookie", "balance_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
                payload = json.dumps({"ok": True}).encode("utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.send_headers()
                self.wfile.write(payload)
                return
            if route == "/api/accounts":
                cur.execute("INSERT INTO accounts (name, balance) VALUES (%s, %s)", (body["name"], float(body.get("balance", 0))))
                return self.json({"ok": True}, 201)
            if route == "/api/transactions":
                account = find_or_create_account(cur, body["account"])
                amount = float(body["amount"])
                cur.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (amount, account["id"]))
                cur.execute(
                    "INSERT INTO transactions (account_id, amount, category, note) VALUES (%s, %s, %s, %s)",
                    (account["id"], amount, body.get("category", "manual"), body.get("note", "manual")),
                )
                return self.json({"ok": True}, 201)
            if route == "/api/holdings":
                upsert_holding(cur, body["symbol"].upper(), float(body["quantity"]), float(body["cost"]), float(body["price"]))
                return self.json({"ok": True}, 201)
            if route == "/api/prices":
                for item in body.get("prices", []):
                    cur.execute(
                        "UPDATE holdings SET price = %s, last_price_at = CURRENT_TIMESTAMP WHERE symbol = %s",
                        (float(item["price"]), item["symbol"].upper()),
                    )
                return self.json({"ok": True})
            if route == "/api/chat":
                result = handle_chat_command(body.get("message", ""))
                return self.json(result)
            if route.startswith("/api/agent/confirm/"):
                parts = route.rstrip('/').split('/')
                item_id = parts[4]
                
                cur.execute("SELECT * FROM agent_actions WHERE id = %s", (item_id,))
                action = cur.fetchone()
                if not action or action["status"] != "pending":
                    return self.json({"error": "Action invalid or already processed"}, 400)
                
                cur.execute("UPDATE agent_actions SET status = 'executed' WHERE id = %s", (item_id,))
                execute_agent_action(cur, action["action_type"], json.loads(action["payload_json"]))
                cur.execute("UPDATE chat_messages SET action_id = NULL WHERE action_id = %s", (item_id,))
                cur.execute("INSERT INTO chat_messages (role, text) VALUES (%s, %s)", ("agent", "Action confirmed and executed."))
                return self.json({"ok": True})
            if route.startswith("/api/agent/cancel/"):
                parts = route.rstrip('/').split('/')
                item_id = parts[4]
                cur.execute("UPDATE agent_actions SET status = 'cancelled' WHERE id = %s", (item_id,))
                cur.execute("UPDATE chat_messages SET action_id = NULL WHERE action_id = %s", (item_id,))
                cur.execute("INSERT INTO chat_messages (role, text) VALUES (%s, %s)", ("agent", "Action cancelled."))
                return self.json({"ok": True})
        self.not_found()

    def do_PUT(self):
        if not self.require_auth():
            return
        route = urlparse(self.path).path
        body = self.body()
        parts = route.rstrip('/').split('/')
        if len(parts) == 4 and parts[1] == 'api':
            resource = parts[2]
            item_id = parts[3]
            
            with db_cursor() as cur:
                if resource == 'accounts':
                    cur.execute("UPDATE accounts SET name = %s, balance = %s WHERE id = %s", 
                                (body['name'], float(body.get('balance', 0)), item_id))
                    return self.json({"ok": True})
                elif resource == 'holdings':
                    cur.execute("UPDATE holdings SET symbol = %s, quantity = %s, cost = %s, price = %s WHERE id = %s", 
                        (body['symbol'].upper(), float(body['quantity']), float(body['cost']), float(body['price']), item_id))
                    return self.json({"ok": True})
                elif resource == 'transactions':
                    account = find_or_create_account(cur, body["account"])
                    amount = float(body["amount"])
                    cur.execute("SELECT * FROM transactions WHERE id = %s", (item_id,))
                    old_tx = cur.fetchone()
                    if old_tx:
                        cur.execute("UPDATE accounts SET balance = balance - %s WHERE id = %s", (float(old_tx["amount"]), old_tx["account_id"]))
                    cur.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (amount, account["id"]))
                    cur.execute("UPDATE transactions SET account_id = %s, amount = %s, category = %s, note = %s WHERE id = %s",
                        (account["id"], amount, body.get("category", "manual"), body.get("note", "manual"), item_id))
                    return self.json({"ok": True})
        self.not_found()

    def do_DELETE(self):
        if not self.require_auth():
            return
        route = urlparse(self.path).path
        parts = route.rstrip('/').split('/')
        if len(parts) == 4 and parts[1] == 'api':
            resource = parts[2]
            item_id = parts[3]

            with db_cursor() as cur:
                if resource == 'accounts':
                    cur.execute("UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = %s", (item_id,))
                    return self.json({"ok": True})
                elif resource == 'holdings':
                    cur.execute("UPDATE holdings SET deleted_at = CURRENT_TIMESTAMP WHERE id = %s", (item_id,))
                    return self.json({"ok": True})
                elif resource == 'transactions':
                    cur.execute("SELECT * FROM transactions WHERE id = %s AND deleted_at IS NULL", (item_id,))
                    old_tx = cur.fetchone()
                    if old_tx:
                        cur.execute("UPDATE accounts SET balance = balance - %s WHERE id = %s", (float(old_tx["amount"]), old_tx["account_id"]))
                        cur.execute("UPDATE transactions SET deleted_at = CURRENT_TIMESTAMP WHERE id = %s", (item_id,))
                    return self.json({"ok": True})
        self.not_found()

    def body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode())

    def require_auth(self):
        token = None
        header = self.headers.get("Cookie", "")
        if header:
            jar = cookies.SimpleCookie(header)
            if "balance_session" in jar:
                token = jar["balance_session"].value
        if verify_session(token):
            return True
        self.json({"error": "Unauthorized"}, 401)
        return False

    def json(self, data, status=200):
        payload = json.dumps(data).encode('utf-8') if data is not None else b"{}"
        self.send_response(status)
        self.send_header("Content-Length", str(len(payload)))
        self.send_headers()
        self.wfile.write(payload)

    def send_headers(self):
        origin = self.headers.get("Origin")
        if origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")
        
        # Comprehensive Phase 3 Security Rules
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()

    def not_found(self):
        self.json({"error": "Not found"}, 404)


if __name__ == "__main__":
    if ENVIRONMENT == "production":
        print("Initializing Production Guardrails...")
        if "change-me" in APP_PASSWORD:
            print("FATAL: APP_PASSWORD is still set to the default 'change-me' in production!")
            os._exit(1)
        if "change-me" in SESSION_SECRET.decode():
            print("FATAL: BALANCE_SESSION_SECRET is still set to a dev-secret in production!")
            os._exit(1)
            
    init_db()
    print(f"Balance API listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

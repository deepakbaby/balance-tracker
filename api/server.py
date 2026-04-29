#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.environ.get("BALANCE_DB", ROOT / "db" / "balance.sqlite3"))
HOST = os.environ.get("BALANCE_HOST", "127.0.0.1")
PORT = int(os.environ.get("BALANCE_PORT", "8787"))
APP_USER = os.environ.get("BALANCE_USER", "deepak")
APP_PASSWORD = os.environ.get("BALANCE_PASSWORD", "change-me")
SESSION_SECRET = os.environ.get("BALANCE_SESSION_SECRET", "dev-secret-change-me").encode()
SESSION_TTL = 60 * 60 * 24 * 14
ALLOWED_ORIGIN = os.environ.get("BALANCE_ALLOWED_ORIGIN", "http://localhost:4173")


def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY,
              username TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS accounts (
              id INTEGER PRIMARY KEY,
              name TEXT UNIQUE NOT NULL,
              balance REAL NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS transactions (
              id INTEGER PRIMARY KEY,
              account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
              amount REAL NOT NULL,
              category TEXT NOT NULL,
              note TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS holdings (
              id INTEGER PRIMARY KEY,
              symbol TEXT UNIQUE NOT NULL,
              quantity REAL NOT NULL,
              cost REAL NOT NULL,
              price REAL NOT NULL,
              last_price_at TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
              id INTEGER PRIMARY KEY,
              role TEXT NOT NULL,
              text TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (APP_USER,)).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (APP_USER, hash_password(APP_PASSWORD)),
            )
        if not conn.execute("SELECT id FROM accounts LIMIT 1").fetchone():
            conn.executemany("INSERT INTO accounts (name, balance) VALUES (?, ?)", [("account1", 0), ("account2", 0)])


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
    return [dict(row) for row in rows]


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


def find_or_create_account(conn, name):
    clean = re.sub(r"\s+", " ", name).strip()
    row = conn.execute("SELECT * FROM accounts WHERE lower(name) = lower(?)", (clean,)).fetchone()
    if row:
        return dict(row)
    cursor = conn.execute("INSERT INTO accounts (name, balance) VALUES (?, 0)", (clean,))
    return dict(conn.execute("SELECT * FROM accounts WHERE id = ?", (cursor.lastrowid,)).fetchone())


def upsert_holding(conn, symbol, quantity, cost, price):
    existing = conn.execute("SELECT * FROM holdings WHERE symbol = ?", (symbol,)).fetchone()
    if existing:
        total_qty = existing["quantity"] + quantity
        avg_cost = ((existing["quantity"] * existing["cost"]) + (quantity * cost)) / total_qty
        conn.execute(
            "UPDATE holdings SET quantity = ?, cost = ?, price = ? WHERE id = ?",
            (total_qty, avg_cost, price, existing["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO holdings (symbol, quantity, cost, price) VALUES (?, ?, ?, ?)",
            (symbol, quantity, cost, price),
        )


def handle_chat_command(text):
    normalized = text.strip().lower()
    tx_match = re.search(
        r"\b(added|add|deposit|deposited|withdraw|withdrew|spent|paid|remove|removed)\b\s+€?([0-9]+(?:\.[0-9]+)?)\s+(?:to|from|in|into)?\s*([a-z0-9 _-]+?)(?:\s+for\s+(.+))?$",
        normalized,
        re.I,
    )
    with db() as conn:
        conn.execute("INSERT INTO chat_messages (role, text) VALUES (?, ?)", ("user", text))
        if tx_match:
            verb, raw_amount, account_name, note = tx_match.groups()
            is_out = verb in ["withdraw", "withdrew", "spent", "paid", "remove", "removed"]
            amount = float(raw_amount)
            signed_amount = -amount if is_out else amount
            account = find_or_create_account(conn, account_name)
            conn.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (signed_amount, account["id"]))
            conn.execute(
                "INSERT INTO transactions (account_id, amount, category, note) VALUES (?, ?, ?, ?)",
                (account["id"], signed_amount, category_for(note or verb, is_out), note or verb),
            )
            updated = conn.execute("SELECT * FROM accounts WHERE id = ?", (account["id"],)).fetchone()
            reply = f"{'Withdrew' if is_out else 'Added'} {money(amount)} {'from' if is_out else 'to'} {updated['name']}. New balance: {money(updated['balance'])}."
        else:
            holding_match = re.search(
                r"\b(bought|buy|holding|own)\b\s+([0-9]+(?:\.[0-9]+)?)\s+([a-z.]+)\s+(?:at|for)\s+€?([0-9]+(?:\.[0-9]+)?)(?:\s+now\s+€?([0-9]+(?:\.[0-9]+)?))?",
                normalized,
                re.I,
            )
            if holding_match:
                _, qty, symbol, cost, price = holding_match.groups()
                quantity = float(qty)
                current_price = float(price or cost)
                upsert_holding(conn, symbol.upper(), quantity, float(cost), current_price)
                reply = f"Added {quantity:g} {symbol.upper()}. Current value: {money(quantity * current_price)}."
            elif "net worth" in normalized:
                totals = get_totals(conn)
                reply = f"Your current net worth is {money(totals['net_worth'])}: {money(totals['cash'])} cash and {money(totals['portfolio'])} portfolio."
            else:
                reply = "I can log deposits, withdrawals, and holdings. Try: withdraw 200 from account2 for renovation."
        conn.execute("INSERT INTO chat_messages (role, text) VALUES (?, ?)", ("agent", reply))
        return reply


def get_totals(conn):
    cash = conn.execute("SELECT COALESCE(SUM(balance), 0) value FROM accounts").fetchone()["value"]
    portfolio = conn.execute("SELECT COALESCE(SUM(quantity * price), 0) value FROM holdings").fetchone()["value"]
    cost = conn.execute("SELECT COALESCE(SUM(quantity * cost), 0) value FROM holdings").fetchone()["value"]
    return {"cash": cash, "portfolio": portfolio, "cost": cost, "pnl": portfolio - cost, "net_worth": cash + portfolio}


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_headers()

    def do_GET(self):
        if not self.require_auth():
            return
        route = urlparse(self.path).path
        with db() as conn:
            if route == "/api/me":
                return self.json({"user": APP_USER})
            if route == "/api/summary":
                return self.json(get_totals(conn))
            if route == "/api/accounts":
                rows = conn.execute("SELECT * FROM accounts ORDER BY name").fetchall()
                return self.json(rows_to_dicts(rows))
            if route == "/api/transactions":
                rows = conn.execute(
                    "SELECT t.*, a.name account_name FROM transactions t JOIN accounts a ON a.id = t.account_id ORDER BY t.created_at DESC, t.id DESC LIMIT 200"
                ).fetchall()
                return self.json(rows_to_dicts(rows))
            if route == "/api/holdings":
                rows = conn.execute("SELECT * FROM holdings ORDER BY symbol").fetchall()
                return self.json(rows_to_dicts(rows))
            if route == "/api/chat":
                rows = conn.execute("SELECT * FROM chat_messages ORDER BY id DESC LIMIT 100").fetchall()
                return self.json(list(reversed(rows_to_dicts(rows))))
        self.not_found()

    def do_POST(self):
        route = urlparse(self.path).path
        if route == "/api/login":
            body = self.body()
            with db() as conn:
                row = conn.execute("SELECT * FROM users WHERE username = ?", (body.get("username"),)).fetchone()
                if row and verify_password(body.get("password", ""), row["password_hash"]):
                    token = sign_session(row["username"])
                    self.send_response(200)
                    self.send_header("Set-Cookie", f"balance_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_TTL}")
                    self.send_headers()
                    self.wfile.write(json.dumps({"ok": True}).encode())
                    return
            return self.json({"error": "Invalid login"}, 401)
        if not self.require_auth():
            return
        body = self.body()
        route = urlparse(self.path).path
        with db() as conn:
            if route == "/api/logout":
                self.send_response(200)
                self.send_header("Set-Cookie", "balance_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
                self.send_headers()
                self.wfile.write(json.dumps({"ok": True}).encode())
                return
            if route == "/api/accounts":
                conn.execute("INSERT INTO accounts (name, balance) VALUES (?, ?)", (body["name"], float(body.get("balance", 0))))
                return self.json({"ok": True}, 201)
            if route == "/api/transactions":
                account = find_or_create_account(conn, body["account"])
                amount = float(body["amount"])
                conn.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (amount, account["id"]))
                conn.execute(
                    "INSERT INTO transactions (account_id, amount, category, note) VALUES (?, ?, ?, ?)",
                    (account["id"], amount, body.get("category", "manual"), body.get("note", "manual")),
                )
                return self.json({"ok": True}, 201)
            if route == "/api/holdings":
                upsert_holding(conn, body["symbol"].upper(), float(body["quantity"]), float(body["cost"]), float(body["price"]))
                return self.json({"ok": True}, 201)
            if route == "/api/prices":
                for item in body.get("prices", []):
                    conn.execute(
                        "UPDATE holdings SET price = ?, last_price_at = CURRENT_TIMESTAMP WHERE symbol = ?",
                        (float(item["price"]), item["symbol"].upper()),
                    )
                return self.json({"ok": True})
            if route == "/api/chat":
                reply = handle_chat_command(body.get("message", ""))
                return self.json({"reply": reply})
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
        self.send_response(status)
        self.send_headers()
        self.wfile.write(json.dumps(data).encode())

    def send_headers(self):
        origin = self.headers.get("Origin")
        if origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()

    def not_found(self):
        self.json({"error": "Not found"}, 404)


if __name__ == "__main__":
    init_db()
    print(f"Balance API listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

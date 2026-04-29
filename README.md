# Balance Tracker

A private, mobile-first balance tracker prototype for `balance.deepakbaby.in`.

## Structure

```text
api/   Private backend, auth, chat parser, SQLite persistence
db/    Local schema reference
web/   Mobile-first PWA frontend
```

## What is included

- Backend login with a private session cookie.
- Account creation and balance tracking.
- Chat ledger for natural-language deposits and withdrawals.
- Portfolio holdings with current value and unrealized PnL.
- Dashboard, account, portfolio, analysis, and chat views.
- `robots.txt` and `noindex` metadata so the public web should not index it.

## Run locally

Frontend:

```sh
python3 -m http.server 4173 --directory web
```

API:

```sh
BALANCE_PASSWORD='choose-a-real-password' \
BALANCE_SESSION_SECRET='generate-a-long-random-secret' \
python3 api/server.py
```

Open `http://localhost:4173` and sign in with:

```text
username: deepak
password: the value of BALANCE_PASSWORD
```

## Example chat commands

```text
added 1500 to account1
withdraw 200 from account2 for renovation
bought 3 AAPL at 175 now 190
what is my net worth
```

## Production notes

The frontend now reads and writes accounts, holdings, transactions, and chat messages through the API. Browser `localStorage` is only used for lightweight chart snapshots and the optional API base override.

Before deploying real financial data, add:

- PostgreSQL persistence.
- Encrypted backups.
- HTTPS-only secure cookies.
- Rate limits on login and chat endpoints.
- Dedicated OpenClaw balance-tracker agent config.
- A separate deployment from the WhatsApp newsletter flow.

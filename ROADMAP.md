# Balance Tracker Roadmap

## Session Handoff Summary

This is a private balance/net-worth tracker for Deepak, intended to be an OpenClaw-based setup running on AWS Lightsail. The app chat functionality, SQL database, OpenClaw balance agent, and backend API should live on the Lightsail balance-tracker service. This must run independently from the existing OpenClaw newsletter project. The newsletter flow currently uses WhatsApp links and weekly newsletter generation on Lightsail; this balance tracker must not reuse, modify, block, or interfere with that pipeline.

Product direction:

- Mobile-first private PWA for `balance.deepakbaby.in`.
- Light theme, clean modern Apple-like typography, slick finance-app feel.
- Bottom navigation is icon-only.
- Core views are Home, Accounts, Portfolio, Analysis, and Chat.
- Chat is the primary input method for logging money movements.
- Example commands:
  - `added 1500 to account1`
  - `withdraw 200 from account2 for renovation`
  - `bought 3 AAPL at 175 now 190`
- Portfolio view should feel closer to modern wealth trackers like getquin, but not copied:
  - live total value
  - PnL amount
  - PnL percentage in brackets
  - green/red PnL color
  - invested amount
  - return percentage
  - best holding
  - X-Ray style asset mix
- Analysis should include more than basic balances:
  - net worth evolution
  - monthly inflow/outflow
  - savings rate
  - runway
  - allocation
  - largest spend
  - portfolio signals

Architecture direction:

- This is an OpenClaw-based app, not just a static tracker.
- The phone app/PWA talks to the balance tracker backend on Lightsail.
- The balance tracker backend talks to a dedicated OpenClaw balance agent.
- The balance tracker SQL database lives on Lightsail, separate from newsletter storage.
- Keep this project separate from the newsletter project.
- Current local structure:

```text
balance-tracker/
  web/   Mobile-first frontend
  api/   Private backend API
  db/    Local schema reference
```

- Frontend now talks to the backend API.
- Backend currently uses dependency-free Python and SQLite for local development.
- Login is backend session-cookie based.
- Browser `localStorage` is only for lightweight chart snapshots and optional API base override.
- Production should move to PostgreSQL.
- Production live price fetching should move server-side so holdings are not leaked from the phone browser to third-party APIs.
- OpenClaw integration is key: it should be a dedicated balance-tracker agent with its own config, routes, and database actions.
- The existing newsletter OpenClaw setup on Lightsail must remain isolated and unchanged.

Current local dev details:

- Frontend URL: `http://localhost:4173`
- API URL: `http://localhost:8787`
- Local test login used during development:
  - username: `deepak`
  - password: `1234`
- Local SQLite DB contains test records and should be deleted/recreated before real use.

Design decisions already made:

- Prefer light theme.
- Prefer clean Apple-like fonts using system font stack.
- Avoid marketing/landing-page layout; the app opens directly into the usable tracker.
- Use compact cards, soft shadows, light borders, and subtle green accent.
- Keep the app private: no public registration, no search indexing, no WhatsApp dependency.
- Keep Lightsail services separated: newsletter and balance tracker should have separate app directories, services, environment variables, routes, databases, and logs.

This document tracks the remaining work to move the balance tracker from local prototype to a private OpenClaw-powered production app at `balance.deepakbaby.in`, running on AWS Lightsail.

## Current State

The project is now split into:

```text
balance-tracker/
  web/   Mobile-first frontend
  api/   Private backend API
  db/    Local schema reference
```

Implemented so far:

- Mobile-first light UI.
- Backend login with session cookie auth.
- Accounts, holdings, transactions, chat messages persisted in SQLite.
- Chat endpoint for commands like `added 1500 to account1`.
- Portfolio value, PnL, PnL percentage, and X-Ray asset mix.
- Live-price refresh path with price persistence.
- Separate project structure from the existing newsletter/WhatsApp flow.

## Phase 1: Finish Local App Integration

- Add visible loading and error states for API calls.
- Replace optimistic chat rendering with a cleaner pending message state.
- Add empty states for first-time setup.
- Add edit/delete flows for accounts, transactions, and holdings.
- Add transaction correction flow:
  - Undo last transaction.
  - Move transaction to another account.
  - Change amount/category/note.
- Add account detail page:
  - Balance history.
  - Transactions for that account.
  - Monthly inflow/outflow.
- Add holding detail page:
  - Quantity, cost basis, current price.
  - PnL amount and percentage.
  - Manual price update.
- Add manual transaction form for cases where chat is not ideal.
- Add currency configuration, defaulting to EUR.

## Phase 2: Production Data Model

- Move from SQLite to PostgreSQL for production.
- Add migrations instead of inline `CREATE TABLE` statements.
- Add proper IDs using UUIDs or generated stable IDs.
- Add these tables:
  - `users`
  - `accounts`
  - `transactions`
  - `holdings`
  - `price_snapshots`
  - `chat_messages`
  - `agent_actions`
  - `audit_log`
- Add transaction types:
  - deposit
  - withdrawal
  - transfer
  - buy
  - sell
  - dividend
  - fee
  - interest
  - manual_adjustment
- Add asset metadata:
  - symbol
  - name
  - asset class
  - currency
  - exchange/source
- Add account types:
  - cash
  - bank
  - card
  - brokerage
  - crypto
  - loan
  - property
  - custom
- Add soft deletion for financial records.
- Add audit trail for every balance-affecting change.

## Phase 3: Authentication And Privacy

- Disable public registration.
- Create the production user manually.
- Generate strong values for:
  - `BALANCE_PASSWORD`
  - `BALANCE_SESSION_SECRET`
- Store secrets outside the repository.
- Add HTTPS-only cookies in production:
  - `HttpOnly`
  - `Secure`
  - `SameSite=Lax`
- Add login rate limiting.
- Add session expiry and logout everywhere.
- Add optional second factor later:
  - TOTP
  - passkey
  - email code
- Add automatic lock after inactivity.
- Add `robots.txt` and `noindex` in production.
- Add security headers:
  - `Content-Security-Policy`
  - `X-Frame-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
- Ensure the API only allows requests from `https://balance.deepakbaby.in`.

## Phase 4: Server-Side Price Updates

Current live prices are fetched from the browser. For privacy, production should move price fetching to the backend.

- Add backend price provider module.
- Add scheduled price refresh worker.
- Store prices in `price_snapshots`.
- Cache external API responses.
- Add provider fallback strategy.
- Add support for:
  - stocks
  - ETFs
  - crypto
  - cash/manual assets
- Add per-asset price source metadata.
- Add stale-price warnings in the UI.
- Add price refresh status:
  - live
  - delayed
  - stale
  - manual
  - unavailable
- Avoid exposing portfolio symbols directly from the phone browser to third-party APIs.

## Phase 5: OpenClaw Integration

This is a key part of the final system. The app chat experience should connect to OpenClaw on Lightsail, and OpenClaw should write validated actions to the balance tracker SQL database. This must remain separate from the newsletter project.

Target architecture:

```text
Newsletter Project
WhatsApp -> OpenClaw newsletter agent -> weekly newsletter pipeline

Balance Tracker Project
Phone PWA -> Balance API on Lightsail -> OpenClaw balance agent -> Balance SQL database
```

Remaining work:

- Create a dedicated OpenClaw balance-tracker agent.
- Give it a separate config from the newsletter agent.
- Give it a separate Lightsail service/process from the newsletter agent.
- Give it separate environment variables from the newsletter project.
- Give it a separate database/schema from the newsletter project.
- Give it separate logs from the newsletter project.
- Give it a separate API route, for example:
  - `POST /api/agent/chat`
- Make the agent return structured actions:

```json
{
  "action": "create_transaction",
  "account": "account1",
  "amount": 1500,
  "type": "deposit",
  "category": "income",
  "note": "salary"
}
```

- Add server-side validation before applying agent actions.
- Store all proposed actions in `agent_actions`.
- Require confirmation for ambiguous or high-impact actions.
- Add correction commands:
  - `undo that`
  - `change that to account2`
  - `that was 250 not 200`
  - `mark it as renovation`
- Add analysis queries:
  - `what changed this week?`
  - `how much did I spend on renovation?`
  - `what is my current net worth?`
  - `which account grew the most?`
  - `how much cash runway do I have?`
- Add guardrails so the agent cannot affect the newsletter pipeline.
- Confirm the existing WhatsApp newsletter ingestion remains untouched.
- Confirm weekly newsletter generation still runs independently after balance tracker deployment.

## Phase 6: Analysis Features

- Net worth evolution over time.
- Account balance history.
- Monthly cash flow.
- Savings rate trend.
- Spending by category.
- Largest inflows/outflows.
- Portfolio allocation:
  - asset class
  - symbol
  - account
  - currency
- Portfolio performance:
  - total return
  - unrealized PnL
  - realized PnL
  - dividends
  - fees
- Benchmark comparison later.
- Dividend tracker later:
  - expected dividends
  - dividend yield
  - monthly dividend calendar
- Cash runway:
  - based on recent outflows
  - based on average monthly spend
- Alerts:
  - balance below threshold
  - asset overexposure
  - stale prices
  - unusually large transaction

## Phase 7: Deployment On AWS Lightsail

Recommended production layout:

```text
/opt/apps/newsletter
/opt/apps/balance-tracker
```

These should be independent deployments. The balance tracker must not share the newsletter app's WhatsApp webhook routes, worker queues, database tables, OpenClaw agent config, environment variables, or cron/systemd jobs.

Recommended services:

```text
balance-api.service
balance-web.service
balance-worker.service
```

Recommended domains:

```text
newsletter.deepakbaby.in
balance.deepakbaby.in
```

Deployment tasks:

- Create clean production directory on Lightsail.
- Install Python/Node/runtime dependencies as needed.
- Add PostgreSQL.
- Create production database and user.
- Configure environment variables.
- Configure reverse proxy with Nginx or Caddy.
- Enable HTTPS.
- Add systemd service for API.
- Add systemd service for worker.
- Serve the frontend as static files.
- Configure firewall to expose only:
  - 80
  - 443
  - SSH, restricted where possible
- Keep API bound to localhost behind the reverse proxy.
- Keep newsletter and balance tracker services independent.

## Phase 8: Backup And Recovery

- Add automated database backups.
- Encrypt backups.
- Store backups away from the Lightsail instance.
- Add backup rotation:
  - daily
  - weekly
  - monthly
- Document restore process.
- Test restore process before using real financial data.
- Export personal data as CSV/JSON.
- Add manual export button in app later.

## Phase 9: Mobile App Experience

Current plan is PWA first.

- Add proper app icons.
- Add splash screen metadata.
- Add `manifest.webmanifest` icons.
- Add install prompt polish.
- Add offline fallback screen.
- Cache app shell with a service worker.
- Avoid caching sensitive API responses.
- Add biometric unlock later if moving to native wrapper.
- Test on:
  - iPhone Safari
  - Android Chrome
  - desktop browser

## Phase 10: Cleanup Before Real Use

- Delete local test database.
- Recreate clean production database.
- Remove test accounts and transactions.
- Set real password and session secret.
- Confirm newsletter service still works unchanged.
- Confirm no WhatsApp routes are used by balance tracker.
- Confirm `balance.deepakbaby.in` is private behind login.
- Confirm search engines cannot index the app.
- Confirm backups work.
- Confirm restore works.

## Suggested Next Immediate Step

Implement production-style configuration and deployment files:

- `.env.example`
- `systemd/balance-api.service`
- `systemd/balance-web.service`
- `nginx/balance.deepakbaby.in.conf`
- backend config validation on startup

After that, move the database layer from SQLite to PostgreSQL.

# Balance Tracker API

Dependency-free local API for the private balance tracker.

## Run

```sh
BALANCE_PASSWORD='choose-a-real-password' \
BALANCE_SESSION_SECRET='generate-a-long-random-secret' \
python3 api/server.py
```

The API listens on `127.0.0.1:8787` by default.

For local browser development, CORS allows `http://localhost:4173` by default. Override it with:

```sh
BALANCE_ALLOWED_ORIGIN='https://balance.deepakbaby.in'
```

## Endpoints

- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/summary`
- `GET|POST /api/accounts`
- `GET|POST /api/transactions`
- `GET|POST /api/holdings`
- `POST /api/prices`
- `GET|POST /api/chat`

## Deployment Notes

This local version uses SQLite so it runs without installing packages. For Lightsail production, keep the route shapes but replace the storage layer with PostgreSQL and put the API behind HTTPS on `balance.deepakbaby.in`.

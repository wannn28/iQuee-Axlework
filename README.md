# Axlework — fleet & fuel operations dashboard (demo by iQuee)

A full-stack admin dashboard for a fictional telematics product, shown here running the workspace of
**Harbor & Pine Freight Co.**, a made-up 68-vehicle carrier in the Pacific Northwest. GPS trackers and tank-level
fuel sensors feed one console: where every unit is, how it is being driven, and where the fuel went.
**Demo only — every vehicle, person and number is seeded mock data**, but it lives in a real PostgreSQL database behind a
Go REST API: edits persist server-side, filtering/sorting/pagination and KPI aggregation run in SQL, and fuel-drop
detection is a SQL window-function query. The shared demo database resets to the seed every 24 h.
Live: https://axlework.iquee.tech · API health: https://axlework.iquee.tech/api/health

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 6, Recharts, self-hosted fonts (Archivo, JetBrains Mono) |
| API | Go 1.26 (module targets 1.22+ APIs), chi v5 router, go-chi/cors, go-chi/httprate, `log/slog` JSON logging |
| Database | PostgreSQL 16 via pgx v5 (pgxpool, COPY for bulk seed), schema migrations with golang-migrate (embedded SQL) |
| Auth | JWT (HS256, golang-jwt v5), bcrypt-hashed passwords, one-click demo account |
| Delivery | Docker multi-stage build (static binary on `scratch`), Docker Compose (api + db, named volume), Nginx reverse proxy + TLS |

## Architecture

```
browser ──HTTPS──> Nginx (axlework.iquee.tech)
                     ├── /        static SPA from /var/www/iquee-axlework (Vite build)
                     └── /api/    proxy_pass http://127.0.0.1:8009 ──> Go API container (chi)
                                                                        └── pgx pool ──> PostgreSQL 16 container
                                                                            (private compose network, no published port,
                                                                             data in the named volume "pgdata")
```

- **Seed:** `scripts/export-seed.ts` runs the same deterministic generator the frontend used when it was browser-only and
  writes `server/internal/seed/seed.json`. The Go binary embeds it; on first start (and on "Reset demo data" or the
  24 h schedule) it bulk-loads vehicles, drivers, depots, trips/route points, 15-min fuel readings, events, service
  records, alerts and 180 days of daily rollups. A background job re-anchors timestamps every minute so the replayed data
  always looks live ("seen 40 s ago", last-24 h tank chart).
- **Fuel-drop detection:** `LAG()` over each vehicle's readings flags any fall ≥ the user's *Fuel drop* threshold
  (Settings, gallons) or ≥ 6 % of the tank between consecutive samples. Detected drops show on the chart and in the timeline.
- **Security:** JWT on every endpoint except `/api/health` and `/api/auth/login`; login and reset are rate-limited per IP;
  CORS allows only the site's own origin; the API container runs read-only as a non-root user with all capabilities dropped;
  the database has no host port and the API is bound to 127.0.0.1 only.
- **Ops:** structured JSON logs (one line per request with status, duration, request id), graceful shutdown on SIGTERM,
  Docker health checks (`/api -healthcheck`), `restart: unless-stopped`.

### API (all under `/api`, JSON)

| Method & path | Purpose |
| --- | --- |
| `GET /health` | Liveness + DB check (public) |
| `POST /auth/login` | `{email,password}` or `{demo:true}` → JWT · `GET /auth/me` |
| `GET /vehicles` | Server-side search `q`, filters `status/depot/type`, `sort/dir`, `page/size`; returns items, totals and status counts |
| `POST /vehicles` · `GET/PUT/DELETE /vehicles/{id}` · `POST /vehicles/bulk-delete` | CRUD with validation (422 field errors, 409 conflicts) |
| `GET /vehicles/{id}/detail` | Vehicle + trip + fuel + timeline + services in one call |
| `GET /vehicles/{id}/trip` · `/fuel?hours=24` · `/timeline` · `/services` | Route points & stops · tank series with drop detection · events · service history |
| `GET /vehicles/export.csv` | CSV of the filtered (or `ids=`) set, `units=imperial|metric` |
| `GET /overview?range=7|30|90` | KPI totals + period-over-period deltas, daily series, spend by depot, status mix, efficiency watchlist |
| `GET /reports/daily.csv?range=` | Daily operations CSV |
| `GET /fleet/summary` · `GET /depots` · `GET /drivers` | Sidebar counts · depots with unit counts · drivers with assignment |
| `GET /alerts?status=&limit=` · `POST /alerts/{id}/ack` | Alert feed · acknowledge |
| `GET/PUT /settings` | Per-user workspace settings |
| `POST /demo/reset` | Reload the seed |

**Demo login:** "Enter demo" (one click) or `alex.moreno@harborpine.example` / `demo-password`.

## Features

- **Overview:** KPI band with period-over-period deltas and sparklines, 7/30/90-day range switch, distance area chart vs previous period,
  fleet-status donut, alert feed with acknowledge, fuel spend by depot (bar), efficiency watchlist, CSV report export.
- **Vehicles:** dense data table with server-side search, status tabs, depot/type filters, sortable columns, pagination (10/25/50),
  row selection with bulk CSV export / remove, export of the filtered set. All table state is URL-synced (shareable links).
- **Vehicle detail:** live stats, schematic SVG route map (driven vs planned path, stops, current position), event timeline,
  24 h tank-level chart with sudden-drop (siphoning) detection, unit spec sheet, service history, trip-log CSV.
- **Add / edit vehicle:** sectioned form with inline + summary validation (unit number format, 17-char VIN rules, 15-digit IMEI, ranges);
  uniqueness of unit number / VIN / IMEI is enforced by the API and shown inline.
- **Settings:** profile, workspace, imperial/metric units (applied app-wide), alert thresholds, notification toggles, theme, reset demo data.
- Light (default) and dark themes, collapsible sidebar, mobile drawer, loading and error states for every API call.

## Local development

Requirements: Node 20+, Go 1.22+ (the pinned dependencies select Go 1.26 via toolchain), Docker (or a local PostgreSQL 16).

```bash
# 1) database + API in Docker
cp .env.example .env                       # set POSTGRES_PASSWORD and JWT_SECRET (openssl rand -hex 32)
sed -i 's#^CORS_ORIGINS=.*#CORS_ORIGINS=http://localhost:5173#' .env
docker compose up -d --build               # API on http://127.0.0.1:8009/api/health

# ...or run the API from source against any PostgreSQL:
cd server
DATABASE_URL=postgres://axlework:pass@localhost:5432/axlework?sslmode=disable \
JWT_SECRET=$(openssl rand -hex 32) PORT=8009 CORS_ORIGINS=http://localhost:5173 go run ./cmd/api
go vet ./... && go build ./...

# 2) frontend (Vite proxies /api to the API)
npm install
API_PROXY=http://localhost:8009 npm run dev   # http://localhost:5173
npm run build                                 # -> dist/ (static; serve at the domain root with SPA fallback)

# regenerate server/internal/seed/seed.json after changing src/data/*
npm run seed:export

# end-to-end check against a running site (Playwright + Chrome)
python tools/e2e-api.py http://localhost:4174 /tmp/axlework
```

Production: `docker compose up -d --build` in `/opt/iquee/axlework` (compose project `iquee-axlework`), then add to the
site's nginx server block:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8009;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Screenshots

| Overview | Vehicles |
| --- | --- |
| ![Overview](docs/overview.png) | ![Vehicles table](docs/vehicles-table.png) |
| **Vehicle detail** | **Dark theme** |
| ![Vehicle detail](docs/vehicle-detail.png) | ![Overview, dark theme](docs/overview-dark.png) |

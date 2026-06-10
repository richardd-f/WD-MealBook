# MealBook Benchmark & Monitoring

A self-contained rig to benchmark MealBook across three load phases — **light**,
**medium**, **hard** — and record six metrics per phase, each run **10×** and averaged.

| Metric | Source | How it's captured |
|---|---|---|
| Cold start | `scripts/cold-start.ps1` | stop → recreate `app`+`web`, time to first HTTP 200 |
| RAM idle | Prometheus / Grafana | `container_memory_usage_bytes` **at rest** (before load) |
| Peak CPU | Prometheus (via `run-phase`) | `max_over_time(rate(container_cpu_usage_seconds_total[…]))` over the run |
| P95 TTFB | k6 (via `run-phase`) | `http_req_waiting` p(95) |
| Max RPS (<500ms) | k6 (via `run-phase`) | highest target RPS where `http_req_duration` p(95) stays < 500ms |
| Deployment size | `scripts/image-size.ps1` | size of the built `app` + `web` images |

> cAdvisor + Prometheus only know about **container resources** (CPU/RAM). HTTP
> metrics (TTFB, RPS) come from the **k6** load generator; cold start and image
> size are one-shot script measurements.

---

## 1. Components

```
monitoring/
  docker-compose.monitoring.yml   cadvisor + prometheus + grafana + k6
  prometheus/prometheus.yml        scrape config (cadvisor + self)
  grafana/                         auto-provisioned datasource + dashboard
  k6/light.js | medium.js | hard.js   the three phases
  results/                         k6 summaries + per-phase CSVs (gitignored)
scripts/
  cold-start.ps1 / .sh             cold start
  image-size.ps1 / .sh             deployment size
  run-phase.ps1                    runs a phase 10×, records TTFB/RPS/CPU/RAM, averages
```

Ports on the host: Grafana `:3000` (admin/admin), Prometheus `:9090`, cAdvisor UI `:8081`.

---

## 2. One-time setup

The monitoring services join the app's existing external `npm_default` network, so
the **app must be running first**:

```powershell
# from repo root — build + start the app
docker compose up -d --build

# seed the DB (hard phase needs a user + meals)
docker compose exec app php artisan migrate --seed

# start the monitoring stack (cadvisor + prometheus + grafana)
docker compose -f monitoring/docker-compose.monitoring.yml up -d cadvisor prometheus grafana
```

Open Grafana at http://localhost:3000 → dashboard **"MealBook Benchmark"**.

---

## 3. Capture the six metrics

### Cold start  &  Deployment size (run once per build)

```powershell
./scripts/image-size.ps1            # -> deployment_size_mb
./scripts/cold-start.ps1 -Runs 10   # -> cold_start_seconds (avg of 10)
```

### RAM idle (read at rest, before any load)

Let the app sit idle ~1 min, then in Grafana read the **"RAM idle"** stat panel
(or query Prometheus directly):

```
container_memory_usage_bytes{name="mealbook_app"}
```

### P95 TTFB, Peak CPU, and the per-run numbers — one command per phase

`run-phase.ps1` runs the phase 10×, and for **each** run records achieved RPS,
P95 TTFB, P95 duration, error %, peak CPU and peak RAM into
`monitoring/results/<phase>-runs.csv`, then prints the averages:

```powershell
./scripts/run-phase.ps1 -Phase light  -Rps 100 -Runs 10
./scripts/run-phase.ps1 -Phase medium -Rps 50  -Runs 10
./scripts/run-phase.ps1 -Phase hard   -Rps 20  -Runs 10
```

### Max RPS (<500ms) — sweep the target RPS

"Max RPS under 500ms" = the highest `-Rps` at which the averaged **P95 duration
stays below 500ms**. Increase `-Rps` until the run reports p95 ≥ 500ms; the last
passing value is your Max RPS for that phase. A few quick single passes first
(use `-Runs 1`) to bracket it, then confirm with `-Runs 10`:

```powershell
./scripts/run-phase.ps1 -Phase medium -Rps 100 -Runs 1   # p95 < 500? go higher
./scripts/run-phase.ps1 -Phase medium -Rps 200 -Runs 1   # p95 >= 500? go lower
./scripts/run-phase.ps1 -Phase medium -Rps 150 -Runs 10  # confirm the ceiling
```

---

## 4. Phase definitions

| Phase | What the script does |
|---|---|
| **light** | `GET /` only — static landing page, no auth, no DB. |
| **medium** | `GET /menu`, then batch-fetches every image the page references (browser-like). |
| **hard** | Logs in (seeded user), browses `/menu`, then a full cart CRUD cycle: add → read cart → increment → decrement → remove (self-cleaning). |

Hard-phase credentials default to the seeded user
`frichardo@student.ciputra.ac.id` / `password`; override with
`-e AUTH_EMAIL=… -e AUTH_PASSWORD=…` if needed.

You can also run a phase manually without the orchestrator:

```powershell
docker compose -f monitoring/docker-compose.monitoring.yml run --rm `
  -e BASE_URL=http://web -e RPS=50 -e DURATION=30s k6 run /scripts/medium.js
```

---

## 5. Useful PromQL (Prometheus UI / Grafana)

```promql
# RAM idle (read at rest)
container_memory_usage_bytes{name="mealbook_app"}

# Peak CPU over the last 5 minutes (cores), app + web combined
max_over_time(sum(rate(container_cpu_usage_seconds_total{name=~"mealbook_app|mealbook_web"}[15s]))[5m:5s])

# Peak RAM over the last 5 minutes (bytes)
max_over_time(container_memory_usage_bytes{name="mealbook_app"}[5m])
```

---

## 6. Results template

Fill in the average of 10 runs per phase.

| Metric | Light | Medium | Hard |
|---|---|---|---|
| Cold start (s) | | | |
| RAM idle (MB) | | | |
| Peak CPU (cores) | | | |
| P95 TTFB (ms) | | | |
| Max RPS (<500ms) | | | |
| Deployment size (MB) | | | |

> Cold start and deployment size are build-level (not phase-specific) — the same
> value applies across columns unless you change the image/build between phases.

---

## 7. Teardown

```powershell
docker compose -f monitoring/docker-compose.monitoring.yml down          # keep data
docker compose -f monitoring/docker-compose.monitoring.yml down -v       # wipe prom/grafana data
```

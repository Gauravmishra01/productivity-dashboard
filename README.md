# Factory AI Productivity Dashboard

A full-stack web application that processes AI-generated CCTV activity data from a factory, stores it in a database, and converts it into meaningful productivity metrics. It tracks worker activity, workstation utilisation, and overall factory performance to help management monitor efficiency and make data-driven operational decisions.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Running the Project](#running-the-project)
- [Database Schema](#database-schema)
- [Metric Definitions](#metric-definitions)
- [Assumptions and Tradeoffs](#assumptions-and-tradeoffs)
- [Theoretical Design Questions](#theoretical-design-questions)

---

## Architecture Overview

### Edge → Backend → Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│                        FACTORY FLOOR                        │
│                                                             │
│  [Camera 1]  [Camera 2]  ...  [Camera N]                    │
│       │           │                │                        │
│       └─────────────────────────────                        │
│                     │                                       │
│             ┌───────────────┐                               │
│             │  Edge Device  │  (Jetson / Raspberry Pi)      │
│             │  AI Model     │  Pose estimation, activity    │
│             │  runs locally │  classification, counting     │
│             └───────┬───────┘                               │
└─────────────────────┼───────────────────────────────────────┘
                       │  POST /api/events  (JSON over HTTP)
                       ▼
          ┌────────────────────────┐
          │      Backend API       │  Node.js + Express
          │  - Deduplication       │  Port 3001
          │  - Validation          │
          │  - Metric computation  │
          └────────────┬───────────┘
                       │
                  ┌────┴────┐
                  │  SQLite  │  (Prisma ORM)
                  │  dev.db  │
                  └────┬────┘
                       │  GET /api/metrics
                       ▼
          ┌────────────────────────┐
          │    Next.js Frontend    │  Port 3000
          │  - Live dashboard      │
          │  - Worker table        │
          │  - Factory KPIs        │
          └────────────────────────┘
```

**Edge Device** — A low-power compute unit (e.g. NVIDIA Jetson) co-located with each camera cluster. It runs the CV/AI model locally to classify worker activity (`working`, `idle`) and count units. Results are batched and forwarded to the backend over HTTP, enabling operation even during intermittent connectivity.

**Backend API** — An Express server that receives events, deduplicates them via a composite unique key, persists them to SQLite, and computes derived metrics on demand.

**Dashboard** — A Next.js frontend that polls the API, displays per-worker utilisation/output, and provides an admin control to reseed test data.

---

## Running the Project

### Local (no Docker)

```bash
# Terminal 1 — Backend
cd backend
npm install
npx prisma db push      # first run only — creates dev.db
npm start               # http://localhost:3001

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev             # http://localhost:3000
```

Click **"Reset & Seed Data"** on the dashboard to populate with generated data.

### Docker

```bash
docker compose up --build
```

The compose file mounts `./backend/prisma` as a volume so `dev.db` survives container restarts.

---

## Database Schema

```
Worker
├── id          UUID (PK)
├── worker_id   String (unique) — e.g. "W1"
└── name        String

Workstation
├── id          UUID (PK)
├── station_id  String (unique) — e.g. "S1"
└── name        String

Event
├── id             UUID (PK)
├── timestamp      DateTime          — when the activity was observed
├── worker_id      String → Worker
├── workstation_id String → Workstation
├── event_type     String            — "working" | "idle" | "product_count"
├── confidence     Float             — model confidence score (0–1)
├── count          Int?              — units counted (product_count events only)
└── created_at     DateTime          — when the record was inserted

Unique constraint: (worker_id, timestamp, event_type)
Index: timestamp
```

**Three event types:**

| event_type      | Meaning                                             |
|-----------------|-----------------------------------------------------|
| `working`       | Worker classified as actively working               |
| `idle`          | Worker classified as idle / away                    |
| `product_count` | Instantaneous unit-count reading from the AI model  |

---

## Metric Definitions

All metrics are computed in [`backend/src/metrics.ts`](backend/src/metrics.ts) at query time.

| Metric | Definition |
|---|---|
| **Active Time** | Sum of seconds between consecutive `working` → next state-change events |
| **Idle Time** | Sum of seconds between consecutive `idle` → next state-change events |
| **Utilisation %** | `active_time / (active_time + idle_time) × 100` |
| **Units Produced** | Sum of `count` across all `product_count` events for the worker |
| **Units / Hour** | `units / (active_time / 3600)` — productivity rate during active periods |
| **Factory Utilisation** | Arithmetic mean of all workers' utilisation % |
| **Total Shift Units** | Sum of units across all workers |

**Duration logic:** `product_count` events are instantaneous measurements and are excluded from the duration calculation. Only `working` and `idle` events form the timeline used to compute active/idle time.

---

## Assumptions and Tradeoffs

| Area | Decision | Tradeoff |
|---|---|---|
| **Database** | SQLite for simplicity | Zero-config, single-file persistence; not suitable for concurrent writes at scale — swap for PostgreSQL in production |
| **Metric computation** | Computed at query time (no pre-aggregation) | Simple and always up-to-date; becomes slow with millions of events — add materialised views or a time-series store for production |
| **Event deduplication** | Unique constraint on `(worker_id, timestamp, event_type)` | Prevents duplicates on retry; edge must send a consistent timestamp per reading |
| **Authentication** | None | Suitable for internal LAN deployment behind a firewall; add JWT/API keys for internet exposure |
| **Frontend polling** | Manual fetch on load + seed button | Simple; production would use WebSockets or server-sent events for live updates |
| **Activity duration** | Computed from gaps between consecutive state events | Assumes events are emitted at regular intervals; long gaps (e.g. camera offline) would inflate idle time |

---

## Theoretical Design Questions

### 1. Handling Intermittent Connectivity, Duplicate Events, and Out-of-Order Timestamps

**Intermittent Connectivity**
The edge device buffers events locally (e.g. in a local SQLite or queue file) when the backend is unreachable. On reconnect it replays the buffer. The backend `/api/events` endpoint is idempotent — repeated submission of the same event is safe due to the `upsert` on the unique key.

**Duplicate Events**
The `Event` table enforces a composite unique constraint on `(worker_id, timestamp, event_type)`. The API uses Prisma's `upsert` — if the record already exists it is a no-op (`update: {}`), so replaying the same event batch any number of times has no side-effects.

**Out-of-Order Timestamps**
Events are stored with their original `timestamp` (the observation time, not the ingestion time). The metrics engine always fetches events `ORDER BY timestamp ASC` and processes them in observation order, so late-arriving events naturally slot into the correct position. The `created_at` column records ingestion time separately if audit trails are needed.

---

### 2. Model Versioning, Drift Detection, and Retraining Triggers

**Model Versioning**
Each event payload includes a `model_version` field (e.g. `"v1.2.0"`). The `Event` table stores this so every metric can be traced back to the model that produced it. A `ModelRegistry` table records the version, deployment date, and validation metrics. Dashboards can filter by version to compare pre/post-deployment performance.

```
ModelRegistry
├── id           UUID
├── version      String     — "v1.2.0"
├── deployed_at  DateTime
├── accuracy     Float      — validation accuracy at release
└── notes        String
```

**Drift Detection**
A background service (cron or streaming) monitors two signals:

- *Confidence drift* — a rolling average of `confidence` scores across events. A sustained drop (e.g. 7-day mean falls below a threshold) indicates the model is less certain, often caused by environmental changes (lighting, new PPE).
- *Distribution drift* — the ratio of `working` : `idle` events per worker per shift. A sudden shift outside historical norms (e.g. 3 σ) may indicate model mis-classification rather than a real behavioural change.

Alerts are raised via a webhook or email when thresholds are breached.

**Retraining Triggers**
Retraining is triggered automatically when:
1. Confidence drift falls below threshold for N consecutive days.
2. A human reviewer flags a batch of events as mis-classified (active learning loop).
3. A scheduled periodic retrain (e.g. monthly) regardless of drift.

New labelled data is accumulated in a `LabelledSample` store. A CI/CD pipeline trains, validates against a holdout set, and gates deployment on accuracy ≥ baseline. The `ModelRegistry` is updated on success.

---

### 3. Scaling from 5 Cameras → 100+ Cameras → Multi-Site

**5 Cameras (current architecture)**
A single edge device, one backend instance, SQLite. Handles tens of events per second comfortably. Total cost: one small server and a laptop.

**100+ Cameras (single-site scale-out)**
- Replace SQLite with **PostgreSQL** (supports concurrent writes, proper indexing).
- Add a **message queue** (e.g. RabbitMQ or Kafka) between edge devices and the backend. Edge devices publish events; the backend consumes asynchronously. This decouples ingestion from processing and absorbs traffic spikes.
- Run **multiple backend instances** behind a load balancer (Node.js is stateless, so horizontal scaling is straightforward).
- Pre-aggregate metrics into a `DailyWorkerSummary` table via a nightly job to keep dashboard queries fast.

```
Edge Devices (×N)
      │  publish
      ▼
  Kafka Topic: factory.events
      │  consume
      ▼
 Backend Consumer Pool
      │
  PostgreSQL
      │
 Dashboard API (read replicas)
```

**Multi-Site**
- Each site runs its own **edge + regional backend + database** cluster (data sovereignty, low latency).
- A **central aggregation service** pulls summary data from each regional backend on a schedule (e.g. hourly) into a global data warehouse (e.g. ClickHouse or BigQuery).
- The global dashboard queries the warehouse for cross-site comparisons; site dashboards query their local backend for real-time data.
- Auth is federated (SSO) so plant managers see only their site while executives see all.

```
Site A: Edge → Kafka → Backend → PostgreSQL
Site B: Edge → Kafka → Backend → PostgreSQL   ──→  Global Warehouse → Executive Dashboard
Site C: Edge → Kafka → Backend → PostgreSQL
```

Key additions at multi-site scale: tenant isolation (all schemas include `site_id`), network resilience (sites operate independently if the WAN link drops), and centralised model distribution (the model registry pushes updated weights to all edge devices simultaneously).

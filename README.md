# ReachInbox – Email Job Scheduler

A production-style email scheduler: **Express + TypeScript + BullMQ/Redis + Postgres + Elasticsearch + Ethereal SMTP**, with a **React + Tailwind** dashboard, real **Google login** and a real **Slack OAuth** integration.

No cron anywhere – every email is a **BullMQ delayed job**.

```
reachinbox-scheduler/
├── docker-compose.yml      # Redis (AOF), Postgres, Elasticsearch
├── backend/                # Express API + BullMQ worker
└── frontend/               # Vite + React + Tailwind dashboard
```

## 1. Quick start

Prereqs: Node 18+, Docker.

```bash
docker compose up -d            # Redis, Postgres, Elasticsearch

# Backend
cd backend
cp .env.example .env            # fill in Google (and Slack) credentials, see §3
npm install
npm run dev                     # API on :4000, worker runs inside the API process

# Frontend (new terminal)
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Open http://localhost:5173 → **Sign in with Google** → dashboard.

**Run the worker separately (to scale out):** set `RUN_WORKER_IN_API=false` in `.env`, run `npm run dev` for the API and `npm run worker` (any number of times) for workers. All limits are Redis-backed, so multiple workers are safe.

**BullMQ dashboard:** http://localhost:5173/admin/queues (or :4000/admin/queues), basic auth `ADMIN_USER` / `ADMIN_PASS` (default `admin`/`admin`).

## 2. Ethereal Email (fake SMTP)

Nothing to set up by hand. On first boot the backend calls `nodemailer.createTestAccount()` `SENDER_COUNT` times (default 3) and stores the credentials in the `senders` table. Emails are assigned to senders **round-robin**. Every sent email gets a **preview** link in the Sent tab (opens the message on ethereal.email). The backend needs outbound internet for this step.

## 3. Environment variables (`backend/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `APP_URL` | `http://localhost:5173` | Public origin of the frontend; OAuth redirect URIs are `APP_URL/auth/google/callback` and `APP_URL/auth/slack/callback` |
| `JWT_SECRET` | – | Signs session cookie + Slack OAuth state |
| `DATABASE_URL`, `REDIS_URL`, `ELASTICSEARCH_URL` | local docker | Infra |
| `GOOGLE_CLIENT_ID/SECRET` | – | Google OAuth |
| `SLACK_CLIENT_ID/SECRET` | – | Slack OAuth |
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Min gap between sends (BullMQ limiter) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Hard per-sender hourly ceiling |
| `SENDER_COUNT` | `3` | Ethereal senders created on first boot |
| `RUN_WORKER_IN_API` | `true` | Embed worker in API process |

### Google OAuth setup
1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID (Web)**.
2. Authorized redirect URI: `http://localhost:5173/auth/google/callback`.
3. Put the client ID/secret in `.env`.

### Slack OAuth setup (live notifications)
Slack requires **https** redirect URLs, so tunnel the frontend:
1. `ngrok http 5173`, then set `APP_URL=https://<your-subdomain>.ngrok-free.app` in `.env` and open the app via that URL. (Add the same URL + `/auth/google/callback` to Google's redirect URIs too.)
2. https://api.slack.com/apps → **Create app** → *From scratch*.
3. **OAuth & Permissions**: add redirect URL `https://<tunnel>/auth/slack/callback`, add the bot scope **`incoming-webhook`**.
4. **Incoming Webhooks**: toggle on.
5. Copy Client ID/Secret into `.env`, restart the backend.
6. In the dashboard click **Connect Slack**, pick a channel, authorize. Use **Send test** to verify the live link.

## 4. Architecture

```
React ──/api──▶ Express ──INSERT──▶ Postgres (source of truth)
                  │ addBulk(jobId = email id, delay)         ▲
                  ▼                                          │ status updates
               Redis (BullMQ delayed jobs + rate counters) ──▶ Worker(s) ──SMTP──▶ Ethereal
                  │                                          │
                  └──────────────────────────────────────────┴──▶ Elasticsearch (index), Slack (webhook)
```

### How scheduling works
`POST /api/emails/schedule` validates the payload (zod), inserts one row per recipient in Postgres (single transaction), then enqueues one BullMQ job per row with `delay = scheduled_at - now` and `jobId = <email uuid>`. Recipient *i* is scheduled at `start + i × delayBetween`. No cron: Redis holds the timers; workers wake when jobs become due.

### Persistence on restart
- Jobs live in Redis (AOF enabled in docker-compose), not in process memory – restart the API/worker and delayed jobs are still there.
- Postgres is the source of truth. On every boot `reconcile()` finds rows still `scheduled/processing` that have **no live BullMQ job** (Redis wiped, crash between DB commit and enqueue) and re-creates them. Since `jobId == email id`, this cannot duplicate.

### Idempotency (no double sends)
1. `jobId = email id` – BullMQ ignores adding a second job with the same id (completed jobs are retained 1h; older ones are protected by the next guard).
2. Worker skips rows already `sent`/`failed`.
3. **Atomic claim**: `UPDATE … SET status='processing' WHERE id=$1 AND status='scheduled' RETURNING` – only one worker can win. A `processing` row is only re-claimable after 2 minutes (crashed worker / stalled job).
4. Stable SMTP `Message-ID` derived from the row id.

Trade-off: the exact-once guarantee is "at most once per claim"; if a worker dies *after* SMTP accepted the message but *before* the DB update, the stale-claim path could resend after 2 minutes. This is the inherent SMTP/DB two-phase gap; the stable Message-ID makes such a duplicate detectable.

### Concurrency & minimum delay
- `WORKER_CONCURRENCY` jobs run in parallel per worker (safe thanks to the atomic claim + Redis counters).
- **Minimum delay between sends: 2 seconds** (`MIN_DELAY_BETWEEN_EMAILS_MS`), enforced with BullMQ's `limiter: { max: 1, duration: 2000 }`, which is shared across all workers on the queue. The per-campaign "delay between emails" from the UI additionally spaces `scheduled_at` values.

### Hourly rate limiting (per sender, multi-worker safe)
- Redis counters keyed `rl:{senderId}:{hourWindow}`.
- A **Lua script** atomically finds the first hour window (from now onward) whose counter is below the limit, increments it, and returns `(window, position)`. Being one Redis script, concurrent workers/instances can never over-allocate.
- Limit = the campaign's hourly limit clamped to `MAX_EMAILS_PER_HOUR_PER_SENDER` (both configurable, nothing hardcoded).
- If the current hour is full the job is **not dropped or failed**: it is moved to the next window with capacity via `job.moveToDelayed(window_start + position × minDelay)`, its `scheduled_at` is updated in the DB (visible in the UI), and the reserved window is stored in job data so retries/restarts don't reserve twice. The position offset preserves FIFO-ish order and prevents a thundering herd at the top of the hour.
- Trade-off: slots are reserved when a job first runs, so a failed send still consumes its slot (conservative, never exceeds the limit).

### Behaviour under load (1000+ emails at the same time)
All 1000 jobs become due together; the BullMQ limiter drains them at one per 2 s while `reserveSlot` hands out hour slots. With a limit of 200/hour/sender and 3 senders, ~600 go in the current hour (respecting the limiter), the rest are pushed into following windows in order, with no failures and no loss. One Slack message per (user, sender, hour) is sent – not 1000.

### Slack notification on rate-limit hit
Real OAuth v2 flow (`/api/slack/connect` → Slack → `/auth/slack/callback`) stores the incoming-webhook URL per user. When a sender's hourly limit is hit, the backend POSTs to that webhook (deduped per sender/hour with a Redis `SET NX`). If Slack isn't connected the notification is simply skipped (no crash, dedupe key released); connecting later works immediately, no redeploy. Disconnect deletes the installation.

### Elasticsearch
Emails are bulk-indexed when scheduled and re-indexed on every status change (best effort – ES outages never block sending). The dashboard search box queries ES (`multi_match` on to/subject/body, per-user filter); if ES is down it transparently falls back to Postgres `ILIKE`.

## 5. Features implemented

**Backend**
- Scheduler: Express API, Postgres storage, BullMQ delayed jobs, no cron ✅
- Persistence: Redis AOF + Postgres source of truth + boot-time reconcile ✅
- Idempotency: jobId, status guards, atomic claim ✅
- Multiple senders (Ethereal, round-robin) ✅
- Worker concurrency (configurable) ✅
- Min delay between sends (BullMQ limiter, configurable) ✅
- Hourly rate limit per sender (Redis + Lua, configurable, reschedules instead of dropping) ✅
- Slack OAuth + live rate-limit notifications ✅
- Elasticsearch indexing + search ✅
- Live BullMQ dashboard (Bull Board) ✅
- Retries with exponential backoff (3 attempts) ✅

**Frontend**
- Real Google OAuth login/logout, header with name/email/avatar ✅
- Dashboard with Scheduled / Sent tabs, "Compose New Email" ✅
- Compose modal: subject, body, CSV/text upload with detected-count, start time, delay, hourly limit ✅
- Tables with loading, empty and error states, status badges, live polling (5s), search ✅
- Reusable UI components, typed API client, toasts ✅
- Connect / disconnect Slack, send test message ✅

## 6. API

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/google`, `/auth/google/callback` | Google OAuth |
| POST | `/auth/logout` | |
| GET | `/api/me` | current user |
| POST | `/api/emails/schedule` | `{subject, body, recipients[], startTime, delayBetweenMs, hourlyLimit?}` |
| GET | `/api/emails/scheduled?q=` | scheduled + processing |
| GET | `/api/emails/sent?q=` | sent + failed |
| GET | `/api/slack/connect` | starts Slack OAuth |
| GET | `/api/slack/status`, DELETE `/api/slack`, POST `/api/slack/test` | |
| GET | `/admin/queues` | Bull Board (basic auth) |

## 7. Testing the restart guarantee
1. Schedule a few emails ~2 minutes ahead.
2. Stop the backend (Ctrl+C), wait, start it again.
3. They still send at the scheduled time, exactly once (check Bull Board + Sent tab + Ethereal previews).
4. To test limits, run with `MAX_EMAILS_PER_HOUR_PER_SENDER=3`, `SENDER_COUNT=1`, schedule 10 recipients: 3 go out now, the rest show new `scheduled_at` values in the next hours and a Slack message arrives.

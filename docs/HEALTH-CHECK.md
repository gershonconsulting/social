# Collection Health Check — social.gershonCRM.com

A server-side **dead man's switch** that emails a human when Radar-style post
collection silently stops. Port of the reusable runbook in
[`gershonconsulting/radar` → `HEALTH-CHECK-ALERTS.md`](https://github.com/gershonconsulting/radar/blob/main/HEALTH-CHECK-ALERTS.md).
Radar is the reference implementation; this is the social.gershonCRM.com port.

## Why

The primary collection path is the Chrome extension running in a logged-in
browser. When it dies (browser closed, signed out, cookies expired, extension
disabled), collection stops silently — and a broken collector can't report
itself. This watchdog runs **independently** on a GitHub Actions cron, checks a
freshness signal, and emails **only when collection has stalled**. Silence =
healthy.

## How it maps to the runbook

| Runbook decision | social.gershonCRM.com value |
|---|---|
| **Freshness signal** | `max(social_posts.createdAt)` platform-wide (ingest time) |
| **"Is it set up?" guard** | ≥1 active client with an enabled, linked `PlatformConnection` |
| **STALE_HOURS** | `36` (env `HEALTH_STALE_HOURS`) — tolerates one missed day |
| **REALERT_HOURS** | `20` (env `HEALTH_REALERT_HOURS`) — one outage ≈ one email/day |
| **Recipients** | `HEALTH_ALERT_TO` → `DIGEST_TO` → `oattia@gmail.com` (comma-sep ok) |
| **Email transport** | Resend (`RESEND_API_KEY`), from `HEALTH_ALERT_FROM`→`DIGEST_FROM` |
| **Throttle memory** | `settings` row `health_alert_at` (no schema change) |
| **Auth** | `Bearer CRON_SECRET \| DIGEST_SECRET \| HEALTH_SECRET` (POST only) |
| **Schedule** | GitHub Actions cron `0 14 * * *` (`.github/workflows/health-check.yml`) |

## Endpoint — `/api/cron/health-check`

- `GET` → preview the computed status as JSON (read-only, **never sends**).
- `GET ?preview=email` → render the alert email HTML with live numbers (**never sends**) — for QA.
- `POST` (with `Authorization: Bearer <secret>`) → run the check; send an alert **only if** stale and not recently alerted. This is what the cron calls.

`sent: 0` is the normal, healthy result. An email in your inbox means *act now*.

## Test

```bash
# 1. Read live status (no auth, no send):
curl -s https://social.gershoncrm.com/api/cron/health-check | jq

# 2. Eyeball the alert email (no send):
open "https://social.gershoncrm.com/api/cron/health-check?preview=email"

# 3. Exercise the real send path (needs the secret) — GitHub → Actions →
#    "Collection Health Check" → Run workflow. To force a real email while
#    testing, temporarily set HEALTH_STALE_HOURS=0 in the Cloudflare Pages env.
```

## Config (all optional; sane defaults)

`HEALTH_STALE_HOURS`, `HEALTH_REALERT_HOURS`, `HEALTH_ALERT_TO`,
`HEALTH_ALERT_FROM`, `HEALTH_SECRET`. Reuses existing `RESEND_API_KEY`,
`CRON_SECRET`/`DIGEST_SECRET`, `DIGEST_TO`/`DIGEST_FROM`.

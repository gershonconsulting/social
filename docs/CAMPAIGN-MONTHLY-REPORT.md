# Campaign monthly report — API, share links, month-end email

Shipped in **v3.1.0**. Scope is fixed to companies with `clientType = CAMPAIGN`
that are not archived. Nothing in this feature ever reports on a CLIENT,
PROSPECT, PARTNER, INTERNAL, COMPANY, COMPETITION or RECYCLED company.

## The objective

**One post per day.** A calendar day counts as **met** when at least one of
that company's tracked platforms published that day. Posting to LinkedIn and
X on the same day is one day met, not two — the commitment is a post per day,
not a post per platform per day.

This is a different basis from `/api/campaigns/attainment`, which counts every
(platform, day) cell separately. Both are correct for what they measure; this
one is the basis for anything sales-facing.

### Where the numbers come from

| basis | meaning |
|---|---|
| `compliance` | Verified from `DailyCompliance` — the expected days are the schedule the platform actually enforced, and a met day is a GREEN row. |
| `derived` | `DailyCompliance` had no rows for that company/month, so objective days were inferred from the company's `PostingSchedule` (EVERY_DAY → all days, WORKING_DAYS → Mon–Fri, CUSTOM_WEEKDAYS → the configured weekdays, CUSTOM_TARGET → the target count) and met days from distinct `SocialPost.publishedDateLocal`. |

Every company in every response carries its `basis`, and the per-company
document says so on the page. A derived number is a real number, but it has
not been through compliance verification — do not present it as audited.

## 1. The API

```
GET https://social.gershoncrm.com/api/campaigns/monthly
Header: X-API-Key: <CAMPAIGN_API_KEY>
```

Same key as `/api/campaigns/attainment`. Keep it server-side; never call this
from a browser.

| Param | Default | Meaning |
|---|---|---|
| `month` | the month that just closed | `YYYY-MM` |
| `slug` | all campaigns | one company |
| `detail` | lean | `full` adds per-platform split, missed dates, best post |

### The five key data points

Per company, and identically in `totals`:

| Field | Meaning |
|---|---|
| `postsPublished` | Posts published in the month |
| `objectiveDays` | Days the company was expected to post |
| `daysMet` | Days at least one post went out |
| `daysMissed` | `objectiveDays − daysMet` |
| `attainmentPct` | `daysMet / objectiveDays`, one decimal, `null` when nothing was expected |

`totalEngagement` (likes + comments + shares) ships alongside as context, and
`previous` repeats the same five for the prior month so a consumer can render
a trend without a second call.

`attainmentPct` is `null`, never `0`, when no days were expected — a company
with nothing scheduled has not failed its objective.

### Example

```bash
curl -s https://social.gershoncrm.com/api/campaigns/monthly?month=2026-07 \
  -H "X-API-Key: $CAMPAIGN_API_KEY"
```

```jsonc
{
  "success": true,
  "data": {
    "apiVersion": 1,
    "month": "2026-07",
    "monthLabel": "July 2026",
    "objective": "One post per day",
    "scope": "clientType=CAMPAIGN, not archived",
    "totals": { "companies": 10, "postsPublished": 187, "objectiveDays": 230,
                "daysMet": 174, "daysMissed": 56, "attainmentPct": 75.7,
                "totalEngagement": 8213, "previousAttainmentPct": 71.2 },
    "companies": [
      { "slug": "wallix", "name": "WALLIX",
        "postsPublished": 31, "objectiveDays": 23, "daysMet": 22,
        "daysMissed": 1, "attainmentPct": 95.7,
        "totalEngagement": 1147, "status": "ON_TARGET", "basis": "compliance",
        "previous": { "attainmentPct": 88.5, "...": "..." },
        "shareUrl": "https://social.gershoncrm.com/r/9f2c…" }
    ],
    "shareUrl": "https://social.gershoncrm.com/r/1a4b…"
  }
}
```

`status` is a convenience band on `attainmentPct`: `ON_TARGET` ≥ 95,
`AT_RISK` ≥ 80, `BELOW_TARGET` below that, `NO_DATA` when it is null.

`apiVersion` is the contract. The five field names above will not change
shape without it being bumped.

## 2. The share link

```
https://social.gershoncrm.com/r/<token>[?month=YYYY-MM]
```

Tokens are **permanent** and live in `settings.campaign_report_tokens`:

- one `all` token → every campaign company on one page
- one token per company → that company only, safe to hand to the client

No login. Possession of the token is the authorization, the page is
`noindex`, and an unknown token returns a generic 404 that reveals nothing.
Default view is the month that just closed; `?month=` walks back through
history on the same link.

**PDF:** the page has a *Save as PDF / Print* button with a print stylesheet
(A4, 10mm margins, chrome hidden). Cloudflare Workers have no PDF engine, so
this — not a server-generated attachment — is the PDF path.

To revoke a link, delete its entry from the `campaign_report_tokens` JSON in
the `settings` table; the next report build issues a fresh one.

## 3. The month-end email

Recipient: `CAMPAIGN_REPORT_TO`, default **sales@gershonconsulting.com**.
Sent on the **1st**, covering the month that just closed:

1. one **summary** email — every campaign company as a row, RAG status, trend vs the prior month
2. one **per-company** email — the one-pager for that company, with its own permanent link

```
GET  /api/cron/campaign-monthly-report                       → JSON preview, never sends
GET  /api/cron/campaign-monthly-report?preview=email         → the summary document
GET  /api/cron/campaign-monthly-report?preview=email&slug=x  → one company's document
POST /api/cron/campaign-monthly-report                       → send  (Bearer CRON_SECRET)
     ?month=YYYY-MM   ?force=1 (resend a month)   ?dry=1 (skip Resend)
```

### What triggers it

The **daily digest** (`POST /api/digest/daily`, already on cron at 13:00 UTC)
calls the sender when `UTC day == 1`. There is no separate monthly workflow
file, because the deploy PAT has no GitHub `workflow` scope and cannot push
one — the same constraint that left the health-check workflow pending.

Safety: `settings.campaign_report_sent` records each month that has gone out,
so every later call that day (and every day after) is a no-op. The send is
also wrapped so that a failure inside it cannot fail the daily digest. If the
summary email fails outright the month is *not* marked sent, so tomorrow's
digest retries it.

If a dedicated schedule is preferred later, add
`.github/workflows/campaign-monthly-report.yml` via the GitHub UI:

```yaml
name: Campaign monthly report
on:
  schedule:
    - cron: '0 14 1 * *'   # 14:00 UTC on the 1st = 10:00 ET
  workflow_dispatch:
jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - name: Send campaign monthly report
        run: |
          curl -sS -X POST https://social.gershoncrm.com/api/cron/campaign-monthly-report \
            -H "Authorization: Bearer ${{ secrets.CF_CRON_SECRET }}" \
            --fail-with-body
```

The digest piggyback stays harmless if this is added — whichever fires first
marks the month sent and the other becomes a no-op.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `CAMPAIGN_API_KEY` | falls back to `TEST_API_KEY` | already set by `deploy.yml` |
| `CAMPAIGN_REPORT_TO` | `sales@gershonconsulting.com` | only needed to change the recipient |
| `CRON_SECRET` | — | already set |
| `RESEND_API_KEY`, `DIGEST_FROM` | — | already set, shared with the daily digest |

No new secrets are required to run this feature.

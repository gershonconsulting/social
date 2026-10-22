# Social report e-mails — notes (nightly 2026-10-22, branch `nightly/2026-10-22-social-report-fixes`)

Kept here, not in the root HANDOFF.txt, because PR #2 edits HANDOFF.txt tonight.
No version bump: package.json and src/lib/extension-version.ts are changed by PR #2
(e-mails carry no visible app version except the footer commit hash).

## What was wrong (read from the real Resend mails of 16–21 Oct 2026)

| Mail | Problem | Cause |
|---|---|---|
| Daily digest "Report social.gershonCRM.com <date> — N posts collected" | "Top posts" listed a Meteor Biotech post from 1 Apr 2024; per-company counts mixed in back-filled posts | Posts were selected by **ingestion** time (`createdAt`), not publish time. The ingest route also stamps `new Date()` when a page shows no date. |
| Social Collection Report (20 Oct) | "✓ System healthy" with 155 failed attempts (+812%) | Status looked only at post counts. |
| Weekly posting check (week 12–16 Oct) | WALLIX 0/5 though WALLIX later showed 5 posts on Wed 14 Oct | Not a client-id mismatch: both mails use the same id `cmp0eqlsx000dbqj3hmvwldbe` (canonical 212 Wallix). Three faults: (1) days bucketed by `publishedDateLocal`, which every ingest path fills with the **UTC** date; (2) the alert (Fri 19:20 ET) judged days the collector had not re-read: WALLIX's CEO profile was only re-collected on 21 Oct (13 posts at once); (3) the objective assumed 5/5 while WALLIX's Settings objective is 3/week. |
| All three | White text on red / charcoal header bands | Readability. |

## What changed

- `src/lib/reports/digest-window.ts` (new, pure): buckets each ingested post into **window** (published in the last 24h), **older** (back-fill) or **unknown** (no / invalid / future date, or publish time ≥ createdAt − 2 min = stamped at ingestion).
- `src/lib/reports/digest-render.ts` (new, pure): digest HTML + subject moved out of the route. Counts, per-company table and top posts use the window only. A separate "Also collected — not counted as last 24h" section lists older and unknown-date posts. Subject keeps its prefix: `Report social.gershonCRM.com <date> — N posts published in the last 24h from M companies (K collected incl. older)`.
- `src/app/api/digest/daily/route.ts`: uses the two modules above. Sending, recipients and sender unchanged.
- `src/lib/reports/collection-health.ts` (new, pure): **degraded** when failed attempts ≥ 50, or ≥ 2× the average of the 7 days before AND at least +20. Otherwise healthy; no heartbeat = unknown (old verdict kept).
- `src/lib/reports/daily-report.ts` / `daily-report-render.ts`: an "ok" status with degraded failures becomes "⚠ Degraded — 155 failed collection attempts (+…% vs the usual …)"; subject `⚠️ Social Collection Report — <date> — collection degraded: N failed attempts`. "✓ System healthy" only shows when failures are normal.
- `src/lib/alerts/days.ts` (new, pure): New York day keys/boundaries, `judgeDays()` (pending vs missed, "N of the days" cadence).
- `src/lib/alerts/posting-alerts.ts`: posts bucketed by New York day of `publishedAtUtc`; last-read time per company (max `social_posts.updatedAt`, or `lastSyncAt` of an enabled connection without error); Settings posts-per-week objective (`posting_objectives`, read-only) for working-day schedules. New fields: `pendingDates`, `flexible`, `perWeek`, `lastReadAt`, `totals.daysPending`.
- `src/lib/alerts/send.ts`: a healthy result with pending days does not close the period, so the weekend run re-checks.
- `src/lib/alerts/render.ts`: grey "not collected yet" chips, cadence note, "last collected <date>", and a "Not judged yet" line instead of listing such companies as on target.
- `src/lib/email/report-header.ts` (new): white header card, #CC3333 left border, #1d1d1f text, table-based (Outlook-safe). Used by the three templates above, which also move from #FE1B04 to #CC3333.

## Tests

`npx tsx --test tests/report-logic.test.ts`: 22 tests (date window incl. the 2024 post, health thresholds incl. the 155-failure day, New York bucketing incl. DST, WALLIX pending/cadence cases). `npx tsc --noEmit` clean.

## Known limits / next

- Compliance-basis rows (`daily_compliance`) are still judged as before (no pending logic); none of the campaign companies used it in the 12–16 Oct mail.
- Ingest still stores `new Date()` when a post has no date (`publishedAtUtc` is NOT NULL). The digest now labels those as unknown; the weekly check may still count such a post on its collection day. A proper fix needs a nullable column or a flag (schema change, separate PR).
- `publishedDateLocal` stays a UTC date for every other screen; only the posting alert now uses New York days.
- The "week" alert is still due from Friday 20:00 UTC (dueAlerts). Friday is now "not collected yet" in that run; the weekend digest fallback re-checks because a period with pending days is not closed.
- Ops reports in `src/lib/reports/ops/*` and the monthly report were not touched (same header helper can be applied there).
- Not verified against production data: no read access to the production DB from the nightly box; the WALLIX diagnosis is from the two mails + code. To confirm after deploy: GET /api/cron/posting-alert?kind=week (read-only JSON) shows `pendingDates`, `perWeek` and `lastReadAt` per company.

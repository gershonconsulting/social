# Friday client reports (v4.78.0)

Olivier, 2026-11-13: three reports per client every Friday, built from the social content
collected for the client — **Intelligence, Competitive, Company**. Built and sent by the app
(not by Claude).

| E-mail | What it shows |
|---|---|
| Company report | The client's own LinkedIn/X posts of the last 7 full ET days vs the week before: posts, engagement, topics, hashtags, best posts (linked) |
| Competitive report | Client vs competitors linked in Competitor Watch: share of voice, rank, topic mix, keyword gaps/owned words, best competitor posts |
| Intelligence report | Insights + next-week actions (Promote / Network / Engage), each with "Based on"; Cloudflare Workers AI llama-3.3-70b, cached per client per day, rule-based fallback |

- Who: active CAMPAIGN + CLIENT companies of Gershon's (primary) workspace.
- Recipient: for review only — Setting `friday_reports_to` (comma list), else env `FRIDAY_REPORT_TO`, else olivier@gershonconsulting.com. Never the client. Audit Bcc social@ as every app e-mail.
- Subject: `Social.gershon.ai — <Client> — <Type> report (week of Nov 7 – Nov 13)`.
- Report Friday (v4.78.5): every run belongs to the latest Friday (ET) on or before the day it runs; the week is the Friday–Thursday before it. A late cron, a Saturday re-run or a manual run all give the same week and subject.
- Idempotent (v4.78.5): Setting `friday_reports_sent`, key `<kind>:<clientId>:<report Friday>`, plus Resend `Idempotency-Key: social-client-<clientId>-<kind>-<report Friday>`. A second run reports "already sent". `force=1` re-sends on purpose. Code: `src/lib/reports/friday/once.ts`.
- Schedule: `.github/workflows/friday-reports.yml` — Fridays 19:00 UTC (14:00 EST) + one-off Sat 2026-11-14 19:00 UTC (that line re-sent the whole pack on Nov 14; it cannot fire again in 2026 and its guard skips other years; since v4.78.5 any extra run only reports "already sent"). One request per client.
- API: `GET /api/report/friday?list=1`, `GET ?client=<id>&kind=company|competitive|intelligence` (preview, signed-in or cron Bearer), `POST ?client=<id>[&force=1][&to=]` (cron Bearer).
- Code: `src/lib/reports/friday/*`, tests `tests/friday-reports.test.mts`, `tests/friday-once.test.mts`.

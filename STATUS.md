# Social (social.gershon.ai) — STATUS

Last updated: 2026-11-18

## Deploy route
Push / merge to `claude/social-campaign-verification-jiG5E` (the default branch) → `.github/workflows/deploy.yml` → Cloudflare Pages `gershoncrm-social`.
Commits with `[skip-db-push]` in the message skip `prisma db push` (code-only changes).
Live check: `GET https://social.gershon.ai/api/ping` → `commit` = deployed SHA, `build` = run number.

## Current — v4.79.3 (Friday pack sent-marker retry)
- ✅ v4.79.3 PR #38 merged 2026-11-18 (c339136, approved by Olivier "All 10"): Friday pack sent-marker write retried 3x (`once.ts`); tsc clean, `npm test` all suites green (friday-once 22/22); LIVE 12:51Z (ping commit c339136)

## Previous — v4.79.1 (version sync)
- v4.79.1 (nightly/2026-11-17-social-version): APP_VERSION constant (footer "App v…") was 4.78.6 while package.json was 4.79.0; both now 4.79.1, guarded by `tests/app-version.test.mts` (first step of `npm test`). Note: the "v0.27.0" on the home page is the Chrome EXTENSION version ("Chrome extension v0.27.0"), not the app version — correct as is ✅

## Previous — v4.78.5 (open: v4.78.6 Resend retry)
- v4.78.6 (PR #34, merged 2026-11-16, live): every report/alert Resend send retries 429/5xx/network 3x (1s/4s/10s) with the same Idempotency-Key, 4xx not retried, final failure logged (`src/lib/resend-send.ts`, `tests/resend-retry.test.mts`) ✅
- v4.78.5 (PR #33, merged 2026-11-15): Friday client reports once per client per report Friday. The pack went out twice on Nov 14 (00:17Z = Fri ET run, 22:48Z = the one-off Saturday cron) because the sent-marker was keyed on the ET day the job ran. Now pinned to the report Friday (`src/lib/reports/friday/once.ts`) + Resend Idempotency-Key; test `tests/friday-once.test.mts` ✅
- v4.78.3 released 2026-11-14 night push (Olivier: "Do them, release them. I test tomorrow everything."):
  - PR #29 — one shared count for every Social report (digest, Collection Report, Competitive report: `countCollected`, ET day of collection, deduped); footer = source + day definition + freshness; subjects say social.gershon.ai ✅
  - PR #26 — brand red #FE1B04 (dark #d11200, tint #fff5f5) across UI, e-mails and reports ✅
  - PR #31 — one app version in the UI; 0.26.0 labelled "Chrome extension v0.26.0"; dashboard footer "App v… · commit …" ✅
  - Checks: tsc ✅, `npm test` 6 suites all passing (run with TZ=UTC, as CI) ✅; next build: runs in the deploy workflow
- PR #19 closed (replaced by #24 / #29) ✅
- v4.78.0 Friday client reports — live (build 489) ✅. See docs/FRIDAY-REPORTS.md.
- v4.77.1 dead "Still missing today" entry removed from Settings → Reports ✅
- v4.73.0 e-mail subjects `Social.gershon.ai — <Company> — <Type> report` ✅

## Open ❌
- Resend retry not yet on the LinkedIn sign-out alert (`api/extension/linkedin-session`) and `workspaces/import-radar-competitors` ❌
- `.github/workflows/friday-reports.yml`: remove the spent one-off line `0 19 14 11 *` + guard step, add `concurrency: friday-reports` (the nightly GitHub App has no `workflows` permission; harmless meanwhile; exact edit in PR #38 body) ❌
- E-mail sender name — open decision for Olivier (unchanged tonight) ❌
- #18 v4.70.0 Actions (per-workspace competitive report to client admins) ❌
- #20 v4.71.0 Settings → Reports ❌
- GET /api/report/ops?kind=… previews readable without sign-in ❌
- `src/lib/reports/et-days.ts` tzOffsetMs parses locale strings: the "DST end day is 25 hours" test fails when the process TZ is America/New_York (passes in UTC = CI/Cloudflare). Harden with Intl formatToParts ❌

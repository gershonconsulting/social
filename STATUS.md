# Social (social.gershon.ai) — STATUS

Last updated: 2026-11-14 (night push)

## Deploy route
Push / merge to `claude/social-campaign-verification-jiG5E` (the default branch) → `.github/workflows/deploy.yml` → Cloudflare Pages `gershoncrm-social`.
Commits with `[skip-db-push]` in the message skip `prisma db push` (code-only changes).
Live check: `GET https://social.gershon.ai/api/ping` → `commit` = deployed SHA, `build` = run number.

## Current — v4.78.3
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
- E-mail sender name — open decision for Olivier (unchanged tonight) ❌
- #18 v4.70.0 Actions (per-workspace competitive report to client admins) ❌
- #20 v4.71.0 Settings → Reports ❌
- GET /api/report/ops?kind=… previews readable without sign-in ❌
- `src/lib/reports/et-days.ts` tzOffsetMs parses locale strings: the "DST end day is 25 hours" test fails when the process TZ is America/New_York (passes in UTC = CI/Cloudflare). Harden with Intl formatToParts ❌

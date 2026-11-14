# Social (social.gershon.ai) — STATUS

Last updated: 2026-11-13

## Deploy route
Push / merge to `claude/social-campaign-verification-jiG5E` → `.github/workflows/deploy.yml` → Cloudflare Pages `gershoncrm-social`.
Production deploys need Olivier's explicit full-sentence OK.

## Current
- Live: v4.73.0 (16108b9, deployed 2026-11-09 ~18:05 ET, build 480).
- v4.73.0 — PR "E-mail subjects + sender" (branch `feat/email-subjects-sender`):
  - Subjects: `Social.gershon.ai — <Company> — <Type> report` (Company, Client, Competitive, Campaign, Partner, Posting, Intelligence…) ✅ code
  - Sender name on every e-mail: `Social.gershon.ai` (was "GC Social" / "Social · Gershon.AI") ✅ code
  - Client-facing monthly company report Bcc report@gershonconsulting.com ✅ (already in place)
  - Tests: `npm test` (incl. tests/email-subject.test.mts) ✅, tsc ✅, next build ✅
  - Deployed ✅ — live previews show the new subjects

- [19] "still missing today" e-mail removed (PR #23); dead module `src/lib/reports/missing-today.ts` deleted 2026-11-10 (cleanup PR, no version bump, no behaviour change) ✅
- v4.77.1 (PR nightly/2026-11-11-social-settings-cleanup): dead "Still missing today" entry removed from Settings → Reports (9 reports + 2 alerts) ✅ code, not deployed
- v4.77.3 (branch nightly/2026-11-13-social-one-count): digest, Collection Report and Competitive report count with ONE function (countCollected, ET day of collection, deduped); fixes Collection headline off by 10h (76 vs 20 for Nov 10); footer = source + day definition + freshness; subjects say social.gershon.ai ✅ code, not merged/deployed

- v4.78.0 Friday client reports (branch `feat/friday-reports-v4.78.0`): Company + Competitive + Intelligence per CAMPAIGN/CLIENT company, to Olivier for review, Fridays 14:00 EST + one-off Sat 2026-11-14 14:00 EST (`friday-reports.yml`). Tests 18/18 ✅, tsc ✅, next build ✅. Deploy ❌ (needs Olivier's OK). See docs/FRIDAY-REPORTS.md.

## Open PRs (not deployed) ❌
- #18 v4.70.0 Actions (per-workspace competitive report to client admins — must get the new subject/sender + report@ Bcc when merged)
- #19 nightly 2026-11-07 collection counts / subject format
- #20 v4.71.0 Settings → Reports

## Known issues
- GET /api/report/ops?kind=… previews readable without sign-in ❌

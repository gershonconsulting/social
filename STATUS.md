# Social (social.gershon.ai) — STATUS

Last updated: 2026-11-09

## Deploy route
Push / merge to `claude/social-campaign-verification-jiG5E` → `.github/workflows/deploy.yml` → Cloudflare Pages `gershoncrm-social`.
Production deploys need Olivier's explicit full-sentence OK.

## Current
- Live: v4.70.0 line (default branch).
- v4.73.0 — PR "E-mail subjects + sender" (branch `feat/email-subjects-sender`):
  - Subjects: `Social.gershon.ai — <Company> — <Type> report` (Company, Client, Competitive, Campaign, Partner, Posting, Intelligence…) ✅ code
  - Sender name on every e-mail: `Social.gershon.ai` (was "GC Social" / "Social · Gershon.AI") ✅ code
  - Client-facing monthly company report Bcc report@gershonconsulting.com ✅ (already in place)
  - Tests: `npm test` (incl. tests/email-subject.test.mts) ✅, tsc ✅, next build ✅
  - Deploy ❌ (needs Olivier's OK)

## Open PRs (not deployed) ❌
- #18 v4.70.0 Actions (per-workspace competitive report to client admins — must get the new subject/sender + report@ Bcc when merged)
- #19 nightly 2026-11-07 collection counts / subject format
- #20 v4.71.0 Settings → Reports

## Known issues
- GET /api/report/ops?kind=… previews readable without sign-in ❌

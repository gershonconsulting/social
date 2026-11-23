# Social (social.gershon.ai) — STATUS

Last updated: 2026-11-23

## Deploy route
Push / merge to `claude/social-campaign-verification-jiG5E` (the default branch) → `.github/workflows/deploy.yml` → Cloudflare Pages `gershoncrm-social`.
Commits with `[skip-db-push]` in the message skip `prisma db push` (code-only changes).
Live check: `GET https://social.gershon.ai/api/ping` → `commit` = deployed SHA, `build` = run number.

## Current — v4.82.0 (on top of v4.81.0 #42) (report bundling: fewer emails)
- ✅ Olivier 2026-11-23 "Too many reports … consolidate" → option 1. Setting `report_bundling` (default on; "off" = old separate emails; `?separate=1` per call).
- ✅ Daily brief: POST /api/report/daily sends ONE email = Collection + Posting + Competitive + Intelligence + Digest (each section only if due in Settings → Reports), alerts banner (collection, extension, LinkedIn signed out). To = union of the five reports' recipients (report@, sales@, Aina). Sections fetched from their own GET endpoints (own Worker request each). Idempotent per ET day (`daily_brief_sent` + Resend key). `src/lib/reports/bundle/*`.
- ✅ Digest POST no longer emails (section of the brief); its fallback sends the brief; it also flushes an unsent Friday pack the day after.
- ✅ LinkedIn sign-out email skipped for Gershon's workspace (banner in the brief + extension voice); other workspaces unchanged.
- ✅ Friday: each ?client= call stages a row in `friday_pack:<Friday>`; the call completing the list sends ONE pack (per client: numbers + 3 report links). ?flush=1 manual. Was 3 emails × 14 clients.
- ✅ Monthly: all category reports in ONE email, every PDF attached (was 8). Client company reports unchanged.
- ✅ Weekly/monthly posting alerts to social@ default OFF (Social Tracking's Monday weekly + monthly cover them); switch back on in Settings.
- ✅ Unchanged: client workspace Competitive (Fridays, review hold), monthly client reports + Bcc, collection-stalled alert.
- tests/bundle.test.mts; tsc + npm test + next build green.

## Previous — v4.81.0 (fewer emails)
- ✅ v4.81.0 (Olivier 2026-11-14 "Too many emails sent. Review and re organize the emails from this platform"): from ~80 emails a week to ~26.
  - Daily: ONE email — Social Collection Report (keeps the "collector did not run" alarm). Posting, Competitive, Intelligence and Digest now default to WEEKLY (Monday). `src/lib/reports/settings.ts` defaults; a frequency saved in Settings → Reports still wins.
  - Friday client pack: ONE email per client ("Client report" = Company + Competitive + Intelligence stacked) instead of three — 45 → 15. `combineFridayHtml` / `fridayPackSubject` in `friday/pack.ts`, `sendFridayPack` in `friday/send.ts`; same sent-marker + idempotency key as the old Company email. Previews stay one page per report.
  - tsc + npm test green (new `tests/friday-pack.test.mts` 5/5).
- ❌ Still several separate Monday emails (Posting, Competitive, Intelligence, Digest) — could become one "Monday pack".

## Previous — v4.80.2 (digest says "No collection")
- ✅ v4.80.2 (nightly 2026-11-20): internal daily digest no longer looks like a quiet day when nothing was collected. Headline + subject: "⚠ No collection on <day> — 0 posts (collector did not run / collector failed: N runs, F failed, 0 stored; top error …)". New "Collection status" block on every digest: heartbeat runs/attempted/stored/failed, last successful collection date, profiles missing X of 120 with top reasons, top current collection errors. Normal-day subject unchanged. `src/lib/reports/digest-headline.ts`, `tests/digest-headline.test.mts`; tsc + npm test green.
- ❌ Separate "⛔ NO COLLECTION" mail NOT merged: it is the daily Social Collection Report itself (scorecard + links to fix); dropping it on bad days would lose that. Both now carry the same verdict.
- ❌ Root cause of the 0-post days: collector runs (11-18: 13 runs, 20 failed) but LinkedIn harvest reads nothing ("LinkedIn layout changed again" / "no posts found"), extension 0.27.0 — needs a new extension release with updated LinkedIn selectors (live DOM needed). Report sends land ~7-8h after their cron time (digest cron 13:00Z, sent ~21:10Z) — check Actions schedule.

## Previous — v4.80.1 (GC sender on internal emails)
- ✅ v4.80.1 (nightly 2026-11-19): emails whose To/Cc are ALL Gershon addresses (gershonconsulting.com / gershon.ai) go out as "GC Social" (was "Social.gershon.ai") and Talking Points relay mails as "GC Talking Points" (was "Talking Points"). Any client recipient → sender unchanged. Address never changes. One hook: `internalSender()` in `src/lib/email/sender.ts`, applied in `withAuditBcc()`. `tests/internal-sender.test.mts`; tsc + npm test green.
- ❌ Subjects still carry no task/report number: no number is assigned to Social's reports in any registry — Olivier to assign.

## Open ❌
- Resend retry not yet on the LinkedIn sign-out alert (`api/extension/linkedin-session`) and `workspaces/import-radar-competitors` ❌
- `.github/workflows/friday-reports.yml`: remove the spent one-off line `0 19 14 11 *` + guard step, add `concurrency: friday-reports` (the nightly GitHub App has no `workflows` permission; harmless meanwhile; exact edit in PR #38 body) ❌
- E-mail sender name: internal-only emails now "GC Social" (v4.80.1, audit option "GC + number for internal only"); client emails still "Social.gershon.ai"; subject numbers not assigned yet ❌
- #18 v4.70.0 Actions (per-workspace competitive report to client admins) ❌
- #20 v4.71.0 Settings → Reports ❌
- GET /api/report/ops?kind=… previews readable without sign-in ❌
- `src/lib/reports/et-days.ts` tzOffsetMs parses locale strings: the "DST end day is 25 hours" test fails when the process TZ is America/New_York (passes in UTC = CI/Cloudflare). Harden with Intl formatToParts ❌

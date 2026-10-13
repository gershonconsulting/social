# Moving a gershoncrm.com app to gershon.ai: playbook

Proven on **Social** (social.gershoncrm.com → social.gershon.ai), 2026-10-12, app v4.43.0 / extension 0.18.0.
Use it as-is for client, dash, finance, pulse, roi, task, radar… Each app takes about half a day. Nothing goes dark during the move.

## The principle
- **Both addresses run on the same Cloudflare Pages project.** The old one is never removed.
- **Pages on the old address 308-redirect** to the same path on the new one, so bookmarks, emailed links and share links keep working.
- **`/api/*` keeps answering on the old address.** Old extensions, GitHub scheduled jobs and other Gershon apps calling this API keep working. The exception is `GET /api/auth/*`, which also redirects so a sign-in starts and ends on the same host.
- **One file holds the address** (`src/lib/site.ts`). It ignores a stale `NEXT_PUBLIC_APP_URL` that still names the old domain, because Pages secrets only reach the *next* deployment.

## Before you start (5 min check)
| Check | How | Social result |
|---|---|---|
| gershon.ai zone is in the same Cloudflare account as the Pages project | Cloudflare → Domains | ✅ both in Oattia@gmail.com's account |
| Pages project name | `.github/workflows/deploy.yml` → `--project-name` | `gershoncrm-social` |
| Where the old domain is hard-coded | `grep -rn "<app>.gershoncrm.com"` over src, extension-src, .github, scripts | 41 files |
| OAuth apps with a registered return URL (LinkedIn, Google…) | grep `redirect_uri` | LinkedIn app 787cqonyq6vpd0 only |
| Companion Chrome extension? | `extension-src/manifest.json` | yes, so it needs a new version |
| Other apps calling this one's API | grep the other repos | client.gershoncrm.com → social API (stays on old host, still works) |
| Repo can be pushed from the session | attach repo to the session (push access) | ✅ after attaching |

## Steps, in this order

### 1. Attach the domain in Cloudflare (browser, ~2 min) ✅ tested
Workers & Pages → `<project>` → **Custom domains** → *Set up a custom domain* → `<app>.gershon.ai` → *Activate domain*.
Cloudflare creates the CNAME `<app> → <project>.pages.dev` itself (the zone is in the same account). It shows "Verifying / Complete DNS setup" for a few minutes even though the record already exists. Check under gershon.ai → DNS → Records, then wait. Live within ~5 min for Social.
**Test:** `https://<app>.gershon.ai/` answers 200 and serves the same app.

### 2. Register the new OAuth return URL (LinkedIn developer portal) ✅ tested
App → Auth → *Authorized redirect URLs* → add `https://<app>.gershon.ai/api/auth/linkedin/callback`, keeping the old one. Olivier did this himself for Social; adding a second URL **did persist** this time.
**Test:** `GET /api/auth/linkedin/login` on the new host → the Location header has `redirect_uri=https://<app>.gershon.ai/...`, and following it reaches LinkedIn's sign-in page, not the "redirect_uri does not match" error.

### 3. Code (Claude, one commit)
1. **`src/lib/site.ts`**: `SITE_HOST`, `SITE_ORIGIN`, `LEGACY_HOSTS`, `siteUrl()` (copy from social).
2. Replace every `process.env.NEXT_PUBLIC_APP_URL || "https://<old>"` and every `const SITE = "https://<old>"` with `siteUrl()`. Replace the remaining literal old-domain text (emails, reports, UI copy) with the new one.
3. **`src/middleware.ts`**: add `legacyRedirect()`. On a legacy host, pages (GET/HEAD) and `GET /api/auth/*` → 308 to the new host. Everything else passes. Widen the `matcher` to `/((?!_next/static|_next/image).*)`.
4. **`.github/workflows/deploy.yml`**: `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` → new origin. **Every other workflow**: cron URLs → new origin.
5. **Extension** (if any): manifest `host_permissions` and `content_scripts.matches` list **both** hosts (new first); every API origin in the JS → new host; bump the version, `EXTENSION_LATEST`, and release notes. Social gotcha: some files (content.js, popup.js, sync-core.js, background.js) lived only inside the committed zip. Copy them into `extension-src/` so the build overrides them, then check the built zip contains no old domain.
6. Bump the app version (package.json + APP_VERSION). Add `.env.example` notes.

**Tests before push** ✅ all passed for Social:
- `tsc --noEmit`, `npx @cloudflare/next-on-pages` build
- middleware unit test (7 cases): old `/dashboard?a=1` → 308 new with query; old `/r/<token>` → 308; old `GET /api/auth/linkedin/login` → 308; old `POST /api/extension/ingest` → passes; old `/api/cron/*` → passes; new `/dashboard` → passes; new `/api/clients` unauthenticated → 401
- `node scripts/build-extension.mjs`, then unzip: version bumped, both hosts in the manifest, no old domain in any JS
- Do not commit the locally rebuilt zips or package-lock changes from `npm ci`

### 4. Ship (push → GitHub Actions → Pages, ~3 min) ✅ tested
Push to the deploy branch, then watch the run.

### 5. Live verification ✅ all passed for Social
| Test | Expected |
|---|---|
| old `/`, `/login`, `/dashboard?x=1`, `/r/<token>`, `/<ext>.zip` | 308 → same path on new host |
| old `GET /api/auth/linkedin/login` | 308 → new host |
| old `/api/extension/version`, `/api/report/*`, `/api/campaigns/*`, `/api/cron/*` | same code as on the new host (200/401/405), **no** redirect |
| new `/`, `/login` | 200; `/dashboard` logged out → 307 /login on the new host |
| new `/api/extension/version` | new extension version |
| new `/api/auth/linkedin/login` | redirect_uri = new host; `li_login_state` cookie set on new host |
| live extension zip | new version, both hosts, no old domain in JS |
| manually run one scheduled workflow (e.g. health-check) | log shows `HTTP 200` from the new URL |
| real sign-in in the browser from the OLD /login | lands on new /login → LinkedIn sign-in page (no redirect_uri error) → after the password, /dashboard on the new host |

### 6. After the deploy
- **Everyone signs in once again.** Cookies don't cross domains, and each sign-in lands on the new host.
- **Extension:** browsers still on the old version keep collecting and publishing (their stored token calls the old-host API, which still answers). They show the red "not installed / out of date" strip on the new host until reloaded at the new version. Social: the local folder `watchman-chrome-extension` was refreshed to 0.18.0; Charles reloads it in each Chrome (chrome://extensions → ↻).
- **Never delete the old custom domain** from Pages, or old emailed links and old extensions break.
- Optional later: switch other apps that call this API to the new host.

## Per-app notes for the next moves
- **company.gershoncrm.com** is on Genspark, not Pages, so step 1 differs (new CNAME to Genspark + its own domain setting).
- Apps with no LinkedIn sign-in skip step 2.
- Apps whose API is called by another app (social ← client): keep `/api/*` open on the old host (the middleware rule does this).
- Batch order suggestion: dash, roi, task (simple) → pulse, finance → client (consumes others) → radar (extension).

## Social move status
- ✅ social.gershon.ai attached and live (Cloudflare Pages, CNAME auto-created)
- ✅ LinkedIn return URL for social.gershon.ai registered (Olivier)
- ✅ v4.43.0 / extension 0.18.0 shipped (commit eb2ff8c), all stage tests passed
- ✅ scheduled jobs run against social.gershon.ai (health-check HTTP 200)
- ✅ local extension folder refreshed to 0.18.0
- ❌ Olivier's first real sign-in on social.gershon.ai (needs his LinkedIn password; the LinkedIn step is verified up to the password page)
- ❌ Charles reloads the extension at 0.18.0 in each Chrome that collects or publishes

# Daily operations reports (v4.49.0, Intelligence v4.50.0)

Four separate emails to report@gershonconsulting.com every morning at 08:00 ET,
from "GC Social <reports@gershon.ai>". All are features of the app (no Claude task).

| # | Email | Question it answers | Route |
|---|-------|---------------------|-------|
| 1 | Social Collection Report | Is the Chrome extension collecting? (heartbeat, volume, extension version) | `/api/report/daily` |
| 2 | Social Posting Report | Did every campaign / internal company post? 7-day grid vs its posts-per-week target, missed/failed publishes | `/api/report/ops?kind=posting` |
| 3 | Social Content Ready Report | Approved content ready per company, days covered (target 7), runs-out date, drafts / with client / changes | `/api/report/ops?kind=content` |
| 5 | Social Intelligence Report (to **sales@gershonconsulting.com**) | Cloudflare Workers AI reads the week's competitor/partner posts and gives insights, actions per our company, posts to engage with, post ideas. Cached per day; rule-based fallback | `/api/report/ops?kind=intelligence` |
| 4 | Social Competitive Report | Competitor + partner posts collected per day (7 d) and per week (4 wk), topics, format, hashtags, words, top posts, per company | `/api/report/ops?kind=competitive` |

- GET = preview in the browser, `&format=json` = numbers. POST = send (Bearer CRON_SECRET).
- Schedule: `.github/workflows/daily-report.yml` POSTs `/api/report/daily`, which sends #1 and then chains #2–#4 (`?only=1` sends #1 alone).
- Each email is idempotent per ET day (`settings.ops_reports_sent`); `?force=1` resends, `?to=` redirects for testing.
- Code: `src/lib/reports/ops/{shell,posting,content,competitive,index}.ts`.

## v4.70.0 — Actions, for every workspace

Olivier, 2026-11-04: "The social competitive report is a great tool. We should have that for all users on social.gershon.ai. How can we turn this knowledge into actions?"

- **Action cards** (`src/lib/actions/*`): every day's Intelligence run becomes cards in the three campaign pillars — **Promote** (post on what works for competitors or on what they leave out), **Network** (reach out to the people/partners behind it), **Engage** (comment on / share the posts that matter). Stored per workspace in OrgSetting `intel_actions` (no schema change). Stable id per day + text, so re-runs never duplicate and statuses survive.
- **One click**: the Competitive email (and the Intelligence email to sales@) carries `Draft it` / `✓ Done` / `Dismiss` under every action. Done/Dismiss are signed links (`/api/report/action`, HMAC with NEXTAUTH_SECRET — no sign-in needed, one card, one status). `Draft it` opens **/actions** (new menu item), where Intelligence writes the post / comment / note, the user edits, copies, or — for a campaign/internal company's post — **Send to Publish** (creates a DRAFT ContentItem; same database, validated in Publish).
- **Results**: "Last week's actions — what happened" in the email and on /actions — suggested / done / dismissed per pillar, and for each action marked done, the company's posts and engagement per post in the 7 days after it vs its usual week.
- **Every workspace**: the morning cron (`/api/report/daily` → `sendOps`) now also sends each other workspace that watches ≥1 competitor/partner its own Competitive report with its own actions, to that workspace's ADMIN users, from "Social by Gershon.AI <reports@gershon.ai>". Each workspace is built in its own request (`POST /api/report/ops?kind=competitive&workspace=<orgId>`). Client workspaces get no links to Gershon's internal reports, an AI prompt framed around their own company, and their own Intelligence cache (`ops_intel:v3:<orgId>:<day>`).
- **Setup**: /welcome step 3 now needs **at least 3 competitors** (default category Competitor); /actions shows the same nudge.
- Browser preview `GET /api/report/ops?kind=…` shows the signed-in user's own workspace (no session = Gershon's, as before).
- Test: `NEXTAUTH_SECRET=x npx tsx --tsconfig tests/tsconfig.test.json tests/actions.test.mts`.

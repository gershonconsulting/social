# Daily operations reports (v4.49.0)

Four separate emails to report@gershonconsulting.com every morning at 08:00 ET,
from "GC Social <reports@gershon.ai>". All are features of the app (no Claude task).

| # | Email | Question it answers | Route |
|---|-------|---------------------|-------|
| 1 | Social Collection Report | Is the Chrome extension collecting? (heartbeat, volume, extension version) | `/api/report/daily` |
| 2 | Social Posting Report | Did every campaign / internal company post? 7-day grid vs its posts-per-week target, missed/failed publishes | `/api/report/ops?kind=posting` |
| 3 | Social Content Ready Report | Approved content ready per company, days covered (target 7), runs-out date, drafts / with client / changes | `/api/report/ops?kind=content` |
| 4 | Social Competitive Report | Competitor + partner posts collected per day (7 d) and per week (4 wk), topics, format, hashtags, words, top posts, per company | `/api/report/ops?kind=competitive` |

- GET = preview in the browser, `&format=json` = numbers. POST = send (Bearer CRON_SECRET).
- Schedule: `.github/workflows/daily-report.yml` POSTs `/api/report/daily`, which sends #1 and then chains #2–#4 (`?only=1` sends #1 alone).
- Each email is idempotent per ET day (`settings.ops_reports_sent`); `?force=1` resends, `?to=` redirects for testing.
- Code: `src/lib/reports/ops/{shell,posting,content,competitive,index}.ts`.

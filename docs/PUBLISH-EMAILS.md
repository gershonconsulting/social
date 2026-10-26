# Publish — email catalogue (v4.65.0 Social / v0.4.0 Publish, 2026-10-26)

Rule (Olivier, 2026-10-26): every Publish email says it comes from **publish.gershon.ai**,
carries a **number**, and has **direct links** into the platform to validate the content.
Two families: **1xx = client emails**, **2xx = internal emails**. Code: `src/lib/publishing-mail.ts`
(identical in the social and publish repos).

- From (internal): `"GC Publish · publish.gershon.ai" <publish@gershon.ai>`
- From (client):   `"Gershon Consulting · publish.gershon.ai" <publish@gershon.ai>`
- Reply-To: social@gershonconsulting.com · BCC audit copy: social@gershonconsulting.com
- Subject starts with the number: `[PUB-201] Content inventory: …`
- Header + footer name publish.gershon.ai, the number and Client/Internal; every link opens publish.gershon.ai
  on the right client (`?client=`) and post (`?item=`). Client review pages: `publish.gershon.ai/review/<token>`.

| No. | Audience | Email | Direct link |
|---|---|---|---|
| PUB-101 | Client | New post to review | client review page |
| PUB-102 | Client | Batch of posts to review | client review page |
| PUB-103 | Client | Autopilot month to validate | client review page |
| PUB-104 | Client | Reminder: posts waiting for approval (after 2 days) | client review page |
| PUB-105 | Client | New version of your post | client review page |
| PUB-106 | Client | New reply on your post review | client review page |
| PUB-201 | Internal | Content inventory (daily, 08:50 NY) | per client: Validate in Publish + Client review page |
| PUB-202 | Internal | Validated — ready for publishing | each post + calendar |
| PUB-203 | Internal | Client commented on a post | the post |
| PUB-204 | Internal | Client asked for changes | the post |
| PUB-205 | Internal | Scheduled post did not go out | the post (calendar) |
| PUB-206 | Internal | Post may not have gone out | the post (calendar) |
| PUB-207 | Internal | Post failed to publish (Chrome extension) | the post (calendar) |
| PUB-208 | Internal | Post failed to publish (connected account) | Connections |
| PUB-209 | Internal | Network signed out — posts on hold | calendar |
| PUB-210 | Internal | Autopilot rewrote posts from comments | Publishing |
| PUB-211 | Internal | Autopilot could not schedule posts | Connections |

PUB-101/102/103 go to the team (labelled Internal, same number) when the company has no reviewer.
Never reuse or renumber a code. The jobs that send these still run from Social's scheduled workflows
(publishing-daily, publish-sweep, autopilot) until the cron cutover; the emails already identify Publish.

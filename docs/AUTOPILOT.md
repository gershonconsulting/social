# Publishing Autopilot + Knowledge Base (v4.51.0)

Olivier, 2026-10-18: "autopilot social content publishing for our internal companies",
"one month of content every 20th of the previous month, one post per day", and
"the 3 components of a good campaign: value proposition, what the competition posts, the ICP".

## Knowledge Base — `/knowledge-base`
Per Publishing company (CAMPAIGN + INTERNAL), stored in OrgSetting `kb:<clientId>`:
1. **Value Prop** — text.
2. **Competitive Landscape** — positioning notes + a LIVE snapshot of what the competitors
   (Competitor Watch links; for Gershon with no links, the workspace COMPETITION companies)
   post about: themes, key words, gaps, their best posts.
3. **ICPs** — several per company.
"Draft with Intelligence" (Cloudflare Workers AI, llama-3.3-70b) fills a section; AI drafts are
tagged until edited. Code: `src/lib/knowledge-base.ts`, `/api/knowledge-base[/<clientId>]`.

## Autopilot — `/publishing/autopilot`
For INTERNAL companies (default ON in a workspace that has a Gershon INTERNAL company).
- From the **20th**, the whole **next month** is written: one post per day (LinkedIn text,
  X version ≤ limit, one AI picture — flux-1-schnell), each for one ICP in rotation, using the
  value prop and competitor data. Before the 20th: the rest of the current month from 3 days out.
- Month complete → every post sent for review (review link per company) and ONE email to the
  team address (Publishing settings alert email, else first admin).
- Unanswered for **48h** → approved automatically. "Ask for changes" → AI rewrites from the
  comment and resubmits.
- Approved → scheduled on its own day at **09:30 New York**; existing Publishing pipeline posts
  it (Chrome extension) and the 15-min sweep checks it went out. Never two posts on one day.
- Autopilot companies get a 7/week objective (unless set by hand) so the inventory board matches.
- Planned day = `ContentItem.scheduledAt` of the draft; autopilot posts have `createdBy = "Autopilot"`.

Runs: `.github/workflows/autopilot.yml` daily 11:15 UTC, POSTs `/api/cron/autopilot`
(Bearer CRON_SECRET) until `remaining = 0` (≤ 3 posts per call). "Run now" on the page does the same.
Code: `src/lib/autopilot.ts`.

## Needs to be true for posts to actually go out
- Each internal company has its LinkedIn page + X handle in Publishing → Accounts (the Autopilot
  page shows a red "set LinkedIn/X" otherwise, and the team gets one email a day).
- The publishing Chrome browser is online and signed in to LinkedIn and X.

# Deployment Guide — social.gershonCRM.com

## Architecture Overview

```
social.gershoncrm.com
        ↓ CNAME
gershoncrm-social.pages.dev  (Cloudflare Pages — Next.js)
        ↓ DATABASE_URL
Neon / Supabase PostgreSQL (managed)
        ↓ daily cron
/api/cron/daily-sync  (called by cron-job.org or CF Cron Trigger)
```

---

## Step 1 — Database Setup

Use [Neon](https://neon.tech) (recommended — free tier, Postgres 16, serverless):

1. Create a project: `social-gershon-crm`
2. Copy the connection string (with `?sslmode=require`)
3. Set `DATABASE_URL` in Cloudflare Pages env vars

Alternative: [Supabase](https://supabase.com) works identically.

---

## Step 2 — Cloudflare Pages Setup

1. Go to **Cloudflare Dashboard → Pages → Create application**
2. Connect to GitHub: `gershonconsulting/social`
3. Branch: `claude/social-campaign-verification-jiG5E` (or `main` after merge)
4. Settings:
   - **Framework preset:** Next.js
   - **Build command:** `npm run build`
   - **Build output directory:** `.next`
   - **Node version:** `20`

### Environment Variables (set in Pages → Settings → Environment Variables)

```
DATABASE_URL          = postgresql://...?sslmode=require
NEXTAUTH_URL          = https://social.gershoncrm.com
NEXTAUTH_SECRET       = (openssl rand -base64 32)
CRON_SECRET           = (openssl rand -base64 24)
```

Add platform API keys once OAuth is configured:
```
LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
TWITTER_BEARER_TOKEN, TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
```

---

## Step 3 — Database Migration

After first deployment, run migrations from a local machine with `DATABASE_URL` set:

```bash
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

This creates:
- All tables and indexes
- Admin user: `admin@gershonconsulting.com` / `admin123`
- Ops user: `ops@gershonconsulting.com` / `ops123`
- Gershon Consulting client with 3 platform placeholders

**Change passwords immediately after first login.**

---

## Step 4 — Custom Domain

The DNS is already configured:
```
social.gershoncrm.com → CNAME → gershoncrm-social.pages.dev
```

In Cloudflare Pages → Custom domains → Add `social.gershoncrm.com`.
SSL is handled automatically by Cloudflare.

---

## Step 5 — Cron Jobs (Daily Sync)

### Option A: cron-job.org (free, simple)

1. Create account at [cron-job.org](https://cron-job.org)
2. Add two jobs:

| Job | URL | Schedule | Auth Header |
|-----|-----|----------|-------------|
| Daily Post Sync | `https://social.gershoncrm.com/api/cron/daily-sync` | `0 6 * * *` | `Authorization: Bearer <CRON_SECRET>` |
| Follower Snapshots | `https://social.gershoncrm.com/api/cron/follower-sync` | `0 7 * * *` | `Authorization: Bearer <CRON_SECRET>` |

### Option B: Cloudflare Workers (if using Pages Functions)

Add to `wrangler.toml`:
```toml
[[triggers]]
crons = ["0 6 * * *", "0 7 * * *"]
```

---

## Step 6 — Platform OAuth Connections

### LinkedIn

1. Go to [LinkedIn Developer Portal](https://developer.linkedin.com)
2. Create an app → add your company page
3. Request permissions: `r_organization_social`, `r_organization_followers`
4. Implement OAuth 2.0 token exchange (or use a tool like Postman)
5. Store the access token in the `PlatformConnection.tokenReference` field via the Admin UI

### X / Twitter

1. Go to [Twitter Developer Portal](https://developer.twitter.com)
2. Create a project + app (Basic tier minimum, Elevated preferred)
3. Generate a Bearer Token for app-only access
4. Store in `PlatformConnection.tokenReference`

### Google Business Profile

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable: My Business Account Management API, Business Profile Performance API
3. Create OAuth2 credentials
4. Complete OAuth flow → get refresh token
5. Store refresh token; implement token refresh in the adapter

---

## Step 7 — Gershon Consulting Backfill

After OAuth is connected:

1. Log in as admin at `https://social.gershoncrm.com`
2. Go to **Admin** → find Gershon Consulting
3. Click **Backfill** — this will sync posts from January 1, 2026
4. Go to **Reports** to verify monthly compliance data appeared

---

## Security Checklist

- [ ] Changed default admin password
- [ ] Changed default ops password
- [ ] `NEXTAUTH_SECRET` is random and secret
- [ ] `CRON_SECRET` is set and used in cron job headers
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require`)
- [ ] Platform tokens stored only in DB (never in code)
- [ ] Cloudflare proxy enabled (orange cloud) for social.gershoncrm.com

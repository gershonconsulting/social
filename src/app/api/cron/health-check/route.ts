export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus } from "@prisma/client";
import { resolveFrom } from "@/lib/email/sender";
import { siteUrl } from "@/lib/site";
import { withAuditBcc } from "@/lib/mail-bcc";
import { healthAlertHtml } from "@/lib/alerts/health-email";

/**
 * Collection health-check — a server-side "dead man's switch" for social.gershon.ai.
 *
 * Pattern & rationale: see gershonconsulting/radar → HEALTH-CHECK-ALERTS.md
 * (the reusable runbook). This is the social.gershon.ai port of it.
 *
 * WHY: The primary collection path is the Chrome extension running in a
 * logged-in browser. When it dies (browser closed, cookies expired, extension
 * disabled) collection silently stops — and a broken collector cannot report
 * itself. This watchdog runs independently on a GitHub Actions cron, checks a
 * freshness signal, and emails a human ONLY when collection has stalled. On
 * healthy days it sends nothing (silence = success).
 *
 * FRESHNESS SIGNAL: the most recent `social_posts.createdAt` across the whole
 * platform (row-creation = ingest time). This is the direct analog of Radar's
 * `max(targets.collected_date)`. If no post has landed in STALE_HOURS while the
 * platform is set up, something is broken.
 *
 * ROUTES:
 *   GET  /api/cron/health-check            — preview the computed status as JSON
 *                                            (read-only, NEVER sends). Handy for
 *                                            eyeballing staleness on demand.
 *   GET  /api/cron/health-check?preview=email
 *                                          — render the alert email HTML in the
 *                                            browser (does NOT send). For QA.
 *   POST /api/cron/health-check            — run the check; send an alert email
 *                                            ONLY if stale & not recently alerted.
 *                                            This is what the cron calls.
 *
 * AUTH (POST only): Authorization: Bearer <CRON_SECRET | DIGEST_SECRET | HEALTH_SECRET>.
 *
 * CONFIG (all optional, env-overridable):
 *   HEALTH_STALE_HOURS    default 36   — hours with no new post before "broken".
 *   HEALTH_REALERT_HOURS  default 20   — min gap between two alerts (anti-nag).
 *   HEALTH_ALERT_TO       default DIGEST_TO || "oattia@gmail.com" — comma-separated ok.
 *   HEALTH_ALERT_FROM     default = the verified gershon.ai sender (lib/email/sender).
 *   RESEND_API_KEY        required to actually send.
 *
 * THROTTLE MEMORY: `settings` row key = "health_alert_at" (ISO timestamp of the
 * last alert). Persisted so the throttle survives cold isolates.
 */

const VERSION = "health-check v1.0.0";
const THROTTLE_KEY = "health_alert_at";
const DASHBOARD_URL = siteUrl();
const REPLY_TO = "support@gershonconsulting.com";

function num(envVal: string | undefined, fallback: number): number {
  const n = envVal ? parseInt(envVal, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

interface HealthStatus {
  version: string;
  now: string;
  isSetUp: boolean;
  activeClients: number;
  enabledConnections: number;
  lastPostAt: string | null;
  hoursSinceLastPost: number | null; // null == never
  postsLast24h: number;
  erroringConnections: number;
  staleHours: number;
  realertHours: number;
  isStale: boolean;
}

async function computeStatus(): Promise<HealthStatus> {
  const staleHours = num(process.env.HEALTH_STALE_HOURS, 36);
  const realertHours = num(process.env.HEALTH_REALERT_HOURS, 20);
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [activeClients, enabledConnections, lastPost, postsLast24h, erroringConnections] =
    await Promise.all([
      prisma.client.count({ where: { status: ClientStatus.ACTIVE } }),
      // "Set up" = an active client has at least one enabled, actually-linked connection.
      prisma.platformConnection.count({
        where: {
          isEnabled: true,
          externalAccountUrl: { not: null },
          client: { status: ClientStatus.ACTIVE },
        },
      }),
      prisma.socialPost.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.socialPost.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.platformConnection.count({
        where: {
          isEnabled: true,
          lastSyncError: { not: null },
          client: { status: ClientStatus.ACTIVE },
        },
      }),
    ]);

  const lastMs = lastPost?.createdAt ? lastPost.createdAt.getTime() : 0;
  const hoursSinceLastPost = lastMs ? (now.getTime() - lastMs) / 3_600_000 : null;
  const isSetUp = enabledConnections > 0;
  // Stale only matters if the platform is actually set up. A never-collected
  // (hoursSinceLastPost === null) set-up platform is also stale.
  const isStale =
    isSetUp && (hoursSinceLastPost === null || hoursSinceLastPost >= staleHours);

  return {
    version: VERSION,
    now: now.toISOString(),
    isSetUp,
    activeClients,
    enabledConnections,
    lastPostAt: lastMs ? new Date(lastMs).toISOString() : null,
    hoursSinceLastPost: hoursSinceLastPost === null ? null : Math.round(hoursSinceLastPost * 10) / 10,
    postsLast24h,
    erroringConnections,
    staleHours,
    realertHours,
    isStale,
  };
}

function humanGap(hours: number | null): string {
  if (hours === null) return "never — no posts have ever been collected";
  if (hours < 48) return `about ${Math.round(hours)} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** The e-mail itself lives in lib/alerts/health-email.ts (house style, 2026-10-23). */
function alertHtml(s: HealthStatus): string {
  return healthAlertHtml(s, humanGap(s.hoursSinceLastPost), DASHBOARD_URL);
}

async function readLastAlertAt(): Promise<Date | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: THROTTLE_KEY } });
    return row?.value ? new Date(row.value) : null;
  } catch {
    return null;
  }
}

async function writeLastAlertAt(iso: string): Promise<void> {
  try {
    await prisma.setting.upsert({
      where: { key: THROTTLE_KEY },
      update: { value: iso },
      create: { key: THROTTLE_KEY, value: iso },
    });
  } catch {
    /* throttle write is best-effort */
  }
}

async function sendAlert(html: string, subject: string): Promise<{ ok: boolean; status?: number; error?: string; to?: string[] }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set in environment" };
  const to = (process.env.HEALTH_ALERT_TO || process.env.DIGEST_TO || "oattia@gmail.com")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const from = resolveFrom(process.env.HEALTH_ALERT_FROM);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(withAuditBcc({ from, to, reply_to: REPLY_TO, subject, html })),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, status: r.status, error: body.slice(0, 400), to };
    }
    return { ok: true, status: r.status, to };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), to };
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("preview") === "email") {
      // Render the alert email as it WOULD look, using live numbers (never sends).
      const s = await computeStatus();
      return new NextResponse(alertHtml(s), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const s = await computeStatus();
    return NextResponse.json({ success: true, wouldAlert: s.isStale, status: s });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "health-check failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Auth
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || process.env.HEALTH_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const s = await computeStatus();

    // (a) Not set up → nothing to watch, stay silent.
    if (!s.isSetUp) {
      return NextResponse.json({ ok: true, action: "skip", reason: "not-setup", sent: 0, status: s });
    }
    // (b) Healthy → silent (this is the normal, expected outcome).
    if (!s.isStale) {
      return NextResponse.json({ ok: true, action: "skip", reason: "healthy", sent: 0, status: s });
    }
    // (c) Throttle → don't re-nag within REALERT_HOURS.
    const lastAlert = await readLastAlertAt();
    if (lastAlert) {
      const sinceHrs = (Date.now() - lastAlert.getTime()) / 3_600_000;
      if (sinceHrs < s.realertHours) {
        return NextResponse.json({
          ok: true, action: "skip", reason: "recently-alerted",
          lastAlertAt: lastAlert.toISOString(), sent: 0, status: s,
        });
      }
    }
    // (d) Stale & not recently alerted → send + record.
    const gap = humanGap(s.hoursSinceLastPost);
    const subject = `⚠️ social.gershonCRM.com has stopped collecting — last post ${gap}`;
    const send = await sendAlert(alertHtml(s), subject);
    if (send.ok) await writeLastAlertAt(new Date().toISOString());

    return NextResponse.json(
      { ok: send.ok, action: send.ok ? "alerted" : "send-failed", sent: send.ok ? 1 : 0, send, status: s },
      { status: send.ok ? 200 : 502 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "health-check failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const runtime = "edge";
/**
 * /api/extension/linkedin-session — the LinkedIn session watchdog's server side.
 * (v4.36.0, extension 0.14.0; v4.65.1 internal-only alert)
 *
 * The extension watches the li_at cookie in the collecting browser. The moment
 * LinkedIn signs that browser out, it speaks an alert, opens the LinkedIn login
 * page, and POSTs here. The server records the state for the workspace and,
 * once per sign-out, emails an INTERNAL alert.
 *
 * v4.65.1 — Olivier, 2026-10-27: "No messages to our clients yet since we are
 * still testing these platforms, only report these disconnection to report@".
 * The email therefore goes ONLY to report@gershonconsulting.com (override with
 * env LINKEDIN_SIGNOUT_ALERT_TO) and names the user whose browser was signed
 * out. It is never sent to that user.
 *
 * Nothing here talks to LinkedIn. The extension only reads the cookie jar of
 * its own browser; no session value is sent to this endpoint.
 *
 * POST  (extension token)  { state: "signed_out" | "signed_in", at?, email? }
 *       → { success, data: { voice } }   voice = the sentence the extension speaks
 * GET   (extension token)  → { success, data: <stored state> }
 */
import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import prisma from "@/lib/db";
import { resolveExtensionCaller } from "@/lib/extension-auth";
import { resolveFrom } from "@/lib/email/sender";
import { withAuditBcc } from "@/lib/mail-bcc";

const KEY = "linkedin_session";

/** Internal recipient for every sign-out alert. Clients never receive it. */
const ALERT_TO_DEFAULT = "report@gershonconsulting.com";
function alertRecipients(): string[] {
  const env = (process.env.LINKEDIN_SIGNOUT_ALERT_TO || "").trim();
  const list = (env || ALERT_TO_DEFAULT).split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [ALERT_TO_DEFAULT];
}

type SessionState = {
  state: "signed_out" | "signed_in";
  since: string;          // when the current state began
  lastReportAt: string;   // last POST from the extension
  signOuts: number;       // running count, for the daily report later
  emailedFor: string | null; // `since` of the sign-out we already emailed about
};

async function readState(orgId: string): Promise<SessionState | null> {
  const row = await prisma.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: KEY } },
  });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as SessionState;
  } catch {
    return null;
  }
}

async function writeState(orgId: string, s: SessionState): Promise<void> {
  const value = JSON.stringify(s);
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: KEY } },
    create: { organizationId: orgId, key: KEY, value },
    update: { value },
  });
}

/** The person whose browser was signed out: the bound user if they belong to this workspace, else its first active collector. */
async function alertee(orgId: string, email: string | null) {
  if (email) {
    const u = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), organizationId: orgId, isActive: true },
      select: { name: true, email: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { organizationId: orgId, isActive: true, role: { not: UserRole.READ_ONLY } },
    orderBy: { createdAt: "asc" },
    select: { name: true, email: true },
  });
}

function firstName(name: string | null | undefined): string {
  const f = (name || "").trim().split(/\s+/)[0] || "";
  return f.length > 1 ? f : "";
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** The sentence spoken aloud. Same shape as the other Gershon voice alerts: who, project, task. */
function voiceFor(name: string | null | undefined): string {
  const f = firstName(name);
  return `${f ? f + ", " : ""}I need you now. Project: LinkedIn. Task: LinkedIn signed you out. Please sign back in.`;
}

/** Internal alert to report@ — names who was signed out; never addressed to that person. */
async function emailSignOut(
  person: { name: string | null; email: string | null } | null,
  reportedEmail: string | null,
  orgId: string,
  since: string,
  signOuts: number,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const who = (person?.name || "").trim() || "Unknown user";
  const whoEmail = (person?.email || reportedEmail || "").trim();
  const when = new Date(since).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">
      <p style="color:#b91c1c;font-weight:bold;margin:0 0 8px">Internal alert — not sent to the user</p>
      <p>LinkedIn signed out the collecting browser of <b>${esc(who)}</b>${whoEmail ? ` (${esc(whoEmail)})` : ""} at <b>${when} (New York)</b>.</p>
      <p>LinkedIn collection for this browser is paused until it is signed back in.</p>
      <table style="font-size:13px;color:#333;border-collapse:collapse">
        <tr><td style="padding:2px 12px 2px 0;color:#666">Workspace</td><td>${esc(orgId)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#666">Sign-outs recorded</td><td>${signOuts}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#666">Platform</td><td>social.gershon.ai</td></tr>
      </table>
      <p style="color:#555;font-size:13px;margin-top:12px">If LinkedIn shows a restriction or "unusual activity" warning on that account, don't keep signing in — tell Olivier first.</p>
    </div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(withAuditBcc({
        from: resolveFrom(),
        to: alertRecipients(),
        subject: `[Internal] LinkedIn signed out — ${who}${whoEmail ? ` <${whoEmail}>` : ""}`,
        html,
      })),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveExtensionCaller(req);
    if (!caller.ok) {
      return NextResponse.json({ success: false, code: caller.reason, error: "Extension not bound to a workspace" }, { status: 401 });
    }
    const body = (await req.json().catch(() => null)) as
      | { state?: string; at?: string; email?: string | null }
      | null;
    const next = body?.state === "signed_out" ? "signed_out" : body?.state === "signed_in" ? "signed_in" : null;
    if (!next) {
      return NextResponse.json({ success: false, error: "state must be signed_out or signed_in" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const at = body?.at && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at).toISOString() : now;
    const prev = await readState(caller.orgId);
    const changed = !prev || prev.state !== next;

    const s: SessionState = {
      state: next,
      since: changed ? at : prev!.since,
      lastReportAt: now,
      signOuts: (prev?.signOuts ?? 0) + (changed && next === "signed_out" ? 1 : 0),
      emailedFor: prev?.emailedFor ?? null,
    };

    const person = await alertee(caller.orgId, body?.email ?? null);

    // One internal email per sign-out, never a stream of them — and only to report@.
    if (next === "signed_out" && s.emailedFor !== s.since) {
      if (await emailSignOut(person, body?.email ?? null, caller.orgId, s.since, s.signOuts)) s.emailedFor = s.since;
    }

    await writeState(caller.orgId, s);
    return NextResponse.json({ success: true, data: { ...s, voice: voiceFor(person?.name) } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveExtensionCaller(req);
    if (!caller.ok) {
      return NextResponse.json({ success: false, code: caller.reason, error: "Extension not bound to a workspace" }, { status: 401 });
    }
    return NextResponse.json({ success: true, data: await readState(caller.orgId) });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

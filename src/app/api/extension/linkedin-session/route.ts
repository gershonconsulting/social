export const runtime = "edge";
/**
 * /api/extension/linkedin-session — the LinkedIn session watchdog's server side.
 * (v4.36.0, extension 0.14.0)
 *
 * The extension watches the li_at cookie in the collecting browser. The moment
 * LinkedIn signs that browser out, it speaks an alert, opens the LinkedIn login
 * page, and POSTs here. The server records the state for the workspace and,
 * once per sign-out, emails the person the extension is bound to — so a
 * sign-out is noticed even when nobody is at the computer to hear it.
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

const KEY = "linkedin_session";

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

/** The person to alert: the bound user if they belong to this workspace, else its first active collector. */
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

/** The sentence spoken aloud. Same shape as the other Gershon voice alerts: who, project, task. */
function voiceFor(name: string | null | undefined): string {
  const f = firstName(name);
  return `${f ? f + ", " : ""}I need you now. Project: LinkedIn. Task: LinkedIn signed you out. Please sign back in.`;
}

async function emailSignOut(to: string, name: string | null | undefined, since: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const f = firstName(name);
  const when = new Date(since).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">
      <p>${f ? f + ", " : ""}LinkedIn signed your browser out at <b>${when} (New York)</b>.</p>
      <p>Collection for every LinkedIn-based tool is paused until you sign back in.</p>
      <p><a href="https://www.linkedin.com/login" style="display:inline-block;background:#0a66c2;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Sign in to LinkedIn</a></p>
      <p style="color:#555;font-size:13px">On the collecting computer, the login page is already open; 1Password fills it in one click. If LinkedIn shows a restriction or "unusual activity" warning, don't keep signing in — tell Olivier first.</p>
    </div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: resolveFrom(),
        to: [to],
        subject: "LinkedIn signed you out — sign back in",
        html,
      }),
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

    // One email per sign-out, never a stream of them.
    if (next === "signed_out" && s.emailedFor !== s.since && person?.email) {
      if (await emailSignOut(person.email, person.name, s.since)) s.emailedFor = s.since;
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

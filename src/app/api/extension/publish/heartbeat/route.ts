export const runtime = "edge";
/**
 * /api/extension/publish/heartbeat — the publishing browser checking in.
 * (v4.37.0, extension 0.15.0)
 *
 * POST (extension token)
 *   { x: { signedIn, as? }, linkedin: { signedIn, as? }, version?, error? }
 *   → { enabled, voice: { x, linkedin } }
 * Every 5 minutes and at once on any sign-in / sign-out. Drives the "Live"
 * strip on the Publishing pages and Settings.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolvePublishCaller } from "@/lib/publish-caller";
import prisma from "@/lib/db-raw";
import { clientRoutedIds, destinationsOf, getPublisherState, getSettings, getTarget, normalizeHandle, savePublisherState, sweep, PUBLISHING_CLIENT_WHERE, type NetSession } from "@/lib/publishing";
import { getBrowser, LI_CHECK_TTL_MS, LI_FAIL_TTL_MS, liKey, saveBrowser, validBrowserId, xKey, type PublishBrowser } from "@/lib/publish-browsers";

type Probe = { target?: string; ok?: boolean; why?: string | null };
type BrowserIn = { id?: string; label?: string } | undefined;

/** Every LinkedIn page/group this caller may publish to. */
async function linkedInTargets(orgId: string, clientId: string | null): Promise<string[]> {
  const routed = clientId ? [] : await clientRoutedIds(orgId);
  const clients = await prisma.client.findMany({
    where: { organizationId: orgId, ...PUBLISHING_CLIENT_WHERE, ...(clientId ? { id: clientId } : {}), status: { not: "ARCHIVED" } },
    select: { id: true },
  });
  const out = new Set<string>();
  for (const c of clients) {
    if (routed.includes(c.id)) continue;
    const t = await getTarget(orgId, c.id);
    for (const d of destinationsOf(t)) if (d.network === "LINKEDIN" && !/\/in\//.test(d.target)) out.add(d.target);
  }
  return Array.from(out);
}

/** v4.63.0: remember what this Chrome can publish; ask it to check the pages it was never checked on. */
async function registerBrowser(
  orgId: string, clientId: string | null, bin: BrowserIn,
  b: { x?: { signedIn?: boolean; as?: string | null; accounts?: string[] }; linkedin?: { signedIn?: boolean; name?: string | null }; version?: string; probes?: Probe[] } | null,
): Promise<string[]> {
  const id = validBrowserId(bin?.id);
  if (!id) return [];
  const now = new Date();
  const prev = await getBrowser(orgId, id);
  const xIn = !!b?.x?.signedIn;
  const accounts = Array.isArray(b?.x?.accounts) ? b!.x!.accounts!.map((a) => xKey(a)).filter((a): a is string => !!a) : null;
  const br: PublishBrowser = {
    id,
    label: String(bin?.label || prev?.label || "Chrome").slice(0, 80),
    version: b?.version ?? prev?.version ?? null,
    lastSeenAt: now.toISOString(),
    x: {
      signedIn: xIn,
      as: xIn ? (xKey(b?.x?.as) || prev?.x.as || null) : null,
      accounts: xIn ? (accounts && accounts.length ? accounts : prev?.x.accounts || []) : [],
    },
    linkedin: { signedIn: !!b?.linkedin?.signedIn, name: (b?.linkedin?.name || prev?.linkedin.name || null) },
    li: { ...(prev?.li || {}) },
    lastPostAt: prev?.lastPostAt ?? null,
    lastError: prev?.lastError ?? null,
  };
  if (br.x.as && !br.x.accounts.includes(br.x.as)) br.x.accounts.unshift(br.x.as);
  for (const p of Array.isArray(b?.probes) ? b!.probes!.slice(0, 20) : []) {
    const k = liKey(p.target);
    if (k) br.li[k] = { ok: !!p.ok, at: now.toISOString(), why: p.ok ? null : (p.why || "not an admin").slice(0, 120) };
  }
  await saveBrowser(orgId, br);
  if (!br.linkedin.signedIn) return [];
  const due: string[] = [];
  for (const t of await linkedInTargets(orgId, clientId)) {
    const k = liKey(t);
    if (!k) continue;
    const c = br.li[k];
    const ttl = c && !c.ok ? LI_FAIL_TTL_MS : LI_CHECK_TTL_MS;
    if (!c || now.getTime() - Date.parse(c.at) > ttl) due.push(t);
  }
  return due.slice(0, 4);
}

type In = { signedIn?: boolean; as?: string | null } | undefined;

function merge(prev: NetSession, next: In, now: string, isX: boolean): NetSession {
  if (!next) return prev;
  const signedIn = !!next.signedIn;
  const as = isX ? normalizeHandle(next.as) : (next.as || "").trim() || null;
  return {
    signedIn,
    as: signedIn ? as ?? prev.as : prev.as,
    signedOutSince: signedIn ? null : prev.signedIn || !prev.signedOutSince ? now : prev.signedOutSince,
    emailedFor: prev.emailedFor,
  };
}

export async function POST(req: NextRequest) {
  try {
    const caller = await resolvePublishCaller(req);
    if (!caller.ok) {
      return NextResponse.json({ success: false, code: caller.reason, error: "Extension not bound to a workspace" }, { status: 401 });
    }
    const b = (await req.json().catch(() => null)) as {
      x?: In & { accounts?: string[] }; linkedin?: In & { name?: string | null }; version?: string; error?: string | null; browser?: BrowserIn; probes?: Probe[];
    } | null;
    const now = new Date().toISOString();
    const st = await getPublisherState(caller.orgId, caller.clientId);
    st.lastSeenAt = now;
    st.version = b?.version ?? st.version;
    st.x = merge(st.x, b?.x, now, true);
    st.linkedin = merge(st.linkedin, b?.linkedin, now, false);
    if (b?.error !== undefined) st.lastError = b.error;
    await savePublisherState(caller.orgId, st, caller.clientId);
    await sweep(caller.orgId).catch(() => null);
    const checkLinkedIn = await registerBrowser(caller.orgId, caller.clientId, b?.browser, b).catch(() => [] as string[]);

    const settings = await getSettings(caller.orgId);
    const u = await prisma.user.findFirst({
      where: { organizationId: caller.orgId, isActive: true, role: "ADMIN" },
      orderBy: { createdAt: "asc" },
      select: { name: true },
    });
    const f = (u?.name || "").trim().split(/\s+/)[0] || "";
    // A client's own browser is not Gershon's: no Gershon name in its voice. (v4.42.0)
    const lead = caller.clientId ? "" : f.length > 1 ? f + ", " : "";
    return NextResponse.json({
      success: true,
      data: {
        enabled: settings.enabled,
        checkLinkedIn,
        voice: {
          x: caller.clientId ? "X signed you out. Please sign back in so your scheduled posts can go out." : `${lead}I need you now. Project: Social. Task: X signed you out. Please sign back in so scheduled posts can go out.`,
          linkedin: caller.clientId ? "LinkedIn signed you out. Please sign back in so your scheduled posts can go out." : `${lead}I need you now. Project: Social. Task: LinkedIn signed you out. Please sign back in so scheduled posts can go out.`,
        },
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export const runtime = 'edge';
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/cookies/verify
 *
 * For each platform with cookies on file, make ONE lightweight authenticated
 * request to confirm the cookie actually works:
 *   LinkedIn → GET /voyager/api/me  (returns 200 + JSON when li_at is valid)
 *   X        → GET /1.1/account/verify_credentials.json  (needs auth_token + ct0)
 *
 * Caveat I'm being upfront about in the response: LinkedIn and X both check
 * IP fingerprint against the cookie's issuing IP. Calls from a Cloudflare
 * Worker won't match the user's home IP, so a "fail" result here doesn't
 * always mean the cookie is bad — it can also mean "cookie's fine, but
 * LinkedIn rejected the request because it came from a datacenter".
 */
type Probe = {
  hasCookies: boolean;
  capturedAt: string | null;
  cookieNames: string[];
  testResult: "ok" | "fail" | "untested";
  testStatus?: number;
  testMessage?: string;
  identifiedAs?: string | null;
};

async function loadCookies(platform: "LINKEDIN" | "TWITTER"): Promise<{ cookies: Record<string,string>; capturedAt: string | null }> {
  const row = await prisma.setting.findUnique({ where: { key: `cookies:${platform}` } });
  if (!row) return { cookies: {}, capturedAt: null };
  try {
    const parsed = JSON.parse(row.value) as { cookies?: Record<string,string>; capturedAt?: string };
    return { cookies: parsed.cookies ?? {}, capturedAt: parsed.capturedAt ?? null };
  } catch { return { cookies: {}, capturedAt: null }; }
}

function cookieHeader(cookies: Record<string,string>): string {
  return Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join("; ");
}

async function probeLinkedIn(cookies: Record<string,string>, capturedAt: string | null): Promise<Probe> {
  const probe: Probe = {
    hasCookies: !!cookies.li_at,
    capturedAt,
    cookieNames: Object.keys(cookies),
    testResult: "untested",
  };
  if (!cookies.li_at) return probe;
  try {
    const r = await fetch("https://www.linkedin.com/voyager/api/me", {
      headers: {
        Cookie: cookieHeader(cookies),
        // LinkedIn requires this header on Voyager calls
        "csrf-token": (cookies.JSESSIONID || "").replace(/"/g, ""),
        Accept: "application/vnd.linkedin.normalized+json+2.1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      },
    });
    probe.testStatus = r.status;
    if (r.ok) {
      try {
        const j = await r.json() as { data?: { firstName?: string; lastName?: string } };
        probe.identifiedAs = [j.data?.firstName, j.data?.lastName].filter(Boolean).join(" ") || null;
      } catch {}
      probe.testResult = "ok";
    } else {
      probe.testResult = "fail";
      probe.testMessage = `HTTP ${r.status} — likely IP fingerprint check (cookie may still be fine when called from your laptop).`;
    }
  } catch (e) {
    probe.testResult = "fail";
    probe.testMessage = `Network: ${e instanceof Error ? e.message : String(e)}`;
  }
  return probe;
}

async function probeTwitter(cookies: Record<string,string>, capturedAt: string | null): Promise<Probe> {
  const probe: Probe = {
    hasCookies: !!cookies.auth_token,
    capturedAt,
    cookieNames: Object.keys(cookies),
    testResult: "untested",
  };
  if (!cookies.auth_token || !cookies.ct0) return probe;
  try {
    const r = await fetch("https://api.x.com/1.1/account/verify_credentials.json", {
      headers: {
        Cookie: cookieHeader(cookies),
        "x-csrf-token": cookies.ct0,
        // X's web client uses this hard-coded bearer for read paths
        Authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      },
    });
    probe.testStatus = r.status;
    if (r.ok) {
      try {
        const j = await r.json() as { screen_name?: string; name?: string };
        probe.identifiedAs = j.screen_name ? `@${j.screen_name}` : (j.name ?? null);
      } catch {}
      probe.testResult = "ok";
    } else {
      probe.testResult = "fail";
      probe.testMessage = `HTTP ${r.status} — likely IP fingerprint check.`;
    }
  } catch (e) {
    probe.testResult = "fail";
    probe.testMessage = `Network: ${e instanceof Error ? e.message : String(e)}`;
  }
  return probe;
}

export async function GET() {
  try {
    const liData = await loadCookies("LINKEDIN");
    const twData = await loadCookies("TWITTER");
    const [linkedin, twitter] = await Promise.all([
      probeLinkedIn(liData.cookies, liData.capturedAt),
      probeTwitter(twData.cookies, twData.capturedAt),
    ]);
    return NextResponse.json({ success: true, data: { LINKEDIN: linkedin, TWITTER: twitter } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verify failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

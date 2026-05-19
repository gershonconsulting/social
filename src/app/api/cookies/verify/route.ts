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
  // LinkedIn started redirecting Voyager calls from datacenter IPs into a
  // login-flow loop (the previous probe surfaced as 'Too many redirects' —
  // the same /voyager/api/me URL bouncing 16+ times). Use redirect:'manual'
  // so we never enter the loop, and treat any 30x as 'cookie is probably
  // fine, but LinkedIn rejects this IP'.
  try {
    const r = await fetch("https://www.linkedin.com/voyager/api/me", {
      headers: {
        Cookie: cookieHeader(cookies),
        "csrf-token": (cookies.JSESSIONID || "").replace(/"/g, ""),
        Accept: "application/vnd.linkedin.normalized+json+2.1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      },
      redirect: "manual",
    });
    probe.testStatus = r.status;
    if (r.ok) {
      try {
        const j = (await r.json()) as { data?: { firstName?: string; lastName?: string } };
        probe.identifiedAs = [j.data?.firstName, j.data?.lastName].filter(Boolean).join(" ") || null;
      } catch { /* body wasn't JSON — odd but not fatal */ }
      probe.testResult = "ok";
    } else if (r.status >= 300 && r.status < 400) {
      // Redirected from voyager → login / interstitial. Almost always the
      // datacenter-IP block, NOT a bad cookie. Surface that distinction.
      probe.testResult = "fail";
      probe.testMessage =
        "Voyager redirected us to login (HTTP " + r.status + "). This is " +
        "LinkedIn rejecting the server-side test because it sees a datacenter " +
        "IP — the cookie is almost certainly fine when used from your browser " +
        "by the extension. Confirm by clicking Sync Now in the popup.";
    } else {
      probe.testResult = "fail";
      probe.testMessage = `HTTP ${r.status} — likely IP fingerprint check (cookie may still be fine when called from your laptop).`;
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    // Cloudflare's fetch surfaces too-many-redirects as a regular network
    // error before we can read the response. Detect it and translate.
    if (/too many redirects/i.test(m)) {
      probe.testResult = "fail";
      probe.testMessage =
        "Voyager bounced us through a redirect loop — LinkedIn rejecting the " +
        "datacenter IP. Cookie is probably fine; the extension's in-browser " +
        "scrape (real IP + real session) will still work.";
    } else {
      probe.testResult = "fail";
      probe.testMessage = `Network: ${m}`;
    }
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
  // X retired the v1.1 verify_credentials endpoint — it returns 404 even with
  // valid cookies. Probe by fetching x.com/home with the auth cookies and
  // following 0 redirects. A logged-in browser gets HTTP 200 + the SPA shell;
  // an expired session gets a 30x to the login page or returns the public
  // homepage HTML (which contains the marketing copy and Sign in button).
  try {
    const r = await fetch("https://x.com/home", {
      headers: {
        Cookie: cookieHeader(cookies),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "manual",
    });
    probe.testStatus = r.status;
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location") || "";
      probe.testResult = "fail";
      probe.testMessage = `Redirected to ${loc} — session cookies likely expired.`;
    } else if (r.ok) {
      // Best-effort body sniff: logged-in body contains the SPA's data-testid
      // for the navbar / compose-tweet button. Logged-out body contains the
      // 'Sign in to X' marketing chunk.
      const text = await r.text();
      const loggedIn =
        text.includes('"isLoggedIn":true') ||
        text.includes('"is_logged_in":true') ||
        text.includes("/i/api/2/notifications/all.json") ||
        text.includes("twitter:title");
      const loggedOut =
        text.includes("Sign in to X") ||
        text.includes("loggedOutAccountSwitcher") ||
        text.includes("/login");
      if (loggedIn && !loggedOut) {
        probe.testResult = "ok";
      } else {
        probe.testResult = "fail";
        probe.testMessage =
          "x.com/home returned 200 but the body looks logged-out (no SPA shell). " +
          "Cookie may still be fine when used from your real browser via the extension — " +
          "X checks IP fingerprint against the cookie's issuing IP and rejects datacenter IPs.";
      }
    } else {
      probe.testResult = "fail";
      probe.testMessage = `HTTP ${r.status} — likely IP fingerprint check (datacenter IPs frequently rejected by X).`;
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

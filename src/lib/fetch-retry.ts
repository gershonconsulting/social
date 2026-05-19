/**
 * Fetch wrapper that retries on transient 5xx errors. Cloudflare Workers
 * occasionally return 1102 "exceeded resource limits" on heavy Prisma
 * queries; each retry hits a fresh worker invocation, so a quick retry
 * almost always succeeds.
 *
 * Default: 3 attempts, exponential backoff (200ms, 500ms, 1.2s).
 * Safe to use for GETs. Avoid for writes that aren't idempotent.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  attempts = 3
): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, init);
      if (r.status < 500) return r;
      lastErr = new Error("HTTP " + r.status);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) {
      await new Promise((res) => setTimeout(res, 200 * Math.pow(2.5, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed after " + attempts + " attempts");
}

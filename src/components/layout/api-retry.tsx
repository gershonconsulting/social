"use client";

/**
 * Safety net for every page (v4.33.0): retries a failed GET to our own /api.
 *
 * Cloudflare sometimes answers 500/502/503 (Error 1101 / 1102) when a request
 * lands on an isolate that is being recycled. The next request goes to a fresh
 * isolate and succeeds, so one quiet retry turns a red "HTTP 500" card into a
 * normal page. Only idempotent reads are retried, never writes.
 *
 * The real fix for the 1102s is in lib/db-raw.ts (one Prisma engine per
 * isolate); this only covers the residual cold-start blips.
 */
const FLAG = "__gershonApiRetry__";
const RETRYABLE = new Set([500, 502, 503, 504]);
const DELAYS_MS = [300, 900, 2000];

// Installed at module load, NOT in an effect: React runs child effects
// before parent effects, so an effect here would patch fetch only after the
// page's own first requests had already gone out.
function install() {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (w[FLAG]) return;
  w[FLAG] = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (
      init?.method ||
      (typeof input === "object" && "method" in input ? (input as Request).method : "GET")
    ).toUpperCase();
    let url = "";
    try {
      url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const u = new URL(url, window.location.href);
      if (u.origin !== window.location.origin || !u.pathname.startsWith("/api/")) {
        return original(input, init);
      }
    } catch {
      return original(input, init);
    }
    if (method !== "GET" && method !== "HEAD") return original(input, init);

    let res = await original(input, init);
    for (const wait of DELAYS_MS) {
      if (!RETRYABLE.has(res.status)) return res;
      await new Promise((r) => setTimeout(r, wait));
      try {
        res = await original(typeof input === "object" && !(input instanceof URL) ? (input as Request).clone() : input, init);
      } catch {
        /* network blip — keep the last response and try again */
      }
    }
    return res;
  };
}

install();

export function ApiRetry() {
  return null;
}

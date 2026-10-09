/**
 * Server-side LinkedIn calls — switched OFF on purpose. (v4.36.0, 2026-10-09)
 *
 * WHY. The extension captures the LinkedIn session (li_at + JSESSIONID) in the
 * collecting browser and saves it here (/api/cookies/save). Three places then
 * REPLAYED that same session from Cloudflare's datacenter IPs:
 *
 *   - lib/jobs/sync.ts → adapters/linkedin.ts   (daily-sync cron, 06:00 UTC)
 *   - /api/cron/scrape-all-clients              (Voyager feed per client)
 *   - /api/cookies/verify                       (every time Settings opens)
 *
 * LinkedIn sees one session used from a home IP and a datacenter IP at the
 * same time. That is its account-sharing / automation signal, and its answer
 * is to kill the session — which signs Olivier out of LinkedIn everywhere,
 * in every Gershon tool at once. The code comments in those files already
 * recorded the symptom (Voyager redirect loops "because LinkedIn rejects the
 * datacenter IP"); the replay was producing no data and costing the session.
 *
 * The Chrome extension is the LinkedIn collection path (since extension 0.9.0
 * it reads LinkedIn inside the user's own browser, at their own IP). Nothing
 * on the server should talk to linkedin.com with a captured session.
 *
 * To turn the server path back on, flip this to true — but read the above
 * first. The official OAuth API (api.linkedin.com with an app token) is a
 * different thing and is not what this guards.
 */
export const SERVER_LINKEDIN_SESSION_CALLS = false;

export const SERVER_LINKEDIN_DISABLED_MESSAGE =
  "Not called from the server on purpose: replaying the LinkedIn session from a datacenter IP gets the account signed out. LinkedIn is collected by the Chrome extension in your own browser.";

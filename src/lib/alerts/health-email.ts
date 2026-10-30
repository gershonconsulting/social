/**
 * HTML for the "collection has stopped" health alert (cron/health-check).
 *
 * Report e-mail house style (2026-10-23): white page, single column,
 * max-width 680px, dark text #12211d, brand red #CC3333 as the accent only.
 * Never light text on a dark band — this used to be a solid red header with
 * white text and a black button. One-line "Source: … · Data as of …" footer.
 * Inline CSS only (mail clients strip <style>).
 */

const RED = "#CC3333";
const INK = "#12211d";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

export interface HealthAlertFacts {
  now: string;
  activeClients: number;
  enabledConnections: number;
  lastPostAt: string | null;
  postsLast24h: number;
  erroringConnections: number;
  staleHours: number;
  realertHours: number;
}

const et = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });

export function healthAlertHtml(s: HealthAlertFacts, gap: string, dashboardUrl: string): string {
  const lastTxt = s.lastPostAt ? et(s.lastPostAt) + " ET" : "never";
  const host = dashboardUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const errLine = s.erroringConnections > 0
    ? `<tr><td colspan="2" style="padding:4px 0;color:#7f1d1d;">${s.erroringConnections} platform connection(s) are currently reporting sync errors.</td></tr>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;">
    <div style="height:4px;background:${RED};line-height:4px;font-size:0;">&nbsp;</div>
    <div style="padding:20px 24px 16px;border-bottom:1px solid ${LINE};">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${RED};">GC Social · collection alert</div>
      <div style="font-size:21px;font-weight:800;letter-spacing:-0.01em;margin-top:4px;line-height:1.25;color:${INK};">⚠️ ${host} has stopped collecting</div>
    </div>
    <div style="padding:16px 24px;background:#fdf2f2;border-bottom:1px solid #f3caca;border-left:4px solid ${RED};color:#7f1d1d;font-size:15px;line-height:1.5;">
      No new social posts have been ingested in <strong>${s.staleHours}+ hours</strong>.
      The last post was collected <strong>${gap}</strong> (${lastTxt}), and
      <strong>${s.postsLast24h}</strong> posts landed in the last 24 hours.
    </div>
    <div style="padding:20px 24px;">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.5;">
        This usually means the <strong>collection path is down</strong> — most often the
        Chrome extension isn't running (browser closed, signed out, cookies expired, or the
        extension was disabled).
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 18px;">
        <tr><td style="padding:4px 0;color:#3f3f46;">Active clients monitored:</td><td style="padding:4px 0;text-align:right;font-weight:600;">${s.activeClients}</td></tr>
        <tr><td style="padding:4px 0;color:#3f3f46;">Enabled platform connections:</td><td style="padding:4px 0;text-align:right;font-weight:600;">${s.enabledConnections}</td></tr>
        <tr><td style="padding:4px 0;color:#3f3f46;">Last post collected:</td><td style="padding:4px 0;text-align:right;font-weight:600;">${lastTxt}</td></tr>
        ${errLine}
      </table>
      <div style="background:#f9fafb;border:1px solid ${LINE};border-radius:8px;padding:14px 16px;margin:0 0 18px;">
        <div style="font-weight:700;font-size:14px;margin-bottom:6px;">Fix in ~1 minute</div>
        <ol style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;color:#3f3f46;">
          <li>Open Chrome on the collection machine and confirm you're signed in to LinkedIn &amp; X.</li>
          <li>Open <code>chrome://extensions</code>, find the Gershon collector, and click <strong>↺ Reload</strong> if it's off or errored.</li>
          <li>Open the dashboard's Logs page to confirm today's collection turns green.</li>
        </ol>
      </div>
      <a href="${dashboardUrl}" style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:8px;">Open the dashboard →</a>
      <p style="margin:18px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">
        You're getting this because collection went quiet. You won't be re-alerted more than
        once every ${s.realertHours} hours. When collection resumes, these alerts stop on
        their own.
      </p>
    </div>
    <div style="padding:14px 24px;border-top:1px solid ${LINE};font-size:11px;line-height:1.5;color:${MUTED};">
      Source: <a href="${dashboardUrl}" style="color:#1f6f5c;">${host}</a> (Social app database: collected posts and platform connections) · Data as of ${et(s.now)} ET · health-check
    </div>
  </div>
</body></html>`;
}

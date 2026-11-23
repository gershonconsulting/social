/**
 * Friday client reports — one e-mail per client (v4.81.0).
 *
 * Olivier, 2026-11-14: "Too many emails sent. Review and re organize the emails
 * from this platform." The three weekly reports (Company, Competitive,
 * Intelligence) now go out as ONE e-mail per client, the "Client report",
 * instead of three. Each report keeps its own header, content and footer.
 */
import { socialSubject } from "@/lib/email/subject";
import { esc, INK } from "../ops/shell";

export function fridayPackSubject(d: { client: { name: string }; weekLabel: string }): string {
  return `${socialSubject(d.client.name, "Client report")} (week of ${d.weekLabel})`;
}

/** Stack the bodies of finished report documents in one document, in the order given. */
export function combineFridayHtml(subject: string, docs: string[]): string {
  const inner = docs.map((doc) => {
    const m = doc.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return (m ? m[1] : doc).trim();
  });
  const gap = `<div style="height:28px;line-height:28px;font-size:0;">&nbsp;</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${INK};">
${inner.join(gap)}
</body></html>`;
}

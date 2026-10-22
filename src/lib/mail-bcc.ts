/**
 * v4.61.1 — Olivier, 2026-10-22: "When there is an email sent from this app,
 * always BCC for now social@gershonconsulting.com so we know what was sent."
 *
 * Every Resend payload in the app goes through withAuditBcc(). Override the
 * address with env MAIL_AUDIT_BCC; set it to "off" to stop the copies.
 */
export const AUDIT_BCC_DEFAULT = "social@gershonconsulting.com";

function list(v: unknown): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x)).filter(Boolean);
}

export function withAuditBcc<T extends Record<string, unknown>>(payload: T): T & { bcc?: string[] } {
  const env = (process.env.MAIL_AUDIT_BCC || "").trim();
  if (env.toLowerCase() === "off") return payload;
  const audit = env || AUDIT_BCC_DEFAULT;
  const lower = audit.toLowerCase();
  const already = [...list(payload.to), ...list(payload.cc), ...list(payload.bcc)].some((a) => a.toLowerCase().includes(lower));
  if (already) return payload;
  return { ...payload, bcc: [...list(payload.bcc), audit] };
}

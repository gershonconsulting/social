/**
 * POST /api/relay/talkingpoints  { id }
 *
 * Lets talkingpoints.gershon.ai send its talking-points emails with THIS app's
 * Resend key, so the key never has to be copied anywhere (Olivier, 2026-10-26:
 * "use the same Resend key as social.gershon.ai").
 *
 * No shared secret is needed: the caller only passes the id of an email that a
 * signed-in Talking Points user queued. This route fetches that email from
 * talkingpoints.gershon.ai itself (fixed origin, one-time read, 10-minute expiry),
 * so nobody can make Social send content of their choosing.
 */
export const runtime = "edge";

import { withAuditBcc } from "@/lib/mail-bcc";

const TP_ORIGIN = "https://talkingpoints.gershon.ai";
const FROM = "Talking Points <talkingpoints@gershon.ai>";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Queued = { to: string[]; subject: string; html: string; text?: string; reply_to?: string };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const id = String(body.id || "");
  if (!/^[a-f0-9]{48}$/.test(id)) return Response.json({ ok: false, error: "bad id" }, { status: 400 });

  const r = await fetch(`${TP_ORIGIN}/api/outbox/${id}`, { headers: { "user-agent": "social.gershon.ai relay" } });
  if (!r.ok) return Response.json({ ok: false, error: "nothing queued under this id" }, { status: 404 });
  const m = (await r.json()) as Queued;

  const to = (Array.isArray(m.to) ? m.to : []).map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL.test(e));
  if (!to.length || to.length > 20 || !m.subject || !m.html) {
    return Response.json({ ok: false, error: "invalid message" }, { status: 422 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return Response.json({ ok: false, error: "RESEND_API_KEY not set" }, { status: 503 });

  const payload = withAuditBcc({
    from: FROM,
    to,
    subject: String(m.subject).slice(0, 300),
    html: String(m.html),
    text: m.text ? String(m.text) : undefined,
    reply_to: m.reply_to && EMAIL.test(m.reply_to) ? m.reply_to : "olivier@gershonconsulting.com",
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": "social.gershon.ai/relay" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json({ ok: false, error: "Resend refused", detail: out }, { status: 502 });
  return Response.json({ ok: true, id: (out as { id?: string }).id, to });
}

/**
 * Action cards and their results, as email HTML (v4.70.0). Inline CSS only.
 */
import { esc, pill, SITE } from "@/lib/reports/ops/shell";
import { PILLAR_HINT, PILLAR_LABEL, type ActionCard, type Pillar } from "./store";
import { actionLink } from "./token";
import type { ActionResults } from "./results";

const PILLARS: Pillar[] = ["PROMOTE", "NETWORK", "ENGAGE"];
const BTN = "display:inline-block;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;margin:0 6px 6px 0;";

export function actionsPageUrl(id?: string): string {
  return `${SITE}/actions${id ? `#${encodeURIComponent(id)}` : ""}`;
}

/** The day's cards grouped by pillar, with one-click Done / Dismiss and "Draft it" buttons. */
export async function cardsEmailHtml(orgId: string, cards: ActionCard[], max = 9): Promise<string> {
  const open = cards.filter((c) => c.status === "open");
  if (!open.length) return "";
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const picked: ActionCard[] = [];
  // Up to 3 per pillar first, so every pillar shows up, then fill by priority.
  for (const p of PILLARS) picked.push(...open.filter((c) => c.pillar === p).sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 3));
  const shown = picked.slice(0, max);

  const blocks: string[] = [];
  for (const p of PILLARS) {
    const mine = shown.filter((c) => c.pillar === p);
    if (!mine.length) continue;
    const items = await Promise.all(
      mine.map(async (c) => {
        const [done, dismiss] = await Promise.all([actionLink(orgId, c.id, "done"), actionLink(orgId, c.id, "dismissed")]);
        const level = c.priority === "high" ? "critical" : c.priority === "medium" ? "warn" : "ok";
        return `<div style="padding:10px 0;border-bottom:1px solid #f1f1f1;">
        <div style="font-size:12px;color:#6b7280;">${pill(c.priority.toUpperCase(), level)} &nbsp;<b style="color:#111;">For ${esc(c.forCompany)}</b></div>
        <div style="font-size:14px;font-weight:700;margin-top:5px;line-height:1.4;">${esc(c.action)}</div>
        ${c.why ? `<div style="font-size:13px;color:#374151;margin-top:3px;line-height:1.45;">${esc(c.why)}</div>` : ""}
        ${c.draft ? `<div style="font-size:13px;margin-top:6px;padding:8px 10px;background:#f9fafb;border-left:3px solid #FE1B04;line-height:1.45;">${esc(c.draft)}</div>` : ""}
        ${c.links.length ? `<div style="font-size:12px;margin-top:6px;">${c.links.map((l) => `<a href="${esc(l.href)}" style="color:#FE1B04;margin-right:12px;white-space:nowrap;">${esc(l.label)} →</a>`).join("")}</div>` : ""}
        <div style="margin-top:8px;">
          <a href="${esc(actionsPageUrl(c.id))}" style="${BTN}background:#FE1B04;color:#fff;">${c.draft ? "Edit the draft" : "Draft it"}</a>
          <a href="${esc(done)}" style="${BTN}background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;">✓ Done</a>
          <a href="${esc(dismiss)}" style="${BTN}background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb;">Dismiss</a>
        </div>
      </div>`;
      }),
    );
    blocks.push(
      `<div style="margin-top:6px;"><div style="font-size:13px;font-weight:800;color:#FE1B04;text-transform:uppercase;letter-spacing:.04em;padding-top:8px;">${PILLAR_LABEL[p]}</div>
       <div style="font-size:12px;color:#9ca3af;">${esc(PILLAR_HINT[p])}</div>${items.join("")}</div>`,
    );
  }
  const more = open.length - shown.length;
  return (
    blocks.join("") +
    `<div style="margin-top:12px;font-size:13px;"><a href="${esc(actionsPageUrl())}" style="color:#FE1B04;font-weight:700;">${more > 0 ? `See all ${open.length} open actions` : "Open your actions"} in Social →</a></div>`
  );
}

/** Just the three buttons, for a report that lists actions its own way (Intelligence). */
export async function cardButtonsHtml(orgId: string, c: ActionCard): Promise<string> {
  const [done, dismiss] = await Promise.all([actionLink(orgId, c.id, "done"), actionLink(orgId, c.id, "dismissed")]);
  return `<div style="margin-top:8px;">
    <a href="${esc(actionsPageUrl(c.id))}" style="${BTN}background:#FE1B04;color:#fff;">Draft it</a>
    <a href="${esc(done)}" style="${BTN}background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;">✓ Done</a>
    <a href="${esc(dismiss)}" style="${BTN}background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb;">Dismiss</a>
  </div>`;
}

/** "Last week's actions — what happened". Empty string when there is nothing to say yet. */
export function resultsEmailHtml(r: ActionResults): string {
  if (!r.created && !r.results.length) return "";
  const counts = `<div style="font-size:13px;line-height:1.6;">Last 7 days: <b>${r.created}</b> actions suggested · <b style="color:#047857;">${r.done}</b> done · <b>${r.dismissed}</b> dismissed · <b>${r.open}</b> still open.
    <span style="color:#6b7280;">${PILLARS.map((p) => `${PILLAR_LABEL[p]} ${r.byPillar[p].done}/${r.byPillar[p].created}`).join(" · ")}</span></div>`;
  const rows = r.results
    .map((x) => {
      const engTxt =
        x.engagementPerPostAfter === null
          ? "no post yet"
          : `${x.engagementPerPostAfter} engagements per post (usually ${x.engagementPerPostBefore ?? "—"})`;
      return `<div style="padding:8px 0;border-bottom:1px solid #f1f1f1;font-size:13px;">
        <b>${esc(x.card.forCompany)}</b> — ${esc(x.card.action)}
        <div style="color:#374151;margin-top:3px;">Since then: <b>${x.postsAfter}</b> post${x.postsAfter === 1 ? "" : "s"} (usual week ${x.postsPerWeekBefore}) · ${engTxt}${x.inProgress ? ` <span style="color:#9ca3af;">· still counting</span>` : ""}</div>
      </div>`;
    })
    .join("");
  return counts + rows;
}

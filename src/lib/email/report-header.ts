/**
 * Report e-mail header — white card, Gershon red left border, dark text.
 *
 * 2026-10-22 readability fix: the report headers were white text on a red or
 * charcoal band, which is hard to read on phones and in dark-mode mail apps
 * that re-tint backgrounds. Unified Gershon design: white header, #CC3333 left
 * border, #1d1d1f text.
 *
 * E-mail safe: a presentation table (Outlook keeps td borders and backgrounds),
 * inline styles only, no <style> block, no web fonts.
 */

export const GC_RED = "#CC3333";
export const GC_RED_DARK = "#a8281f";
export const GC_TEXT = "#1d1d1f";
export const GC_MUTED = "#6e6e73";
export const GC_BORDER = "#e5e7eb";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function reportHeaderHtml(opts: { eyebrow: string; title: string; subtitle?: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
  <tr>
    <td style="background:#ffffff;border-left:4px solid ${GC_RED};border-bottom:1px solid ${GC_BORDER};padding:20px 24px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:${GC_RED};font-weight:700;">${esc(opts.eyebrow)}</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;color:${GC_TEXT};line-height:1.25;">${esc(opts.title)}</div>
      ${opts.subtitle ? `<div style="font-size:13px;margin-top:4px;color:${GC_MUTED};">${esc(opts.subtitle)}</div>` : ""}
    </td>
  </tr>
</table>`;
}

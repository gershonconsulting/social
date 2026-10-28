"use client";
import Link from "next/link";
import { frameTone, FRAME_STYLE, pctLabel } from "@/lib/frame-tone";

export type FrameItem = {
  id: string;
  name: string;
  logoUrl?: string | null;
  href?: string;
  ratio: number | null;
  /** One short line under the name, e.g. "12 of 15 days verified". */
  detail?: string;
  /** Optional small tag, e.g. the category. */
  tag?: string;
};

/** Grid of client cards, each framed Green / Orange / Red (see lib/frame-tone). */
export function ClientFrames({ title, subtitle, items }: { title: string; subtitle?: string; items: FrameItem[] }) {
  const counts = { green: 0, orange: 0, red: 0, none: 0 };
  for (const it of items) counts[frameTone(it.ratio)]++;
  const order = { red: 0, orange: 1, green: 2, none: 3 } as const;
  const sorted = [...items].sort((a, b) =>
    order[frameTone(a.ratio)] - order[frameTone(b.ratio)] || (a.ratio ?? 2) - (b.ratio ?? 2) || a.name.localeCompare(b.name));
  return (
    <section className="gx-card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 text-xs font-medium">
          <span style={{ color: FRAME_STYLE.green.text }}>● {counts.green} on target</span>
          <span style={{ color: FRAME_STYLE.orange.text }}>● {counts.orange} 50–99%</span>
          <span style={{ color: FRAME_STYLE.red.text }}>● {counts.red} under 50%</span>
          {counts.none > 0 && <span style={{ color: FRAME_STYLE.none.text }}>● {counts.none} n/a</span>}
        </div>
      </div>
      <div className="p-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sorted.map((it) => {
          const t = frameTone(it.ratio);
          const s = FRAME_STYLE[t];
          const body = (
            <div className="rounded-xl p-3 h-full flex items-center gap-3 transition-shadow hover:shadow-md"
              style={{ border: `3px solid ${s.border}`, background: s.bg }} data-frame={t}>
              {it.logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={it.logoUrl} alt="" className="w-8 h-8 rounded-md object-contain bg-white border border-gray-200 shrink-0" />
                : <span className="w-8 h-8 rounded-md bg-gray-900 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">{it.name.slice(0, 2).toUpperCase()}</span>}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900 truncate">{it.name}</div>
                <div className="text-[11px] text-gray-600 truncate">{it.tag ? `${it.tag} · ` : ""}{it.detail ?? s.label}</div>
              </div>
              <div className="text-lg font-bold tabular-nums shrink-0" style={{ color: s.text }}>{pctLabel(it.ratio)}</div>
            </div>
          );
          return it.href ? <Link key={it.id} href={it.href} className="block">{body}</Link> : <div key={it.id}>{body}</div>;
        })}
        {sorted.length === 0 && <div className="text-sm text-gray-500 italic">No companies.</div>}
      </div>
    </section>
  );
}

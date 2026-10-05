"use client";

/**
 * Export button on every company page — v4.30.0.
 *
 * Everything collected for ONE company, as CSV: every post (all dates, text,
 * likes / comments / shares / views, link) and the follower history. The
 * "with competitors" lines add every company linked in Competitor Watch, so a
 * campaign review can compare like with like from a single file.
 *
 * Plain links to /api/export — the browser downloads them with the signed-in
 * session, no client-side blob juggling. Works even when the rest of the
 * company page fails to load, because it needs nothing but the company id.
 */

import { useEffect, useRef, useState } from "react";
import { Download, ChevronDown } from "lucide-react";

export function ClientExportMenu({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const one = `clientIds=${encodeURIComponent(clientId)}`;
  const withComp = `competitorsOf=${encodeURIComponent(clientId)}`;
  const items: { label: string; hint: string; href: string }[] = [
    { label: "All posts", hint: "This company, every date", href: `/api/export?dataset=posts&${one}` },
    { label: "Follower history", hint: "This company, day by day", href: `/api/export?dataset=followers&${one}` },
    { label: "All posts + competitors", hint: "Includes Competitor Watch companies", href: `/api/export?dataset=posts&${withComp}` },
    { label: "Followers + competitors", hint: "Includes Competitor Watch companies", href: `/api/export?dataset=followers&${withComp}` },
    { label: "Company summary + competitors", hint: "One line per company: links, post count, first/last post", href: `/api/export?dataset=companies&${withComp}` },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
      >
        <Download size={14} />
        Export
        <ChevronDown size={14} className="text-gray-500" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 w-80 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
        >
          {items.map((it) => (
            <a
              key={it.href}
              role="menuitem"
              href={it.href}
              download
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 hover:bg-gray-50"
            >
              <div className="text-sm font-medium text-gray-900">{it.label}</div>
              <div className="text-xs text-gray-500">{it.hint}</div>
            </a>
          ))}
          <div className="px-3 pt-1.5 pb-1 text-[11px] text-gray-400">CSV · opens in Excel or Google Sheets</div>
        </div>
      )}
    </div>
  );
}

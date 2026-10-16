"use client";

/**
 * "Download PDF" on every company page — v4.47.0.
 *
 * The one-page monthly report for this company (any category), for the month
 * in progress or any of the last 11 closed months. Plain links to
 * /api/clients/<id>/report-pdf — the browser downloads with the signed-in
 * session. Like the Export menu, it needs only the company id, so it works
 * even when the rest of the page fails to load.
 */

import { useEffect, useRef, useState } from "react";
import { FileText, ChevronDown } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthOptions(now = new Date()) {
  const out: { key: string; label: string; hint: string }[] = [];
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  for (let i = 0; i < 12; i++) {
    out.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: `${MONTHS[m]} ${y}`,
      hint: i === 0 ? `Month to date (1–${now.getUTCDate()})` : i === 1 ? "Last month" : "",
    });
    m--; if (m < 0) { m = 11; y--; }
  }
  return out;
}

export function ClientPdfMenu({ clientId }: { clientId: string }) {
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

  const base = `/api/clients/${encodeURIComponent(clientId)}/report-pdf`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
      >
        <FileText size={14} />
        Download PDF
        <ChevronDown size={14} className="text-gray-500" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1.5 w-72 max-h-96 overflow-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          {monthOptions().map((o) => (
            <a
              key={o.key}
              role="menuitem"
              href={`${base}?month=${o.key}`}
              download
              onClick={() => setOpen(false)}
              className="flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 hover:bg-gray-50"
            >
              <span className="text-sm font-medium text-gray-900">{o.label}</span>
              {o.hint && <span className="text-xs text-gray-500">{o.hint}</span>}
            </a>
          ))}
          <div className="px-3 pt-1.5 pb-1 text-[11px] text-gray-400">One-page report · PDF</div>
        </div>
      )}
    </div>
  );
}

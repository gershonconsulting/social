"use client";

/**
 * "Download PDF" on every company page — v4.47.0.
 *
 * The one-page monthly report for this company (any category), for the month
 * in progress or any of the last 11 closed months. Fetches
 * /api/clients/<id>/report-pdf with the signed-in session and saves it
 * only when a real PDF comes back (v4.59.0). Like the Export menu, it needs only the company id, so it works
 * even when the rest of the page fails to load.
 */

import { useEffect, useRef, useState } from "react";
import { FileText, ChevronDown, Loader2 } from "lucide-react";

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
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
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

  // v4.59.0 audit: fetch the PDF and verify it before saving, so an API error
  // (JSON/HTML) is shown instead of being saved as a broken .pdf file.
  async function download(monthKey: string) {
    setBusyKey(monthKey);
    setError("");
    try {
      const r = await fetch(`${base}?month=${monthKey}`, { cache: "no-store" });
      const ct = r.headers.get("content-type") || "";
      if (!r.ok || !ct.includes("application/pdf")) {
        let msg = `PDF download failed (HTTP ${r.status})`;
        try {
          if (ct.includes("application/json")) {
            const body = await r.json();
            if (body?.error) msg = String(body.error);
          }
        } catch { /* keep generic message */ }
        setError(msg);
        return;
      }
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const cd = r.headers.get("content-disposition") || "";
      const nameMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = nameMatch ? decodeURIComponent(nameMatch[1]) : `report-${monthKey}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyKey(null);
    }
  }

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
            <button
              key={o.key}
              type="button"
              role="menuitem"
              disabled={busyKey !== null}
              onClick={() => download(o.key)}
              className="w-full text-left flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-60"
            >
              <span className="text-sm font-medium text-gray-900 inline-flex items-center gap-1.5">
                {busyKey === o.key && <Loader2 size={12} className="animate-spin" />}
                {o.label}
              </span>
              {o.hint && <span className="text-xs text-gray-500">{o.hint}</span>}
            </button>
          ))}
          {error && <div role="alert" className="mx-1.5 my-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <div className="px-3 pt-1.5 pb-1 text-[11px] text-gray-400">One-page report · PDF</div>
        </div>
      )}
    </div>
  );
}

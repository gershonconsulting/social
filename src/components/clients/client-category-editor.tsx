"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Loader2, Check } from "lucide-react";

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "CLIENT", label: "Client" },
  { value: "PROSPECT", label: "Prospect" },
  { value: "PARTNER", label: "Partner" },
  { value: "COMPETITION", label: "Competition" },
  { value: "COMPANY", label: "Company" },
  { value: "INTERNAL", label: "Internal" },
];

const BADGE_STYLES: Record<string, string> = {
  CLIENT: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
  PROSPECT: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
  PARTNER: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100",
  COMPETITION: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
  COMPANY: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
  INTERNAL: "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100",
};

export function ClientCategoryEditor({
  clientId,
  initialClientType,
}: {
  clientId: string;
  initialClientType: string;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(initialClientType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = async (value: string) => {
    if (value === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const resp = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientType: value }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body?.error || `Failed (HTTP ${resp.status})`);
      }
      setCurrent(value);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const currentLabel =
    CATEGORY_OPTIONS.find((o) => o.value === current)?.label ?? current;
  const badgeClass = BADGE_STYLES[current] ?? BADGE_STYLES.INTERNAL;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors disabled:opacity-50 ${badgeClass}`}
        title="Change category"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : null}
        <span>{currentLabel}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden min-w-[160px]">
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => select(opt.value)}
              disabled={saving}
              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between gap-2 disabled:opacity-50"
            >
              <span className={opt.value === current ? "font-semibold text-gray-900" : "text-gray-700"}>
                {opt.label}
              </span>
              {opt.value === current && <Check size={12} className="text-blue-600" />}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="absolute left-0 top-full mt-1 z-20 px-3 py-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg whitespace-nowrap">
          {error}
        </div>
      )}
    </div>
  );
}

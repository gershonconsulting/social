"use client";

import { useState } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";

export function CampaignDateEditor({
  clientId,
  initialDate,
}: {
  clientId: string;
  initialDate: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialDate ? initialDate.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignStartDate: value
            ? new Date(value + "T00:00:00").toISOString()
            : null,
        }),
      });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setError(`HTTP ${r.status}`);
      } else {
        const j = await r.json();
        if (j.success) {
          setEditing(false);
          window.location.assign(window.location.pathname + window.location.search);
          return;
        } else {
          setError(j.error || "Save failed");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1 group">
        <span>
          {initialDate
            ? `Campaign started ${new Date(initialDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
            : "Campaign start date not set"}
        </span>
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 ml-1"
          title="Edit campaign start date"
        >
          <Pencil size={11} />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className="text-gray-500 mr-1">Campaign started</span>
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="text-xs border-b border-blue-500 bg-transparent outline-none px-0"
        autoFocus
        disabled={saving}
      />
      <button onClick={save} disabled={saving} className="text-green-600 hover:text-green-700 disabled:opacity-50" title="Save">
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button onClick={() => setEditing(false)} disabled={saving} className="text-red-500 hover:text-red-600 disabled:opacity-50" title="Cancel">
        <X size={12} />
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </span>
  );
}

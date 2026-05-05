"use client";

import { useState } from "react";
import { ExternalLink, Pencil, Check, X, Loader2 } from "lucide-react";

const PLATFORM_HINTS: Record<string, string> = {
  LINKEDIN: "https://www.linkedin.com/company/<vanity-name>",
  TWITTER: "https://x.com/<handle>",
  GOOGLE_BUSINESS: "Set in /admin (location ID is required)",
};

export function ConnectionUrlEditor({
  connectionId,
  platform,
  initialUrl,
  initialName,
}: {
  connectionId: string;
  platform: string;
  initialUrl: string | null;
  initialName: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  async function save() {
    const trimmed = url.trim();
    if (trimmed === (initialUrl ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/platforms/${connectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalAccountUrl: trimmed || null }),
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
        {initialUrl ? (
          <a
            href={initialUrl.startsWith("http") ? initialUrl : `https://${initialUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink size={10} />
            {initialName ?? initialUrl.replace(/^https?:\/\/(?:www\.)?/, "")}
          </a>
        ) : (
          <span className="text-gray-400">{initialName ?? "Not configured"}</span>
        )}
        <button
          onClick={() => {
            setUrl(initialUrl ?? "");
            setEditing(true);
            setError("");
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 ml-1"
          title="Edit account URL"
        >
          <Pencil size={11} />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder={PLATFORM_HINTS[platform] ?? "https://…"}
        className="text-xs border-b border-blue-500 bg-transparent outline-none px-0 py-0 min-w-[260px]"
        autoFocus
        disabled={saving}
      />
      <button
        onClick={save}
        disabled={saving}
        className="text-green-600 hover:text-green-700 disabled:opacity-50"
        title="Save"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button
        onClick={() => setEditing(false)}
        disabled={saving}
        className="text-red-500 hover:text-red-600 disabled:opacity-50"
        title="Cancel"
      >
        <X size={12} />
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </span>
  );
}

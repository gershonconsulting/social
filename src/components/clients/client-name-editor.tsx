"use client";
import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";

export function ClientNameEditor({
  clientId,
  initialName,
}: {
  clientId: string;
  initialName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = async () => {
    if (!name.trim() || name === initialName) {
      setName(initialName);
      setEditing(false);
      return;
    }

    setSaving(true);
    setError("");
    let lastErr = "";
    // Retry transient 500s instead of silently reverting the rename.
    for (let i = 0; i < 3; i++) {
      try {
        const resp = await fetch(`/api/clients/${clientId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
        if (resp.ok) {
          setSaving(false);
          setEditing(false);
          // Soft refresh that keeps the user on this page (window.location.reload
          // can land on a Cloudflare Worker error page during edge cold-starts;
          // a router.refresh() is more forgiving).
          window.location.assign(window.location.pathname + window.location.search);
          return;
        }
        const body: { error?: string } | null = await resp.json().catch(() => null);
        lastErr = body?.error || `Failed (HTTP ${resp.status})`;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "Network error";
      }
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
    setSaving(false);
    setError(lastErr || "Could not save name");
  };

  const cancel = () => {
    setName(initialName);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2 group">
        <span>{name}</span>
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600"
          title="Edit client name"
        >
          <Pencil size={14} />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        className="text-2xl font-bold text-gray-900 border-b-2 border-blue-500 bg-transparent outline-none px-0 py-0"
        style={{ width: Math.max(200, name.length * 14) + "px" }}
        disabled={saving}
      />
      <button
        onClick={save}
        disabled={saving}
        className="text-green-600 hover:text-green-700 disabled:opacity-50"
        title="Save"
      >
        <Check size={18} />
      </button>
      <button
        onClick={cancel}
        disabled={saving}
        className="text-red-500 hover:text-red-600 disabled:opacity-50"
        title="Cancel"
      >
        <X size={18} />
      </button>
      {error && (
        <span className="ml-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-0.5">
          {error}
        </span>
      )}
    </span>
  );
}

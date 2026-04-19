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
    try {
      const resp = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!resp.ok) throw new Error("Failed to update");
      setEditing(false);
      // Refresh the page to show updated name everywhere
      window.location.reload();
    } catch {
      setName(initialName);
      setEditing(false);
    } finally {
      setSaving(false);
    }
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
    </span>
  );
}

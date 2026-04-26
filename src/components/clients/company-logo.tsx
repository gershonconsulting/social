"use client";

import { useState } from "react";
import { Building2, Pencil, Check, X } from "lucide-react";

interface CompanyLogoProps {
  clientId: string;
  logoUrl: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
}

export function CompanyLogo({ clientId, logoUrl, name, size = "md" }: CompanyLogoProps) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(logoUrl || "");
  const [currentLogo, setCurrentLogo] = useState(logoUrl);
  const [saving, setSaving] = useState(false);

  const sizes = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };

  const iconSizes = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  async function handleSave() {
    setSaving(true);
    try {
      const resp = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: url || null }),
      });
      if (resp.ok) {
        setCurrentLogo(url || null);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {/* Logo display */}
      <div className={`${sizes[size]} rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0 border border-gray-200`}>
        {currentLogo ? (
          <img
            src={currentLogo}
            alt={`${name} logo`}
            className="w-full h-full object-contain p-1"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
            }}
          />
        ) : null}
        <Building2 className={`${iconSizes[size]} text-gray-400 ${currentLogo ? "hidden" : ""}`} />
      </div>

      {/* Edit button / form */}
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
            className="text-xs border border-gray-300 rounded px-2 py-1 w-64 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1 text-green-600 hover:bg-green-50 rounded"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setEditing(false); setUrl(currentLogo || ""); }}
            className="p-1 text-gray-400 hover:bg-gray-50 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="Edit logo URL"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

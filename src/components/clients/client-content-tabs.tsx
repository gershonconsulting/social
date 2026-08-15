"use client";

import { useState } from "react";
import { List, Sparkles } from "lucide-react";
import { PostsListing } from "./posts-listing";
import { ContentIntelligence } from "./content-intelligence";

/**
 * Company detail: collected content (Posts) and the analysis layer built on top
 * of it (Content Intelligence). Deliberately one tab strip so it reads as two
 * views of the same body of content rather than two unrelated features.
 */
export function ClientContentTabs({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [tab, setTab] = useState<"posts" | "intelligence">("posts");

  const tabs = [
    { key: "posts" as const, label: "Collected posts", icon: List },
    { key: "intelligence" as const, label: "Content Intelligence", icon: Sparkles },
  ];

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit bg-white">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              i < tabs.length - 1 ? "border-r border-gray-200" : ""
            } ${tab === t.key ? "bg-red-50 text-[#FE1B04]" : "text-gray-500 hover:bg-gray-50"}`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "posts" ? (
        <PostsListing clientId={clientId} />
      ) : (
        <ContentIntelligence clientId={clientId} clientName={clientName} />
      )}
    </div>
  );
}

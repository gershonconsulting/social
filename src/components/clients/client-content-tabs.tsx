"use client";

import { useState } from "react";
import { List, Sparkles, Swords } from "lucide-react";
import { PostsListing } from "./posts-listing";
import { ContentIntelligence } from "./content-intelligence";
import { CompetitorWatch } from "./competitor-watch";
import { canWatchCompetitors } from "@/lib/competitors/watchable";

/**
 * Company detail: collected content (Posts) and the analysis layer built on
 * top of it (Content Intelligence). v4.65.0: Post Studio (writing posts) left
 * with the rest of publishing — Social only collects and understands.
 */
export function ClientContentTabs({
  clientId,
  clientName,
  clientType,
}: {
  clientId: string;
  clientName: string;
  clientType?: string;
}) {
  const [tab, setTab] = useState<"posts" | "intelligence" | "competitors">("posts");
  // v4.83.0: own company (INTERNAL) plus campaign clients and clients.
  const watchable = canWatchCompetitors(clientType);

  const tabs = [
    { key: "posts" as const, label: "Collected posts", icon: List },
    { key: "intelligence" as const, label: "Content Intelligence", icon: Sparkles },
    ...(watchable ? [{ key: "competitors" as const, label: "Competitor Watch", icon: Swords }] : []),
  ];

  // Defensive: don't leave a now-hidden tab selected.
  const active = tab === "competitors" && !watchable ? "posts" : tab;

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit bg-white">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              i < tabs.length - 1 ? "border-r border-gray-200" : ""
            } ${active === t.key ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {active === "posts" && <PostsListing clientId={clientId} />}
      {active === "intelligence" && <ContentIntelligence clientId={clientId} clientName={clientName} />}
      {active === "competitors" && <CompetitorWatch clientId={clientId} clientName={clientName} />}
    </div>
  );
}

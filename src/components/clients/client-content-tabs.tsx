"use client";

import { useState } from "react";
import { List, Sparkles, PenLine } from "lucide-react";
import { PostsListing } from "./posts-listing";
import { ContentIntelligence } from "./content-intelligence";
import { PostStudio } from "./post-studio";

/**
 * Company detail: collected content (Posts), the analysis layer built on top of
 * it (Content Intelligence), and — for CAMPAIGN accounts only — the writing
 * brief generated from it (Post Studio). Deliberately one tab strip so it reads
 * as three views of the same body of content rather than unrelated features.
 *
 * Post Studio is campaign-only by product rule. Hiding the tab is the courtesy;
 * the API enforces it too, so a hand-typed request gets 403 NOT_CAMPAIGN.
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
  const [tab, setTab] = useState<"posts" | "intelligence" | "studio">("posts");
  const isCampaign = clientType === "CAMPAIGN";

  const tabs = [
    { key: "posts" as const, label: "Collected posts", icon: List },
    { key: "intelligence" as const, label: "Content Intelligence", icon: Sparkles },
    ...(isCampaign ? [{ key: "studio" as const, label: "Post Studio", icon: PenLine }] : []),
  ];

  // Defensive: if a company is re-categorized away from CAMPAIGN while this
  // panel is mounted, don't leave a now-hidden tab selected.
  const active = tab === "studio" && !isCampaign ? "posts" : tab;

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit bg-white">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              i < tabs.length - 1 ? "border-r border-gray-200" : ""
            } ${active === t.key ? "bg-red-50 text-[#FE1B04]" : "text-gray-500 hover:bg-gray-50"}`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {active === "posts" && <PostsListing clientId={clientId} />}
      {active === "intelligence" && <ContentIntelligence clientId={clientId} clientName={clientName} />}
      {active === "studio" && isCampaign && <PostStudio clientId={clientId} clientName={clientName} />}
    </div>
  );
}

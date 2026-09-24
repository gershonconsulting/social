"use client";

/**
 * Page header — v4.9.0. One pattern on every page: section eyebrow, title,
 * one-line description, freshness, and the page's actions on the right.
 * The eyebrow is derived from the route so no page has to pass it.
 */

import { usePathname } from "next/navigation";
import { formatRelative, freshnessFromLastSync } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

interface HeaderProps {
  title: string;
  subtitle?: string;
  lastSyncAt?: string | null;
  actions?: React.ReactNode;
  /** Overrides the section label derived from the route. */
  eyebrow?: string;
}

const SECTIONS: [string, string][] = [
  ["/dashboard", "Overview"],
  ["/summary", "Overview"],
  ["/clients", "Portfolio"],
  ["/networks", "Portfolio"],
  ["/analytics", "Portfolio"],
  ["/followers", "Portfolio"],
  ["/reports", "Portfolio"],
  ["/logs", "System"],
  ["/errors", "System"],
  ["/admin", "Workspace"],
  ["/settings", "Workspace"],
];

function sectionFor(pathname: string): string | null {
  const hit = SECTIONS.find(([p]) => pathname === p || pathname.startsWith(p + "/"));
  return hit ? hit[1] : null;
}

export function Header({ title, subtitle, lastSyncAt, actions, eyebrow }: HeaderProps) {
  const pathname = usePathname() || "";
  const freshness = lastSyncAt ? freshnessFromLastSync(lastSyncAt) : null;
  const section = eyebrow ?? sectionFor(pathname);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div className="min-w-0">
        {section && <div className="text-[13px] font-medium text-gray-500 mb-1">{section}</div>}
        <h1 className="text-[26px] leading-tight font-semibold text-gray-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-gray-600 mt-1 max-w-3xl">{subtitle}</p>}
        {freshness && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <div className={`text-xs font-medium ${freshness.color}`}>
              <span className="inline-flex items-center gap-1">
                <RefreshCw size={10} />
                {freshness.label}
              </span>
            </div>
            <span className="text-xs text-gray-500">· Last sync {formatRelative(lastSyncAt)}</span>
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

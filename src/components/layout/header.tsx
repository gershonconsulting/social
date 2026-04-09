"use client";

import { formatRelative, freshnessFromLastSync } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

interface HeaderProps {
  title: string;
  subtitle?: string;
  lastSyncAt?: string | null;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, lastSyncAt, actions }: HeaderProps) {
  const freshness = lastSyncAt ? freshnessFromLastSync(lastSyncAt) : null;

  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        {freshness && (
          <div className="flex items-center gap-1.5 mt-1">
            <div className={`text-xs font-medium ${freshness.color}`}>
              <span className="inline-flex items-center gap-1">
                <RefreshCw size={10} />
                {freshness.label}
              </span>
            </div>
            <span className="text-xs text-gray-400">
              · Last sync {formatRelative(lastSyncAt)}
            </span>
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

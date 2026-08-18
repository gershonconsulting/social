"use client";

/**
 * FilterPanel — the view filters, in the left menu.
 *
 * Three groups of check buttons: Category, Month, Network. Category and
 * Network are multi-select (nothing ticked = no filter); Month is one at a
 * time plus an "All time" option. The panel only shows on the pages the
 * filters actually drive, so it never promises something it can't deliver.
 */

import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, SlidersHorizontal } from "lucide-react";
import {
  CATEGORY_OPTIONS,
  NETWORK_OPTIONS,
  recentMonths,
  useViewFilters,
} from "@/lib/view-filters";

/** Pages whose content the shared filters actually drive. */
const FILTERED_PATHS = ["/dashboard", "/summary"];

function Check({ on, label, count, onClick }: { on: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="checkbox"
      aria-checked={on}
      className={
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left transition-colors " +
        (on ? "bg-red-50 text-[#FE1B04] font-semibold" : "text-gray-600 hover:bg-gray-50")
      }
    >
      <span
        className={
          "w-3.5 h-3.5 rounded-[4px] border flex-shrink-0 flex items-center justify-center " +
          (on ? "bg-[#FE1B04] border-[#FE1B04]" : "border-gray-300 bg-white")
        }
      >
        {on && (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 6.4l2.3 2.3 4.7-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11px] text-gray-400">{count}</span>}
    </button>
  );
}

function Group({
  title,
  hint,
  open,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500 hover:text-gray-800"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {title}
        {hint && <span className="ml-auto text-[10px] font-medium normal-case tracking-normal text-gray-400">{hint}</span>}
      </button>
      {open && <div className="space-y-0.5 pb-1">{children}</div>}
    </div>
  );
}

export function FilterPanel() {
  const pathname = usePathname();
  const { categories, networks, month, toggleCategory, toggleNetwork, setMonth, reset, isDefault } = useViewFilters();
  const [openCat, setOpenCat] = useState(true);
  const [openMonth, setOpenMonth] = useState(false);
  const [openNet, setOpenNet] = useState(false);

  const applies = FILTERED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!applies) return null;

  const months = recentMonths(12);

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center gap-2 px-2 mb-1">
        <SlidersHorizontal size={13} className="text-gray-400" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Filter view</span>
        {!isDefault && (
          <button
            onClick={reset}
            title="Back to the default view: Campaign, this month, all networks"
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-[#FE1B04] hover:underline"
          >
            <RotateCcw size={10} /> Reset
          </button>
        )}
      </div>

      <Group
        title="By category"
        hint={categories.length === 0 ? "all" : `${categories.length} on`}
        open={openCat}
        onToggle={() => setOpenCat((o) => !o)}
      >
        {CATEGORY_OPTIONS.map((c) => (
          <Check key={c.key} on={categories.includes(c.key)} label={c.label} onClick={() => toggleCategory(c.key)} />
        ))}
      </Group>

      <Group
        title="By month"
        hint={month === "ALL" ? "all time" : undefined}
        open={openMonth}
        onToggle={() => setOpenMonth((o) => !o)}
      >
        <Check on={month === "ALL"} label="All time" onClick={() => setMonth("ALL")} />
        <div className="max-h-52 overflow-y-auto space-y-0.5">
          {months.map((m) => (
            <Check key={m.key} on={month === m.key} label={m.label} onClick={() => setMonth(m.key)} />
          ))}
        </div>
      </Group>

      <Group
        title="By network"
        hint={networks.length === 0 ? "all" : `${networks.length} on`}
        open={openNet}
        onToggle={() => setOpenNet((o) => !o)}
      >
        {NETWORK_OPTIONS.map((n) => (
          <Check key={n.key} on={networks.includes(n.key)} label={n.label} onClick={() => toggleNetwork(n.key)} />
        ))}
      </Group>
    </div>
  );
}

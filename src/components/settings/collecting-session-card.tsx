"use client";

import { Monitor, Eye } from "lucide-react";
import { useCollectingMode } from "@/lib/collecting-mode";

/**
 * "This computer" — the per-machine Collecting session switch.
 *
 * See src/lib/collecting-mode.ts for why this is stored per browser profile
 * rather than on the account.
 */
export function CollectingSessionCard() {
  const [collecting, setCollecting] = useCollectingMode();

  const option = (on: boolean, title: string, sub: string) => {
    const selected = collecting === on;
    return (
      <label
        className={
          "flex items-start gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors " +
          (selected ? "border-red-500 bg-red-50/60" : "border-gray-200 bg-white hover:bg-gray-50")
        }
      >
        <input
          type="radio"
          name="social-collecting"
          value={on ? "on" : "off"}
          checked={selected}
          onChange={() => setCollecting(on)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
        />
        <span>
          <span className="block text-sm font-semibold text-gray-900">{title}</span>
          <span className="block text-xs text-gray-600 leading-relaxed mt-1">{sub}</span>
        </span>
      </label>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-start gap-3 mb-1">
        <Monitor size={18} className="text-red-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">This computer</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Is this machine capturing the LinkedIn and X sessions, or only looking at the results?
          </div>
        </div>
        <span
          className={
            "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 " +
            (collecting ? "text-green-700 bg-green-50" : "text-gray-600 bg-gray-100")
          }
        >
          {collecting ? "Collecting" : (<><Eye size={12} /> Viewing only</>)}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 mt-4">
        {option(
          true,
          "Collecting session — ON",
          "This computer runs the GershonAI Chrome extension and captures the sessions the scrapers use. GershonAI keeps warning you here when a session is missing or stale.",
        )}
        {option(
          false,
          "Collecting session — OFF (viewing only)",
          "This computer only reads the dashboards. No Chrome extension needed here — the warnings stop telling this browser to install or sync it.",
        )}
      </div>

      <p className="text-xs text-gray-500 leading-relaxed mt-4">
        Saved on <strong>this computer only</strong>, not on your GershonAI account — so the collecting
        machine and every viewer can each be set independently on the same login. A stale capture is still
        reported on a viewer; it just points at the collecting computer instead of at this browser.
      </p>
    </div>
  );
}

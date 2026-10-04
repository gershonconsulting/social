"use client";

/**
 * Red strip on every dashboard page when LinkedIn collection is broken: the
 * last companies collected ALL came back with zero posts — the sign that
 * LinkedIn changed its pages and the collector can't read them (Olivier,
 * 2026-10-04, "Cytel has never posted"). Silent when collection is healthy.
 */
import { useEffect, useState } from "react";
import { AlertOctagon } from "lucide-react";

type Alarm = { since: string; companies: number; sampleError: string | null };

export function CollectionHealthBanner() {
  const [alarm, setAlarm] = useState<Alarm | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/collection-health", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (live && j?.success) setAlarm(j.data?.linkedin ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!alarm) return null;
  const since = new Date(alarm.since).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (
    <div className="bg-[#FE1B04] text-white rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
      <AlertOctagon size={18} className="shrink-0 mt-0.5" />
      <div className="text-sm">
        <strong>LinkedIn collection is not working.</strong>{" "}
        Since {since}, all {alarm.companies} companies collected came back with no posts — LinkedIn has most
        likely changed its pages. LinkedIn numbers on this dashboard are not up to date until this is fixed.
        {alarm.sampleError && <span className="block text-xs opacity-90 mt-1">Collector said: {alarm.sampleError}</span>}
      </div>
    </div>
  );
}

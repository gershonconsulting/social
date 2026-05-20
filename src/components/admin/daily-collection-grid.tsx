"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, X as XIcon, AlertTriangle, Loader2, RefreshCw } from "lucide-react";

interface PerDay { LINKEDIN: boolean; TWITTER: boolean; GOOGLE_BUSINESS: boolean }
interface Row {
  id: string;
  name: string;
  slug: string;
  clientType: string;
  status: Record<string, PerDay>;
}
interface Data { days: string[]; platforms: string[]; clients: Row[] }

const PLATFORM_LABEL: Record<string, string> = {
  LINKEDIN: "LI",
  TWITTER: "X",
  GOOGLE_BUSINESS: "GMB",
};

function shortDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

async function fetchWithRetry(url: string): Promise<Response | null> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok || r.status < 500) return r;
    } catch {}
    await new Promise((res) => setTimeout(res, 250 * (i + 1)));
  }
  return null;
}

export function DailyCollectionGrid() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    (async () => {
      const r = await fetchWithRetry("/api/admin/daily-collection-status?days=7");
      if (cancelled) return;
      if (!r) { setError("All retries failed"); return; }
      try {
        const j = await r.json();
        if (j.success) setData(j.data);
        else setError(j.error || "Unknown error");
      } catch { setError("Server returned non-JSON"); }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  if (!data && !error) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400 bg-white rounded-xl border border-gray-200">
        <Loader2 size={14} className="animate-spin" />
        Loading daily collection status…
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <AlertTriangle size={14} className="inline mr-1.5" />
        Couldn&apos;t load daily collection status: {error}
        <button onClick={() => setAttempt((a) => a + 1)} className="ml-2 underline text-amber-700">retry</button>
      </div>
    );
  }
  if (!data) return null;

  const today = data.days[0];
  const todayCounts = { ok: 0, missing: 0, notConfigured: 0 };
  for (const c of data.clients) {
    for (const p of data.platforms) {
      if (c.status[today][p as keyof PerDay]) todayCounts.ok++;
      else todayCounts.missing++;
    }
  }
  // Identify clients with at least one platform missing TODAY
  const missingToday = data.clients.filter((c) => {
    return data.platforms.some((p) => !c.status[today][p as keyof PerDay]);
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Daily collection — {shortDay(today)}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            ✓ = we ingested at least one post for that company × platform on that day. Grid shows last 7 days.
          </div>
        </div>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 px-5 py-3 border-b border-gray-100 text-xs">
        <div className="rounded-lg border border-green-200 bg-green-50 p-2">
          <div className="font-medium text-green-700 uppercase text-[10px]">Got data today</div>
          <div className="text-lg font-bold text-green-700 mt-0.5">{todayCounts.ok}</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-2">
          <div className="font-medium text-red-700 uppercase text-[10px]">Missing today</div>
          <div className="text-lg font-bold text-red-700 mt-0.5">{todayCounts.missing}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
          <div className="font-medium text-gray-700 uppercase text-[10px]">Companies × platforms</div>
          <div className="text-lg font-bold text-gray-900 mt-0.5">{data.clients.length * data.platforms.length}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-500">Company</th>
              {data.days.map((d) => (
                data.platforms.map((p) => (
                  <th key={d + p} className="text-center px-2 py-2 font-medium text-gray-500 border-l border-gray-100" title={`${shortDay(d)} · ${p}`}>
                    <div className="text-[10px] text-gray-400">{shortDay(d)}</div>
                    <div className="text-[10px] mt-0.5">{PLATFORM_LABEL[p] ?? p}</div>
                  </th>
                ))
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.clients.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  <Link href={`/clients/${c.id}`} className="text-gray-900 hover:underline hover:text-blue-700">
                    {c.name}
                  </Link>
                </td>
                {data.days.map((d) => (
                  data.platforms.map((p) => {
                    const ok = c.status[d][p as keyof PerDay];
                    return (
                      <td key={d + p} className="text-center px-2 py-1.5 border-l border-gray-100">
                        {ok
                          ? <Check size={14} strokeWidth={3} className="text-green-600 inline-block" />
                          : <XIcon size={14} strokeWidth={2.5} className="text-red-400 inline-block" />
                        }
                      </td>
                    );
                  })
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {missingToday.length > 0 && (
        <div className="px-5 py-3 border-t border-gray-100 bg-amber-50/50 text-xs">
          <div className="font-medium text-amber-900 mb-1">
            Missing today ({missingToday.length} companies)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missingToday.map((c) => (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-amber-200 rounded text-amber-900 hover:bg-amber-100"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

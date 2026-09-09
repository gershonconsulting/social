"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertOctagon } from "lucide-react";
import { useCollectingMode } from "@/lib/collecting-mode";

/**
 * ExtensionHealthBanner — single red warning shown at the top of /dashboard
 * when the GershonAI Chrome extension hasn't captured cookies, or captured
 * them too long ago to be useful.
 *
 * Rules:
 * - If EITHER LinkedIn or X cookies are missing (never captured) → red.
 * - If EITHER set was captured more than STALE_DAYS days ago → red.
 * - Otherwise → invisible.
 */
const STALE_DAYS = 7;

interface CookieStatus {
  capturedAt: string;
  cookieCount: number;
}

export function ExtensionHealthBanner() {
  const [collecting] = useCollectingMode();
  const [li, setLi] = useState<CookieStatus | null | "loading">("loading");
  const [tw, setTw] = useState<CookieStatus | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/cookies/save", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!j?.success || cancelled) return;
        setLi(j.data.LINKEDIN ?? null);
        setTw(j.data.TWITTER ?? null);
      } catch {
        if (!cancelled) {
          setLi(null);
          setTw(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (li === "loading" || tw === "loading") return null;

  const now = Date.now();
  const isStale = (s: CookieStatus | null): boolean => {
    if (!s) return true;
    const age = now - new Date(s.capturedAt).getTime();
    return age > STALE_DAYS * 86400000;
  };
  const liStale = isStale(li);
  const twStale = isStale(tw);
  if (!liStale && !twStale) return null;

  const missingLabels: string[] = [];
  if (li === null) missingLabels.push("LinkedIn (never captured)");
  else if (liStale) missingLabels.push(`LinkedIn (last captured > ${STALE_DAYS} days ago)`);
  if (tw === null) missingLabels.push("X / Twitter (never captured)");
  else if (twStale) missingLabels.push(`X / Twitter (last captured > ${STALE_DAYS} days ago)`);

  return (
    <div className="bg-red-50 border border-red-300 rounded-xl p-4 mb-6 flex items-start gap-3">
      <AlertOctagon size={18} className="text-red-600 mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="text-sm font-semibold text-red-900">
          GershonAI Chrome extension session(s) missing or stale
        </div>
        <div className="text-xs text-red-800 mt-1 leading-relaxed">
          {missingLabels.join(" · ")}
          .
          <br />
          The platform can&apos;t scrape new posts without fresh cookies.
          {collecting ? (
            <> Open the GershonAI Chrome extension and click <strong>Sync Now</strong> to refresh both sessions.</>
          ) : (
            <> This computer is set to <strong>viewing only</strong>, so there is nothing to fix here &mdash; refresh the sessions on the computer that runs the extension.</>
          )}
          {" "}<Link href="/settings" className="underline font-medium text-red-700 hover:text-red-900">View status</Link>
        </div>
      </div>
    </div>
  );
}

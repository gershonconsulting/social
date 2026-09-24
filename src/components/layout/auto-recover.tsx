"use client";

/**
 * Shown instead of Next's bare "Application error: a client-side exception
 * has occurred" screen.
 *
 * WHY. The worker behind this app intermittently answers with Cloudflare
 * Error 1102 while a cold isolate loads the Prisma engine (see
 * project_social_outage_2026_08_21). When that happens during an in-app
 * navigation, or when a tab still holds scripts from the previous deploy,
 * the page used to die with that message. Both cases are cured by simply
 * loading the page again, so we do that for the user: up to 3 automatic
 * retries a minute apart-ish, then a plain button.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const KEY = "gx-auto-recover";
const MAX = 3;

function readCount(): { n: number; at: number } {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as { n: number; at: number };
      if (Date.now() - v.at < 60_000) return v;
    }
  } catch {}
  return { n: 0, at: Date.now() };
}

export function AutoRecover({ error }: { error?: Error & { digest?: string } }) {
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    // Keep the real error in the console for debugging.
    if (error) console.error("[gx] recovered from:", error);
    const c = readCount();
    if (c.n >= MAX) {
      setGaveUp(true);
      return;
    }
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ n: c.n + 1, at: c.at }));
    } catch {}
    const t = setTimeout(() => window.location.reload(), 1500 + c.n * 1500);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-8 text-center space-y-3">
        <RefreshCw className={"mx-auto text-gray-500 " + (gaveUp ? "" : "animate-spin")} size={22} />
        <h2 className="text-lg font-semibold text-gray-900">
          {gaveUp ? "This page didn't load" : "Reloading…"}
        </h2>
        <p className="text-sm text-gray-600">
          {gaveUp
            ? "The server was busy. Try again in a moment."
            : "The server took too long to answer. Trying again automatically."}
        </p>
        {gaveUp && (
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.removeItem(KEY); } catch {}
              window.location.reload();
            }}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

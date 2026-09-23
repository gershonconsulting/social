"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor, Eye, KeyRound, Copy, Check, RefreshCw } from "lucide-react";
import { useCollectingMode } from "@/lib/collecting-mode";

/**
 * "This computer" — the per-machine Collecting session switch.
 *
 * See src/lib/collecting-mode.ts for why this is stored per browser profile
 * rather than on the account.
 *
 * It also carries the workspace token, because this is where the question
 * "does this machine collect?" is answered and the token is what says which
 * workspace it collects FOR. One extension, many customers: the same build
 * feeds whichever workspace its token belongs to.
 */

function WorkspaceToken() {
  const [token, setToken] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rotate = false) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/extension-token", {
        method: rotate ? "POST" : "GET",
      });
      const json = (await res.json()) as {
        success: boolean;
        data?: { token: string };
        error?: string;
      };
      if (!json.success || !json.data) throw new Error(json.error || "Couldn't load the token");
      setToken(json.data.token);
      if (rotate) setShown(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the token");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setShown(true); // clipboard blocked — at least let them select it
    }
  };

  const masked = token ? token.slice(0, 6) + "•".repeat(18) + token.slice(-4) : "";

  return (
    <div className="mt-5 pt-5 border-t border-gray-100">
      <div className="flex items-start gap-3">
        <KeyRound size={16} className="text-red-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900">Workspace token</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Paste this into the GershonAI extension so what it collects lands in this workspace.
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <code className="text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-800 break-all">
              {error ? "—" : token ? (shown ? token : masked) : "loading…"}
            </code>
            {token && (
              <>
                <button
                  type="button"
                  onClick={() => setShown((v) => !v)}
                  className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1.5 rounded-lg hover:bg-gray-100"
                >
                  {shown ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50"
                >
                  {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Replace this token? Every extension still using the old one stops collecting until you paste in the new one.",
                      )
                    ) {
                      void load(true);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-red-600 px-2.5 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50"
                >
                  <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
                  Replace
                </button>
              </>
            )}
          </div>

          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          <p className="text-xs text-gray-500 leading-relaxed mt-3">
            Treat it like a password: anyone holding it can read this workspace&apos;s client list and
            write posts into it. Replace it if it leaks — nothing else breaks.
          </p>
        </div>
      </div>
    </div>
  );
}

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

      {collecting && <WorkspaceToken />}

      <p className="text-xs text-gray-500 leading-relaxed mt-4">
        Saved on <strong>this computer only</strong>, not on your GershonAI account — so the collecting
        machine and every viewer can each be set independently on the same login. A stale capture is still
        reported on a viewer; it just points at the collecting computer instead of at this browser.
      </p>
    </div>
  );
}

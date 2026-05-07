"use client";

import { useEffect, useState } from "react";
import { Linkedin, ArrowRight, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Cookie-capture helper.
 *
 * Olivier's request: 'I always have LinkedIn and Twitter opened in the same
 * browser. Looking for the cookies is a pain for me. We should have a section
 * in the settings to collect the cookies for both.'
 *
 * Approach:
 *  1. Show a bookmarklet that, when clicked while on x.com / twitter.com,
 *     reads document.cookie, extracts auth_token + ct0, and opens our
 *     /settings page with the cookies in the URL #fragment.
 *  2. This component listens for that fragment on mount and POSTs the
 *     captured cookies to /api/settings/twitter automatically.
 *  3. Fragment is cleared from the URL right after — never lands in server
 *     logs (fragments don't get sent to servers) but we strip it anyway
 *     so it doesn't sit in browser history.
 *
 * LinkedIn note: LinkedIn's official API is OAuth-only (cookies don't grant
 * access to api.linkedin.com), so for LinkedIn the right action is the
 * Reconnect button rather than cookie capture. Calling that out in the UI.
 */

const BOOKMARKLET = `javascript:(()=>{const c=document.cookie.split(';').reduce((m,p)=>{const[k,...v]=p.trim().split('=');m[k]=v.join('=');return m;},{});const isX=location.hostname.includes('x.com')||location.hostname.includes('twitter.com');if(!isX){alert('Run this from x.com (or twitter.com) while signed in.');return;}if(!c.auth_token||!c.ct0){alert('Could not find auth_token or ct0 cookies. Make sure you are signed in.');return;}const payload={authToken:c.auth_token,ct0:c.ct0};const url='https://social.gershoncrm.com/settings#twitter-cookies='+encodeURIComponent(JSON.stringify(payload));window.open(url,'_blank');})();`;

export function CookieCaptureHelper({ onSaved }: { onSaved: () => void }) {
  const [autoSave, setAutoSave] = useState<{ status: "idle" | "saving" | "ok" | "fail"; message: string }>({ status: "idle", message: "" });
  const [showCopied, setShowCopied] = useState(false);

  // On mount: detect a #twitter-cookies=... fragment and auto-save
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    const m = hash.match(/^#twitter-cookies=(.+)$/);
    if (!m) return;
    let payload: { authToken?: string; ct0?: string } | null = null;
    try {
      payload = JSON.parse(decodeURIComponent(m[1]));
    } catch {
      setAutoSave({ status: "fail", message: "Could not parse the captured cookies. Re-run the bookmarklet." });
      return;
    }
    if (!payload?.authToken || !payload?.ct0) {
      setAutoSave({ status: "fail", message: "auth_token or ct0 was missing. Make sure you're signed into x.com." });
      return;
    }
    // Strip the fragment from the URL immediately — don't keep it sitting in browser history
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setAutoSave({ status: "saving", message: "Saving X / Twitter cookies…" });
    fetch("/api/settings/twitter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authToken: payload.authToken, ct0: payload.ct0 }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.success) {
          setAutoSave({ status: "ok", message: j.message || "X / Twitter cookies saved across all connections." });
          onSaved();
        } else {
          setAutoSave({ status: "fail", message: j.error || `HTTP ${r.status}` });
        }
      })
      .catch((e) => {
        setAutoSave({ status: "fail", message: e instanceof Error ? e.message : "Network error" });
      });
  }, [onSaved]);

  async function copyBookmarklet() {
    try {
      await navigator.clipboard.writeText(BOOKMARKLET);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2200);
    } catch {
      // ignore — the drag link is still the primary path
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">One-click cookie capture</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Drag the bookmarklet to your bookmarks bar, then click it once while you're signed
          into x.com. It captures auth_token + ct0 and opens this page with them — no DevTools spelunking.
        </p>
      </div>

      {(autoSave.status === "saving" || autoSave.status === "ok" || autoSave.status === "fail") && (
        <div
          className={`px-6 py-3 text-xs flex items-center gap-2 border-b border-gray-100 ${
            autoSave.status === "ok"
              ? "bg-green-50 text-green-800"
              : autoSave.status === "fail"
                ? "bg-amber-50 text-amber-800"
                : "bg-blue-50 text-blue-800"
          }`}
        >
          {autoSave.status === "saving" && <Loader2 size={14} className="animate-spin" />}
          {autoSave.status === "ok" && <CheckCircle2 size={14} />}
          {autoSave.status === "fail" && <AlertTriangle size={14} />}
          <span>{autoSave.message}</span>
        </div>
      )}

      <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* X / Twitter */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 bg-black text-white rounded text-xs font-bold">𝕏</span>
            <span className="text-sm font-semibold text-gray-900">X / Twitter</span>
          </div>
          <p className="text-xs text-gray-600">
            Drag this link to your bookmarks bar, then click it from any x.com tab while logged in.
          </p>
          <a
            href={BOOKMARKLET}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(e: any) => e.preventDefault()}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 cursor-grab active:cursor-grabbing select-none"
            draggable
            title="Drag this to your bookmarks bar — don't click here, your browser will refuse to run it from this page"
          >
            ⤴ Capture X cookies
          </a>
          <button
            onClick={copyBookmarklet}
            className="text-xs text-gray-600 hover:text-gray-900 underline self-start"
          >
            {showCopied ? "Copied!" : "Or copy the JavaScript and paste into a manual bookmark"}
          </button>
        </div>

        {/* LinkedIn */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 bg-[#0A66C2] text-white rounded">
              <Linkedin size={14} fill="currentColor" />
            </span>
            <span className="text-sm font-semibold text-gray-900">LinkedIn</span>
          </div>
          <p className="text-xs text-gray-600">
            LinkedIn's API only accepts OAuth tokens — cookies don't grant API access. Use the
            Reconnect button on the LinkedIn card below for a one-click OAuth refresh that
            re-distributes the new token across every LinkedIn connection.
          </p>
          <a
            href="#linkedin-reconnect"
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById("linkedin-reconnect-anchor");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#0A66C2] rounded-lg hover:bg-[#0852a0]"
          >
            Jump to Reconnect button <ArrowRight size={14} />
          </a>
        </div>
      </div>

      <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 leading-relaxed">
        <strong className="text-gray-700">How the bookmarklet works:</strong> when clicked from
        an x.com tab, it reads your local <span className="font-mono">auth_token</span> + <span className="font-mono">ct0</span> cookies (same ones your browser
        sends to twitter.com), then opens this Settings page with the values in a URL fragment
        (which is never sent to any server). This page then auto-saves them. Cookies stay on
        your machine until they're saved to our DB; we never see your password.
      </div>
    </div>
  );
}

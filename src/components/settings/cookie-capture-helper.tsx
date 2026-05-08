"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Loader2, Linkedin } from "lucide-react";

const BOOKMARKLET = `javascript:(()=>{const c=document.cookie.split(';').reduce((m,p)=>{const[k,...v]=p.trim().split('=');m[k]=v.join('=');return m;},{});const host=location.hostname;let payload=null,kind='';if(host.includes('x.com')||host.includes('twitter.com')){if(c.auth_token&&c.ct0){payload={authToken:c.auth_token,ct0:c.ct0};kind='twitter-cookies';}else{alert('Could not find auth_token + ct0 cookies. Make sure you are signed in to x.com.');return;}}else if(host.includes('linkedin.com')){if(c.li_at&&c.JSESSIONID){payload={li_at:c.li_at,JSESSIONID:c.JSESSIONID};kind='linkedin-cookies';}else{alert('Could not find li_at + JSESSIONID cookies. Make sure you are signed in to linkedin.com.');return;}}else{alert('Run this bookmarklet from x.com or linkedin.com while signed in.');return;}const url='https://social.gershoncrm.com/settings#'+kind+'='+encodeURIComponent(JSON.stringify(payload));window.open(url,'_blank');})();`;

export function CookieCaptureHelper({ onSaved }: { onSaved: () => void }) {
  const [autoSave, setAutoSave] = useState<{ status: "idle" | "saving" | "ok" | "fail"; message: string }>({ status: "idle", message: "" });
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;

    let endpoint: string | null = null;
    let payload: Record<string, string> | null = null;
    let label = "";

    let m = hash.match(/^#twitter-cookies=(.+)$/);
    if (m) {
      endpoint = "/api/settings/twitter";
      label = "X / Twitter";
      try {
        const p = JSON.parse(decodeURIComponent(m[1])) as { authToken?: string; ct0?: string };
        if (p?.authToken && p?.ct0) payload = { authToken: p.authToken, ct0: p.ct0 };
      } catch {}
    }

    if (!payload) {
      m = hash.match(/^#linkedin-cookies=(.+)$/);
      if (m) {
        endpoint = "/api/settings/linkedin";
        label = "LinkedIn";
        try {
          const p = JSON.parse(decodeURIComponent(m[1])) as { li_at?: string; JSESSIONID?: string };
          if (p?.li_at && p?.JSESSIONID) payload = { li_at: p.li_at, JSESSIONID: p.JSESSIONID };
        } catch {}
      }
    }

    if (!endpoint || !payload) return;

    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setAutoSave({ status: "saving", message: `Saving ${label} cookies…` });

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.success) {
          setAutoSave({ status: "ok", message: j.message || `${label} cookies saved across all connections.` });
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
    } catch {}
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">One-click cookie capture</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Drag the same bookmarklet to your bookmarks bar — it works on both
          x.com and linkedin.com. Click it from either tab while signed in,
          and we capture the right cookies and save them automatically.
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

      <div className="px-6 py-4">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col gap-3 max-w-md">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 bg-black text-white rounded text-xs font-bold">𝕏</span>
            <span className="text-gray-400">+</span>
            <span className="inline-flex items-center justify-center w-6 h-6 bg-[#0A66C2] text-white rounded">
              <Linkedin size={14} fill="currentColor" />
            </span>
            <span className="text-sm font-semibold text-gray-900">X / Twitter & LinkedIn</span>
          </div>
          <p className="text-xs text-gray-600">
            Drag this link to your bookmarks bar. Click it from any signed-in
            x.com or linkedin.com tab — we capture the right cookies based on
            the page domain and save them to the matching connections.
          </p>
          <a
            href={BOOKMARKLET}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(e: any) => e.preventDefault()}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 cursor-grab active:cursor-grabbing select-none"
            draggable
            title="Drag this to your bookmarks bar — your browser refuses javascript: links from a click"
          >
            ⤴ Capture cookies (X &amp; LinkedIn)
          </a>
          <button
            onClick={copyBookmarklet}
            className="text-xs text-gray-600 hover:text-gray-900 underline self-start"
          >
            {showCopied ? "Copied!" : "Or copy the JavaScript and paste into a manual bookmark"}
          </button>
        </div>
      </div>

      <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 leading-relaxed">
        <strong className="text-gray-700">How it works:</strong> the bookmarklet
        reads <span className="font-mono">document.cookie</span> on the page
        you're viewing — that's how your browser already authenticates to
        x.com and linkedin.com. It picks out the right cookies (auth_token + ct0
        for X; li_at + JSESSIONID for LinkedIn) and opens this Settings page
        with the values in a URL fragment (which is never sent to any server).
        This page reads the fragment via JavaScript and immediately POSTs over
        HTTPS to save them. Cookies stay on your machine until they're saved
        to our DB; we never see your password.
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2, Eye, EyeOff, Unplug } from "lucide-react";

/**
 * "Your X account" — v4.8.0.
 *
 * A workspace reads X with its OWN access: the user signs in with LinkedIn,
 * then connects their X account here. Their own @handle is collected, and
 * every other X account in their workspace is read with the same session.
 *
 * Two ways to provide the session, neither involves an X password:
 *   1. Automatic — the GershonAI extension, with this workspace's token,
 *      picks it up from the user's logged-in x.com tab.
 *   2. Manual — paste auth_token + ct0 once, below.
 */

type Status = {
  connected: boolean;
  handle: string | null;
  capturedAt: string | null;
  source: string | null;
  ownClientId: string | null;
};

function ago(iso: string | null): string {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  return h < 24 ? h + "h ago" : Math.round(h / 24) + "d ago";
}

export function XAccountCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [handle, setHandle] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [show, setShow] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings/x-account");
      if (r.status === 403 || r.status === 401) { setForbidden(true); return; }
      const j = await r.json();
      if (j?.success) {
        setSt(j.data);
        if (j.data.handle) setHandle("@" + j.data.handle);
      }
    } catch {}
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/settings/x-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, authToken: authToken || null, ct0: ct0 || null }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Couldn't save");
      setAuthToken("");
      setCt0("");
      setMsg({
        kind: "ok",
        text:
          (j.data.sessionSaved ? "X session saved. " : "") +
          (j.data.handle ? `@${j.data.handle} is now collected in your workspace. ` : "") +
          `${j.data.xAccountsInWorkspace} X account(s) will be read with your access.`,
      });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't save" });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMsg(null);
    try {
      await fetch("/api/settings/x-account", { method: "DELETE" });
      setHandle("");
      setMsg({ kind: "ok", text: "X account disconnected from this workspace." });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Your X (Twitter) account</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Your posts are collected, and every X account in this workspace is read with <strong>your</strong> access.
            We never ask for your X password.
          </div>
        </div>
        {st?.connected ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full shrink-0">
            <CheckCircle2 size={12} /> Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full shrink-0">
            <AlertCircle size={12} /> Not connected
          </span>
        )}
      </div>

      {st?.connected && (
        <div className="text-xs text-gray-600 mb-3">
          Session {st.source === "extension" ? "captured by the extension" : "saved"} {ago(st.capturedAt)}
          {st.handle && <> · account <strong>@{st.handle}</strong></>}
        </div>
      )}

      <label className="text-xs font-medium text-gray-700 block mb-1">Your X handle</label>
      <input
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        placeholder="@yourname or https://x.com/yourname"
        className="w-full max-w-md text-sm border border-gray-300 rounded-lg px-3 py-2 mb-3"
      />

      <div className="text-xs text-gray-600 leading-relaxed mb-3">
        <strong>Session — automatic:</strong> install the GershonAI extension, paste this workspace&apos;s token
        (card above), and stay logged in to x.com in Chrome. The session is picked up on its own and kept fresh.{" "}
        <button type="button" onClick={() => setManual((v) => !v)} className="text-red-600 underline">
          {manual ? "Hide manual option" : "Or paste it manually"}
        </button>
      </div>

      {manual && (
        <div className="grid gap-2 max-w-md mb-3">
          <div className="text-[11px] text-gray-500">
            On x.com (logged in): DevTools → Application → Cookies → https://x.com → copy the values of
            <code className="mx-1">auth_token</code> and <code>ct0</code>.
          </div>
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="auth_token"
              className="w-full text-sm font-mono border border-gray-300 rounded-lg px-3 py-2 pr-9"
            />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-2.5 text-gray-400">
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <input
            type={show ? "text" : "password"}
            value={ct0}
            onChange={(e) => setCt0(e.target.value)}
            placeholder="ct0"
            className="w-full text-sm font-mono border border-gray-300 rounded-lg px-3 py-2"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy || (!handle.trim() && !authToken.trim())}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Connect X
        </button>
        {(st?.connected || st?.handle) && (
          <button
            onClick={disconnect}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <Unplug size={14} /> Disconnect
          </button>
        )}
      </div>

      {msg && (
        <div className={`text-xs mt-3 ${msg.kind === "ok" ? "text-green-700" : "text-red-700"}`}>{msg.text}</div>
      )}
    </div>
  );
}

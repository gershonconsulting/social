"use client";

/**
 * /extension — everything about the Social Chrome extension in one place:
 * is it installed in this browser and up to date, download it, the workspace
 * key it needs, and a button that runs a collection for every company now.
 *
 * Talks to the extension through the content-script bridge that already ships
 * (content.js): GERSHONAI_PING → GERSHONAI_PONG {version}, GERSHONAI_HELLO on
 * load, and GERSHONAI_SYNC_CLIENT {clientId} → GERSHONAI_SYNC_RESULT. "Collect
 * everything" is that per-company sync run one company at a time — no new
 * extension build is needed for it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Download, Loader2, Play, Puzzle, XCircle, AlertTriangle } from "lucide-react";

type Detect = { state: "checking" } | { state: "missing" } | { state: "found"; version: string };
type Company = { id: string; name: string; clientType: string; platforms: string[] };
type RowState = "waiting" | "running" | "ok" | "failed";

function versionLt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}

export function ExtensionPageClient({ latest }: { latest: string }) {
  const [detect, setDetect] = useState<Detect>({ state: "checking" });
  const [token, setToken] = useState<string | null>(null);
  const [tokenNote, setTokenNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [rows, setRows] = useState<Record<string, { state: RowState; note?: string }>>({});
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  // ── Is the extension in this browser? ─────────────────────────────────────
  const check = useCallback(() => {
    setDetect({ state: "checking" });
    const pingId = `ping-${Date.now()}`;
    let found = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data as { type?: string; version?: string; requestId?: string };
      if (!d || typeof d !== "object") return;
      if (d.type === "GERSHONAI_HELLO" || (d.type === "GERSHONAI_PONG" && d.requestId === pingId)) {
        found = true;
        setDetect({ state: "found", version: String(d.version || "?") });
        window.removeEventListener("message", onMsg);
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ type: "GERSHONAI_PING", requestId: pingId }, location.origin);
    setTimeout(() => {
      if (!found) {
        window.removeEventListener("message", onMsg);
        setDetect({ state: "missing" });
      }
    }, 1500);
  }, []);

  useEffect(() => { check(); }, [check]);

  // ── Workspace key + company list ─────────────────────────────────────────
  useEffect(() => {
    fetch("/api/settings/extension-token")
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setToken(j.data.token);
        else setTokenNote(j?.error || "Only a workspace admin can see the key.");
      })
      .catch(() => setTokenNote("Could not load the key."));

    fetch("/api/clients?status=ACTIVE&light=1")
      .then((r) => r.json())
      .then((j) => {
        const list = (j?.data ?? []) as Array<{
          id: string; name: string; clientType: string;
          platformConnections?: Array<{ platform: string; externalAccountUrl: string | null }>;
        }>;
        setCompanies(
          list
            .map((c) => ({
              id: c.id,
              name: c.name,
              clientType: c.clientType,
              platforms: (c.platformConnections ?? [])
                .filter((p) => (p.platform === "LINKEDIN" || p.platform === "TWITTER") && p.externalAccountUrl)
                .map((p) => (p.platform === "LINKEDIN" ? "LinkedIn" : "X")),
            }))
            .filter((c) => c.platforms.length > 0)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => setCompanies([]));
  }, []);

  // ── Collect every company, one at a time ─────────────────────────────────
  const syncOne = (clientId: string): Promise<{ ok: boolean; error?: string }> =>
    new Promise((resolve) => {
      const requestId = `sync-${clientId}-${Date.now()}`;
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMsg);
        resolve({ ok: false, error: "No answer from the extension after 2 minutes" });
      }, 120_000);
      function onMsg(e: MessageEvent) {
        if (e.source !== window || e.origin !== location.origin) return;
        const d = e.data as { type?: string; requestId?: string; ok?: boolean; error?: string };
        if (d?.type !== "GERSHONAI_SYNC_RESULT" || d.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        resolve({ ok: !!d.ok, error: d.error });
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ type: "GERSHONAI_SYNC_CLIENT", clientId, requestId }, location.origin);
    });

  const runAll = async () => {
    if (!companies?.length) return;
    stopRef.current = false;
    setRunning(true);
    setRows(Object.fromEntries(companies.map((c) => [c.id, { state: "waiting" as RowState }])));
    for (const c of companies) {
      if (stopRef.current) break;
      setRows((r) => ({ ...r, [c.id]: { state: "running" } }));
      const res = await syncOne(c.id);
      setRows((r) => ({ ...r, [c.id]: { state: res.ok ? "ok" : "failed", note: res.error } }));
    }
    setRunning(false);
  };

  const outOfDate = detect.state === "found" && versionLt(detect.version, latest);
  const done = Object.values(rows).filter((r) => r.state === "ok" || r.state === "failed").length;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Puzzle size={22} /> Chrome extension
        </h1>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          The extension collects LinkedIn and X posts from inside your own logged-in Chrome. This page
          checks it, hands you the latest build and your workspace key, and runs a collection now.
        </p>
      </div>

      <Card title="Status in this browser">
        {detect.state === "checking" && (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Checking…</div>
        )}
        {detect.state === "missing" && (
          <div className="rounded-lg bg-red-50 border border-red-300 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
              <XCircle size={18} className="text-[#FE1B04]" />
              Not installed in this browser — no LinkedIn or X posts are collected from here.
            </div>
            <a href="/social-extension.zip" download
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#FE1B04] text-white text-sm font-semibold px-4 py-2">
              <Download size={16} /> Download v{latest}
            </a>
            <span className="ml-3 text-xs text-red-800">then follow the steps below.</span>
          </div>
        )}
        {detect.state === "found" && !outOfDate && (
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <CheckCircle2 size={18} className="text-green-600" />
            Installed and up to date — <strong>v{detect.version}</strong>.
          </div>
        )}
        {outOfDate && detect.state === "found" && (
          <div className="flex items-center gap-2 text-sm font-semibold text-[#FE1B04]">
            <AlertTriangle size={18} /> Out of date: v{detect.version} installed, v{latest} available. Update below.
          </div>
        )}
        <button onClick={check} className="mt-3 text-xs font-semibold text-gray-600 underline">Check again</button>
      </Card>

      <Card title={`Download v${latest}`}>
        <a href="/social-extension.zip" download
          className="inline-flex items-center gap-2 rounded-lg bg-[#FE1B04] text-white text-sm font-semibold px-4 py-2">
          <Download size={16} /> Download the extension
        </a>
        <ol className="mt-4 text-sm text-gray-600 list-decimal pl-5 space-y-1">
          <li>Unzip the file into a folder you keep.</li>
          <li>Open <code>chrome://extensions</code> and switch on Developer mode.</li>
          <li>New install: <strong>Load unpacked</strong> and pick the folder. Update: replace the folder&apos;s files, then press the reload arrow on the Social card.</li>
          <li>Open social.gershoncrm.com in that Chrome while signed in. The extension connects itself to your workspace — the popup then shows <strong>Collecting for: &lt;your workspace&gt;</strong>.</li>
        </ol>
      </Card>

      <Card title="Workspace key">
        {token ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs bg-gray-50 border border-gray-200 rounded px-3 py-2">{token}</code>
            <button
              onClick={() => { void navigator.clipboard.writeText(token); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="inline-flex items-center gap-1 text-xs font-semibold border border-gray-300 rounded px-3 py-2">
              <Copy size={14} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">{tokenNote ?? "Loading…"}</p>
        )}
        <p className="text-xs text-gray-500 mt-2">This key tells the extension which workspace its posts belong to.</p>
      </Card>

      <Card title="Collect now">
        {companies === null ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading companies…</div>
        ) : companies.length === 0 ? (
          <p className="text-sm text-gray-500">No active company has a LinkedIn or X link yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <button
                onClick={running ? () => { stopRef.current = true; } : runAll}
                disabled={detect.state !== "found"}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 text-white text-sm font-semibold px-4 py-2 disabled:opacity-40">
                {running ? <><Loader2 size={16} className="animate-spin" /> Stop after this company</> : <><Play size={16} /> Collect all {companies.length} companies</>}
              </button>
              {Object.keys(rows).length > 0 && (
                <span className="text-xs text-gray-500 tabular-nums">{done} of {companies.length} done</span>
              )}
            </div>
            {detect.state !== "found" && (
              <p className="text-xs text-gray-500 mt-2">Needs the extension installed in this browser.</p>
            )}
            <ul className="mt-4 divide-y divide-gray-100">
              {companies.map((c) => {
                const r = rows[c.id];
                return (
                  <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-5">
                      {r?.state === "running" && <Loader2 size={15} className="animate-spin text-gray-500" />}
                      {r?.state === "ok" && <CheckCircle2 size={15} className="text-green-600" />}
                      {r?.state === "failed" && <XCircle size={15} className="text-[#FE1B04]" />}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-gray-900">{c.name}</span>
                    <span className="text-xs text-gray-400">{c.platforms.join(" · ")}</span>
                    {r?.state === "failed" && r.note && <span className="text-xs text-[#FE1B04] truncate max-w-[40%]">{r.note}</span>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

"use client";

/**
 * Connect a client's own Chrome to publish their approved posts (v4.42.0).
 * Three states: extension missing → install steps; installed but older than
 * 0.17.0 → update; installed → connected automatically by the extension.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, XCircle } from "lucide-react";

type Data = {
  client: string; logoUrl: string | null; linkedinUrl: string | null; xHandle: string | null; latest: string;
  live: { overall: { level: string; label: string }; linkedin: { level: string; label: string }; x: { level: string; label: string } };
  lastSeenAt: string | null;
};

function older(a: string, b: string) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
  return false;
}

export function ConnectClient({ keyId }: { keyId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ext, setExt] = useState<{ state: "checking" | "missing" | "found"; version?: string }>({ state: "checking" });
  const [bound, setBound] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/connect/${keyId}`, { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setData(j.data); else setErr(j?.error || "This link is not valid.");
    } catch { setErr("Could not load."); }
  }, [keyId]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 20000);
    function onMsg(e: MessageEvent) {
      if (e.source !== window || !e.data) return;
      if (e.data.type === "GERSHONAI_PONG" || e.data.type === "GERSHONAI_HELLO") setExt({ state: "found", version: e.data.version });
      if (e.data.type === "GERSHONAI_BOUND" && e.data.publishing) setBound(true);
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ type: "GERSHONAI_PING" }, location.origin);
    const miss = setTimeout(() => setExt((s) => (s.state === "checking" ? { state: "missing" } : s)), 2500);
    return () => { clearInterval(t); clearTimeout(miss); window.removeEventListener("message", onMsg); };
  }, [load]);

  if (err) return <Center><p className="text-gray-700">{err}</p></Center>;
  if (!data) return <Center><Loader2 className="animate-spin text-gray-400" /></Center>;

  const tooOld = ext.state === "found" && ext.version && older(ext.version, "0.17.0");
  const live = data.live.overall.level === "live";

  return (
    <div className="min-h-screen bg-[#f5f6f8]">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center gap-3">
          {data.logoUrl && <img src={data.logoUrl} alt="" className="w-10 h-10 rounded-md object-contain bg-white border border-gray-100" />}
          <div>
            <div className="text-xs text-gray-500">Social by Gershon.AI · publishing</div>
            <h1 className="text-xl font-semibold text-gray-900">Publish {data.client}&apos;s posts from this browser</h1>
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className={`rounded-xl p-4 text-white font-semibold ${live ? "bg-emerald-600" : bound || ext.state === "found" ? "bg-orange-500" : "bg-red-600"}`}>
          {live
            ? `✓ Connected — ${data.client}'s approved posts will be published from this Chrome.`
            : bound || (ext.state === "found" && !tooOld)
              ? "Extension installed and connected — waiting for it to check in (within 5 minutes)."
              : "Not connected yet — follow the steps below."}
        </div>

        <section className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-700 space-y-3">
          <h2 className="font-semibold text-gray-900">1. Install the extension</h2>
          {ext.state === "checking" && <div className="flex items-center gap-2 text-gray-500"><Loader2 size={14} className="animate-spin" /> Checking this browser…</div>}
          {ext.state === "found" && !tooOld && <div className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-600" /> Installed (v{ext.version}).</div>}
          {(ext.state === "missing" || tooOld) && (
            <>
              <div className="flex items-center gap-2 text-red-700"><XCircle size={16} /> {tooOld ? `Version ${ext.version} is too old — update to ${data.latest}.` : "Not installed in this browser."}</div>
              <a href="/social-extension.zip" download className="inline-flex items-center gap-2 rounded-lg bg-[#FE1B04] text-white font-semibold px-4 py-2">
                <Download size={16} /> Download v{data.latest}
              </a>
              <ol className="list-decimal pl-5 space-y-1 text-gray-600">
                <li>Unzip the file into a folder you keep.</li>
                <li>Open <code>chrome://extensions</code> and switch on Developer mode.</li>
                <li>Click <b>Load unpacked</b> and pick the folder (to update: replace the files and press the reload arrow).</li>
                <li>Come back to this page and refresh it. It connects itself.</li>
              </ol>
            </>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-700 space-y-2">
          <h2 className="font-semibold text-gray-900">2. Stay signed in, in this Chrome</h2>
          <div>LinkedIn{data.linkedinUrl ? <> — as an admin of <a className="underline" href={data.linkedinUrl} target="_blank" rel="noreferrer">{data.linkedinUrl.replace("https://www.", "")}</a></> : ""}: <b>{data.live.linkedin.label.replace(/^LinkedIn: /, "")}</b></div>
          <div>X{data.xHandle ? <> — as <b>@{data.xHandle}</b></> : ""}: <b>{data.live.x.label.replace(/^X: /, "")}</b></div>
          <p className="text-gray-500 text-xs">Posts go out at their scheduled time while this Chrome is open. If it is closed, they are flagged and Gershon Consulting is told.</p>
        </section>

        <p className="text-[11px] text-gray-400 text-center">
          This extension only receives {data.client}&apos;s posts after you approved them, when they are due. It does not read or send anything else.
        </p>
      </main>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center bg-[#f5f6f8] px-4 text-center">{children}</div>;
}

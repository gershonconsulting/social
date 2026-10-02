"use client";

/**
 * Red strip on EVERY dashboard page when the GershonAI Chrome extension is
 * not installed in this browser, or is out of date — with the download right
 * in it. Olivier, 2026-10-02: "Why no message when the extension is not
 * installed!"
 *
 * Detection is the content-script bridge: GERSHONAI_HELLO on load, PONG to a
 * PING. Silent on a computer set to "viewing only" (Settings → This
 * computer), which by design doesn't run the extension.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertOctagon, Download } from "lucide-react";
import { useCollectingMode } from "@/lib/collecting-mode";

type State = { kind: "checking" } | { kind: "missing" } | { kind: "found"; version: string };

export function versionLt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

export function ExtensionInstallBanner({ latest }: { latest: string }) {
  const [collecting] = useCollectingMode();
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    const pingId = `banner-${Date.now()}`;
    let found = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data as { type?: string; version?: string; requestId?: string };
      if (!d || typeof d !== "object") return;
      if (d.type === "GERSHONAI_HELLO" || (d.type === "GERSHONAI_PONG" && d.requestId === pingId)) {
        found = true;
        setState({ kind: "found", version: String(d.version || "0") });
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ type: "GERSHONAI_PING", requestId: pingId }, location.origin);
    const t = setTimeout(() => { if (!found) setState({ kind: "missing" }); }, 2000);
    return () => { clearTimeout(t); window.removeEventListener("message", onMsg); };
  }, []);

  if (!collecting || state.kind === "checking") return null;
  if (state.kind === "found" && !versionLt(state.version, latest)) return null;

  const missing = state.kind === "missing";
  return (
    <div className="bg-[#FE1B04] text-white rounded-xl px-4 py-3 mb-5 flex items-center gap-3">
      <AlertOctagon size={18} className="shrink-0" />
      <div className="flex-1 text-sm">
        <strong>
          {missing
            ? "The GershonAI Chrome extension is not installed in this browser."
            : `Your Chrome extension is out of date (v${(state as { version: string }).version}, latest v${latest}).`}
        </strong>{" "}
        Without it, no new LinkedIn or X posts are collected.{" "}
        <Link href="/extension" className="underline font-semibold">How to install</Link>
      </div>
      <a href="/gershonai-extension.zip" download
        className="shrink-0 inline-flex items-center gap-2 bg-white text-[#FE1B04] text-sm font-semibold rounded-lg px-3 py-1.5">
        <Download size={15} /> Download v{latest}
      </a>
    </div>
  );
}

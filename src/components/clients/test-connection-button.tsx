"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";

type TestState = "idle" | "running" | "ok" | "fail";

export function TestConnectionButton({
  connectionId,
  size = "small",
}: {
  connectionId: string;
  size?: "small" | "medium";
}) {
  const [state, setState] = useState<TestState>("idle");
  const [message, setMessage] = useState<string>("");
  const [newStatus, setNewStatus] = useState<string | null>(null);

  async function runTest() {
    setState("running");
    setMessage("");
    setNewStatus(null);
    try {
      const r = await fetch(`/api/platforms/${connectionId}/test`, { method: "POST" });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setState("fail");
        setMessage(`Server returned non-JSON (HTTP ${r.status}) — try again in a moment.`);
        return;
      }
      const j = await r.json();
      const status = j?.data?.status as string | undefined;
      const err = j?.data?.error as string | undefined;
      if (j.success) {
        setState("ok");
        setNewStatus(status ?? "CONNECTED");
        setMessage(
          `Connected${j.data?.followerCount != null ? ` · ${j.data.followerCount.toLocaleString()} followers` : ""}`
        );
      } else {
        setState("fail");
        setNewStatus(status ?? "ERROR");
        setMessage(err || j.error || "Connection test failed.");
      }
    } catch (e) {
      setState("fail");
      setMessage(e instanceof Error ? e.message : "Network error");
    }
  }

  const Icon =
    state === "running" ? Loader2 :
    state === "ok" ? CheckCircle2 :
    state === "fail" ? AlertTriangle :
    RefreshCw;

  const colorClass =
    state === "ok" ? "text-green-700 hover:text-green-800" :
    state === "fail" ? "text-amber-700 hover:text-amber-800" :
    "text-gray-500 hover:text-gray-700";

  const sizeClass = size === "medium" ? "text-sm" : "text-xs";

  return (
    <div className={`inline-flex flex-col items-end gap-0.5 ${sizeClass}`}>
      <button
        onClick={runTest}
        disabled={state === "running"}
        className={`inline-flex items-center gap-1 ${colorClass} disabled:opacity-50`}
        title="Probe the platform with the stored token to verify it still works"
      >
        <Icon size={11} className={state === "running" ? "animate-spin" : ""} />
        {state === "running" ? "Testing…" : state === "ok" ? "Tested OK" : state === "fail" ? "Test failed" : "Test"}
      </button>
      {message && (
        <span className={`text-[10px] max-w-[240px] truncate ${state === "ok" ? "text-green-600" : "text-amber-700"}`} title={message}>
          {newStatus && newStatus !== "CONNECTED" ? `${newStatus} · ` : ""}{message}
        </span>
      )}
    </div>
  );
}

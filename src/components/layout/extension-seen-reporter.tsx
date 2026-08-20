"use client";

import { useEffect } from "react";

/**
 * ExtensionSeenReporter — invisible. Learns which version of the GershonAI
 * Chrome extension is actually installed and tells the server.
 *
 * The extension's content script already announces itself on every
 * social.gershoncrm.com page: it posts GERSHONAI_HELLO on load and answers a
 * GERSHONAI_PING with GERSHONAI_PONG. Both carry
 * chrome.runtime.getManifest().version. We listen for either (HELLO can fire
 * before React mounts, so we ping too) and forward the version to
 * /api/extension/seen.
 *
 * That heartbeat is what lets the daily progress report say "you are still
 * running 0.10.7, latest is 0.11.0 — upgrade" in an email, instead of only
 * inside a browser that has the extension loaded.
 *
 * Reported at most once per version per day per browser, so normal navigation
 * doesn't hammer the settings row.
 */
const THROTTLE_KEY = "gershonai:seen-reported";

function alreadyReported(version: string): boolean {
  try {
    const today = new Date().toISOString().slice(0, 10);
    return window.localStorage.getItem(THROTTLE_KEY) === `${version}|${today}`;
  } catch {
    return false;
  }
}

function markReported(version: string): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    window.localStorage.setItem(THROTTLE_KEY, `${version}|${today}`);
  } catch {
    /* private mode / storage disabled — just report again next page */
  }
}

export function ExtensionSeenReporter() {
  useEffect(() => {
    let done = false;

    const report = (version: unknown) => {
      if (done) return;
      if (typeof version !== "string" || !/^\d+(\.\d+){0,3}$/.test(version)) return;
      done = true;
      if (alreadyReported(version)) return;
      void fetch("/api/extension/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
        keepalive: true,
      })
        .then(() => markReported(version))
        .catch(() => {
          /* heartbeat is best-effort — never surface an error to the user */
        });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; version?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "GERSHONAI_HELLO" || data.type === "GERSHONAI_PONG") {
        report(data.version);
      }
    };

    window.addEventListener("message", onMessage);
    // HELLO may already have fired before this mounted — ask directly.
    window.postMessage(
      { type: "GERSHONAI_PING", requestId: `seen-${Date.now()}` },
      window.location.origin,
    );

    return () => window.removeEventListener("message", onMessage);
  }, []);

  return null;
}

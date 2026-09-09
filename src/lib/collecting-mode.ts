"use client";

import { useEffect, useState } from "react";

/**
 * "Collecting session" mode — per COMPUTER, not per account.
 *
 * One GershonAI account is opened from several machines: the computer that
 * actually runs the Chrome extension and captures the LinkedIn / X sessions,
 * plus viewers (a second laptop, the client) that only read the results.
 * A viewer has no reason to install the extension, so telling it to "open
 * GershonAI and click Sync Now" is noise — and advice it cannot act on.
 *
 * The choice therefore cannot live on the ACCOUNT: it would follow the login
 * to every machine, and one viewer switching off would silence the computer
 * that actually collects. localStorage is per browser profile == per computer,
 * which is exactly the grain we want.
 *
 *   "on"  (default) — this computer collects; the extension is required here
 *                     and its absence is reported.
 *   "off"           — viewing only; no extension needed on this computer.
 *
 * OFF never claims an extension IS installed, and it never hides a real
 * account-level problem: a stale capture still shows, it is simply worded to
 * point at the collecting computer instead of at this browser.
 */
export const COLLECT_KEY = "social_collecting";

export function readCollecting(): boolean {
  try {
    return window.localStorage.getItem(COLLECT_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeCollecting(on: boolean): void {
  try {
    window.localStorage.setItem(COLLECT_KEY, on ? "on" : "off");
  } catch {
    /* private mode — the setting just doesn't stick, default (on) applies */
  }
  try {
    window.dispatchEvent(new CustomEvent("social-collecting-changed", { detail: { on } }));
  } catch {
    /* older browsers — every consumer re-reads on mount anyway */
  }
}

/**
 * Returns [collecting, setCollecting].
 *
 * `collecting` starts as `true` on the very first render so the server-rendered
 * markup and the first client render agree (localStorage is not readable during
 * SSR). The real value lands in the effect right after mount, so a viewer sees
 * at most one frame of the collecting-mode wording.
 */
export function useCollectingMode(): [boolean, (on: boolean) => void] {
  const [collecting, setCollecting] = useState(true);

  useEffect(() => {
    setCollecting(readCollecting());
    const onChange = () => setCollecting(readCollecting());
    window.addEventListener("social-collecting-changed", onChange);
    // Another tab on this same computer changed it.
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("social-collecting-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return [
    collecting,
    (on: boolean) => {
      writeCollecting(on);
      setCollecting(on);
    },
  ];
}

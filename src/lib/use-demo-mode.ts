"use client";
import { useEffect, useState } from "react";

const KEY = "gershonai-demo-mode";

export function useDemoMode(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1");
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) read(); };
    window.addEventListener("storage", onStorage);
    // Custom event we dispatch when toggling in the same tab
    window.addEventListener("gershonai-demo-toggle", read as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("gershonai-demo-toggle", read as EventListener);
    };
  }, []);
  return on;
}

export function setDemoMode(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(KEY, "1");
  else window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("gershonai-demo-toggle"));
}

// Deterministic pseudo-random based on a string seed (so the fake data is
// stable across reloads — sales demos shouldn't have different numbers each
// time you refresh the page).
export function seededRand(seed: string): () => number {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0x100000000);
  };
}

export function pickInt(rng: () => number, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

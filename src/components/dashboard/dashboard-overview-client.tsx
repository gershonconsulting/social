"use client";

/**
 * Dashboard — v4.10.0, "manager view".
 *
 * Olivier, 2026-09-24: "Too many things. Not clear enough for a manager to
 * decide what is right and what is not." So this page answers exactly one
 * question — is everything OK, and if not, who needs action and why — and
 * nothing else. Trends, movers and engagement rankings live on Analytics.
 *
 * Every company gets ONE verdict, computed from the same data as before:
 *   ✔ On track      posted in the last 14 days and its networks were collected
 *   ! Slowing       last post 15–30 days ago
 *   ✖ Silent        no post in 30+ days (or never)
 *   ! Not collected a network failed or went stale on the last run
 * Anything that is not "On track" goes in the action list with a one-line
 * reason written for a person, not an engineer.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import type { OverviewData, OverviewRow } from "./dashboard-overview";
import { matchesCategory, matchesNetwork, useViewFilters } from "@/lib/view-filters";

type Verdict = "ok" | "slowing" | "silent" | "collection";

const NETWORK: Record<string, string> = { LINKEDIN: "LinkedIn", TWITTER: "X" };

const VERDICT: Record<Verdict, { label: string; pill: string; rank: number }> = {
  silent: { label: "Silent", pill: "bg-red-50 text-red-700", rank: 0 },
  collection: { label: "Not collected", pill: "bg-amber-50 text-amber-800", rank: 1 },
  slowing: { label: "Slowing", pill: "bg-amber-50 text-amber-800", rank: 2 },
  ok: { label: "On track", pill: "bg-green-50 text-green-800", rank: 3 },
};

function category(t: string): string {
  return t ? t.charAt(0) + t.slice(1).toLowerCase() : "—";
}

function lastPostLabel(d: number): string {
  if (d >= 999999) return "Never";
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  return `${d} days ago`;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

type Judged = OverviewRow & { verdict: Verdict; reason: string };

export function DashboardOverviewClient({ data }: { data: OverviewData }) {
  const { categories, networks } = useViewFilters();
  const [showOk, setShowOk] = useState(false);

  const { judged, collected, total, collectionOk, hoursOld } = useMemo(() => {
    const rows = data.rows.filter(
      (r) => matchesCategory(r.clientType, categories) && matchesNetwork(r.platforms, networks),
    );
    const ids = new Set(rows.map((r) => r.id));
    // Only the networks we actually collect. Google Business is being retired
    // ("nothing there to collect") and must never flag a company.
    const conns = data.conns.filter(
      (c) =>
        ids.has(c.clientId) &&
        c.platform in NETWORK &&
        (networks.length === 0 || networks.includes(c.platform)),
    );

    // Networks that did not come back on the last run, per company.
    const broken = new Map<string, string[]>();
    for (const c of conns) {
      if (c.state === "failed" || c.state === "stale") {
        const arr = broken.get(c.clientId) ?? [];
        arr.push(NETWORK[c.platform] ?? c.platform);
        broken.set(c.clientId, arr);
      }
    }

    const judged: Judged[] = rows.map((r) => {
      if (r.daysSince > 30) {
        return {
          ...r,
          verdict: "silent",
          reason: r.daysSince >= 999999 ? "Has never posted." : `No post in ${r.daysSince} days.`,
        };
      }
      const b = broken.get(r.id);
      if (b && b.length) {
        return { ...r, verdict: "collection", reason: `We could not read ${b.join(" and ")} on the last run.` };
      }
      if (r.daysSince > 14) {
        return { ...r, verdict: "slowing", reason: `Last post was ${r.daysSince} days ago.` };
      }
      return { ...r, verdict: "ok", reason: `${r.postsThisMonth} post${r.postsThisMonth === 1 ? "" : "s"} this month.` };
    });
    judged.sort((a, b) => VERDICT[a.verdict].rank - VERDICT[b.verdict].rank || b.daysSince - a.daysSince);

    const collected = conns.filter((c) => c.state === "collected" || c.state === "empty").length;
    const hoursOld = data.lastUpdate ? (Date.now() - new Date(data.lastUpdate).getTime()) / 3_600_000 : Infinity;
    const collectionOk = conns.length > 0 && collected / conns.length >= 0.9 && hoursOld < 30;

    return { judged, collected, total: conns.length, collectionOk, hoursOld };
  }, [data, categories, networks]);

  const needs = judged.filter((j) => j.verdict !== "ok");
  const ok = judged.filter((j) => j.verdict === "ok");
  const allGood = needs.length === 0 && collectionOk;
  const scope =
    categories.length === 0 ? "all categories" : categories.map(category).join(", ");

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <div className="text-[13px] font-medium text-gray-500 mb-1">Overview</div>
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-600 mt-1">
          {judged.length} companies · {scope} · data updated {relTime(data.lastUpdate)}
        </p>
      </div>

      {/* 1. The verdict */}
      <div
        className={
          "rounded-xl border px-6 py-5 flex items-center gap-4 " +
          (allGood ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200")
        }
      >
        {allGood ? (
          <CheckCircle2 className="text-green-700 flex-shrink-0" size={32} />
        ) : (
          <XCircle className="text-red-700 flex-shrink-0" size={32} />
        )}
        <div>
          <div className={"text-xl font-semibold " + (allGood ? "text-green-900" : "text-red-900")}>
            {allGood
              ? "Everything is on track."
              : needs.length === 0
                ? "Companies are on track, but data collection needs attention."
                : `${needs.length} of ${judged.length} companies need action.`}
          </div>
          <div className={"text-sm mt-0.5 " + (allGood ? "text-green-800" : "text-red-800")}>
            {allGood
              ? "Every company posted in the last 14 days and all data was collected."
              : "The list below says who, and why, in one line each."}
          </div>
        </div>
      </div>

      {/* 2. Three yes/no answers */}
      <div className="grid gap-4 md:grid-cols-3">
        <Answer
          question="Is data collection working?"
          good={collectionOk}
          answer={collectionOk ? "Yes" : "No"}
          detail={
            total === 0
              ? "No networks connected yet."
              : `${collected} of ${total} networks read on the last run, ${relTime(data.lastUpdate)}.`
          }
          hint={!collectionOk && hoursOld >= 30 ? "The last run is more than a day old." : undefined}
        />
        <Answer
          question="Are companies posting?"
          good={judged.filter((j) => j.daysSince <= 14).length === judged.length}
          answer={`${judged.filter((j) => j.daysSince <= 14).length} of ${judged.length}`}
          detail="posted in the last 14 days."
        />
        <Answer
          question="Anyone gone silent?"
          good={judged.filter((j) => j.verdict === "silent").length === 0}
          answer={String(judged.filter((j) => j.verdict === "silent").length)}
          detail="companies with no post in 30+ days."
        />
      </div>

      {/* 3. Who needs action */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Needs action</h2>
          <span className="text-sm text-gray-500">{needs.length === 0 ? "Nothing to do" : `${needs.length} companies`}</span>
        </div>
        {needs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-600">
            <CheckCircle2 className="mx-auto mb-2 text-green-700" size={22} />
            No company needs action.
          </div>
        ) : (
          <CompanyTable rows={needs} />
        )}
      </section>

      {/* 4. Everyone else, folded away */}
      {ok.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowOk((v) => !v)}
            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50"
          >
            <span className="flex items-center gap-2 text-base font-semibold text-gray-900">
              {showOk ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              On track
            </span>
            <span className="text-sm text-gray-500">{ok.length} companies</span>
          </button>
          {showOk && <CompanyTable rows={ok} />}
        </section>
      )}

      <div className="flex justify-end">
        <Link href="/analytics" className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-800">
          Trends and engagement are on Analytics <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function Answer({
  question,
  good,
  answer,
  detail,
  hint,
}: {
  question: string;
  good: boolean;
  answer: string;
  detail: string;
  hint?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-sm font-medium text-gray-600">{question}</div>
      <div className="flex items-center gap-2 mt-2">
        {good ? (
          <CheckCircle2 className="text-green-700" size={22} />
        ) : (
          <AlertTriangle className="text-red-700" size={22} />
        )}
        <span className={"text-2xl font-semibold tabular-nums " + (good ? "text-gray-900" : "text-red-700")}>{answer}</span>
      </div>
      <div className="text-sm text-gray-600 mt-1">{detail}</div>
      {hint && <div className="text-sm text-red-700 mt-1">{hint}</div>}
    </div>
  );
}

function CompanyTable({ rows }: { rows: Judged[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 bg-gray-50">
          <th className="px-5 py-2.5 font-medium">Company</th>
          <th className="px-3 py-2.5 font-medium">Status</th>
          <th className="px-3 py-2.5 font-medium">Why</th>
          <th className="px-3 py-2.5 font-medium">Last post</th>
          <th className="px-5 py-2.5 font-medium text-right">Posts this month</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
            <td className="px-5 py-3">
              <Link href={`/clients/${r.id}`} className="font-medium text-gray-900 hover:underline">
                {r.name}
              </Link>
              <div className="text-xs text-gray-500">{category(r.clientType)}</div>
            </td>
            <td className="px-3 py-3">
              <span className={"inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full " + VERDICT[r.verdict].pill}>
                {VERDICT[r.verdict].label}
              </span>
            </td>
            <td className="px-3 py-3 text-gray-700">{r.reason}</td>
            <td className="px-3 py-3 text-gray-700">{lastPostLabel(r.daysSince)}</td>
            <td className="px-5 py-3 text-right font-mono">{r.postsThisMonth}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

"use client";

/**
 * Social Summary — v4.65.0. One row per tracked company across the whole
 * ecosystem (every category, narrowed by the sidebar filter). Compliance and
 * objective columns moved to Social Tracking. Followers are per company and
 * per network, never summed.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import type { EcoData, CollectionState } from "@/lib/ecosystem/data";
import { WINDOW_LABELS } from "@/lib/ecosystem/windows";
import {
  STATE_META, CatChip, Delta, NetBadge, WindowPicker,
  ago, fmtDay, fmtNum, scopeText, useEcoWindow, useFiltered, windowRangeText, catLabel,
} from "./eco-shared";

type SortKey = "name" | "type" | "posts" | "change" | "last" | "avg" | "followers" | "fresh";
const SEVERITY: Record<CollectionState, number> = { failed: 0, never: 1, stale: 2, empty: 3, collected: 4 };

export function EcosystemSummaryClient({ data }: { data: EcoData }) {
  const [win, setWin] = useEcoWindow();
  const f = useFiltered(data, win);
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: "posts", desc: true });

  const rows = useMemo(() => {
    const out = f.visible.map(({ c, i }) => {
      const s = f.stats.get(i)!;
      const mine = f.conns.filter((x) => x[0] === i);
      const worst = mine.length ? mine.reduce((a, b) => (SEVERITY[b[2]] < SEVERITY[a[2]] ? b : a)) : null;
      // Age shown next to the state is that of the worst connection.
      const lastSync = worst ? worst[3] : null;
      const followers = c.followers.filter((fo) => f.networks.length === 0 || f.networks.includes(fo.platform));
      return {
        c,
        s,
        change: s.prev && s.prev > 0 ? (s.posts - s.prev) / s.prev : s.posts > 0 && s.prev === 0 ? Infinity : -Infinity,
        avg: s.posts > 0 && s.eng > 0 ? s.eng / s.posts : null,
        followers,
        maxFollowers: followers.reduce((m, fo) => Math.max(m, fo.now), -1),
        worst: worst ? worst[2] : null,
        lastSync,
      };
    });
    const dir = sort.desc ? -1 : 1;
    const val = (r: (typeof out)[number]): number | string => {
      switch (sort.k) {
        case "name": return r.c.name.toLowerCase();
        case "type": return catLabel(r.c.type);
        case "posts": return r.s.posts;
        case "change": return r.change;
        case "last": return r.c.lastPost ?? "";
        case "avg": return r.avg ?? -1;
        case "followers": return r.maxFollowers;
        case "fresh": return r.worst ? SEVERITY[r.worst] : -1;
      }
    };
    return out.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.c.name.localeCompare(b.c.name);
    });
  }, [f, sort]);

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={"font-medium py-2 px-2 whitespace-nowrap " + (right ? "text-right" : "text-left")}>
      <button
        onClick={() => setSort((p) => ({ k, desc: p.k === k ? !p.desc : k !== "name" && k !== "type" }))}
        className={"hover:text-gray-900 " + (sort.k === k ? "text-gray-900" : "")}
      >
        {children}{sort.k === k ? (sort.desc ? " ▼" : " ▲") : ""}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold text-gray-900 leading-tight">Summary</h1>
          <p className="text-[13px] text-gray-600 mt-1">
            Social&apos;s ecosystem summary — every company you track, one row each: how much they post, how it lands, and how fresh our data is.
          </p>
          <p className="text-[11px] text-gray-500 mt-1">
            {scopeText(f.categories, f.networks)} · {WINDOW_LABELS[win]}: {windowRangeText(f.w)} · {rows.length} companies · last refresh {ago(data.lastUpdate)}
          </p>
        </div>
        <WindowPicker value={win} onChange={setWin} />
      </header>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
            <tr>
              <Th k="name">Company</Th>
              <Th k="type">Category</Th>
              <th className="font-medium py-2 px-2 text-left">Networks</th>
              <Th k="posts" right>Posts</Th>
              <Th k="change" right>vs previous</Th>
              <Th k="last">Last post</Th>
              <Th k="avg" right>Avg interactions / post</Th>
              <Th k="followers" right>Followers (30d change)</Th>
              <Th k="fresh">Collection</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-gray-500">No tracked companies match the current filter.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.c.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-2">
                  <Link href={`/clients/${r.c.id}`} className="font-semibold text-gray-900 hover:underline">{r.c.name}</Link>
                </td>
                <td className="py-2 px-2"><CatChip type={r.c.type} /></td>
                <td className="py-2 px-2">
                  {r.c.networks.length === 0 ? (
                    <span className="text-amber-700">none</span>
                  ) : (
                    <span className="inline-flex gap-1">{r.c.networks.map((n) => <NetBadge key={n} n={n === "LINKEDIN" ? 0 : 1} />)}</span>
                  )}
                </td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold text-gray-900">
                  {r.c.networks.length === 0 && r.s.posts === 0 ? <span className="text-gray-400 font-normal">n/a</span> : r.s.posts}
                </td>
                <td className="py-2 px-2 text-right"><Delta cur={r.s.posts} prev={r.s.prev} /></td>
                <td className="py-2 px-2 whitespace-nowrap">{r.c.lastPost ? fmtDay(r.c.lastPost) : <span className="text-gray-400">none collected</span>}</td>
                <td className="py-2 px-2 text-right tabular-nums">{r.avg !== null ? r.avg.toFixed(1) : <span className="text-gray-400">n/a</span>}</td>
                <td className="py-2 px-2 text-right">
                  {r.followers.length === 0 ? (
                    <span className="text-gray-400">not collected</span>
                  ) : (
                    <div className="space-y-0.5">
                      {r.followers.map((fo) => {
                        const d = fo.then !== null ? fo.now - fo.then : null;
                        return (
                          <div key={fo.platform} className="whitespace-nowrap tabular-nums" title={`Snapshot ${fmtDay(fo.at)}`}>
                            <span className="text-gray-400 text-[10px] mr-1">{fo.platform === "LINKEDIN" ? "in" : "X"}</span>
                            {fmtNum(fo.now)}{" "}
                            {d === null ? (
                              <span className="text-gray-400 text-[10px]">no 30d baseline</span>
                            ) : (
                              <span className={"text-[10px] " + (d > 0 ? "text-green-700" : d < 0 ? "text-red-700" : "text-gray-500")}>
                                {d > 0 ? "+" : d < 0 ? "−" : "±"}{fmtNum(Math.abs(d))}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="py-2 px-2 whitespace-nowrap">
                  {r.worst ? (
                    <span title={STATE_META[r.worst].label}>
                      <span style={{ color: STATE_META[r.worst].color }}>{STATE_META[r.worst].icon}</span>{" "}
                      {STATE_META[r.worst].label}
                      <span className="text-gray-400"> · {ago(r.lastSync)}</span>
                    </span>
                  ) : (
                    <span className="text-gray-400">no account</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        Posts are counted by publication date. Interactions = likes + comments + reposts where the network returns them; &quot;n/a&quot; means no counts were available, not zero.
        Campaign objectives and compliance are in Social Tracking.
      </p>
    </div>
  );
}

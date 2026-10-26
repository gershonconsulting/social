"use client";

/**
 * Social Dashboard — v4.65.0, "Who is posting what".
 *
 * Social is the client-intelligence platform. This page answers four
 * questions about the business world the workspace tracks: what happened,
 * what changed, what needs attention, what to do next. Campaign objectives,
 * compliance and content stock are NOT here — they live in Social Tracking.
 *
 * Honours the sidebar category / network filters and the page period picker.
 * Followers are never summed across companies. Stale or unavailable data is
 * labelled as such, never shown as zero.
 */
import Link from "next/link";
import { useMemo } from "react";
import type { EcoData, EcoPost } from "@/lib/ecosystem/data";
import { daysBetween, firstLine } from "@/lib/ecosystem/windows";
import {
  CATEGORY_ORDER, STATE_META, NET_LABEL,
  CatChip, Delta, NetBadge, WindowPicker,
  ago, catColor, catLabel, fmtDay, fmtNum, scopeText, useEcoWindow, useFiltered, windowRangeText,
} from "./eco-shared";

const eng = (p: EcoPost) => p.l + p.cm + p.s;

function Card({ title, hint, children, className = "" }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={"bg-white rounded-xl border border-gray-200 p-5 " + className}>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[14px] font-semibold text-gray-900">{title}</h2>
        {hint && <span className="text-[11px] text-gray-500 text-right">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

function PostLine({ p, data }: { p: EcoPost; data: EcoData }) {
  const c = data.companies[p.c];
  const e = eng(p);
  return (
    <li className="py-2.5 flex gap-3 items-start">
      <NetBadge n={p.n} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          <Link href={`/clients/${c.id}`} className="font-semibold text-gray-900 hover:underline">{c.name}</Link>
          <CatChip type={c.type} />
          <span className="text-gray-400">{fmtDay(p.d)}</span>
        </div>
        <div className="text-[13px] text-gray-700 truncate">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{firstLine(p.t) || "(no text)"}</a>
          ) : (
            firstLine(p.t) || "(no text)"
          )}
        </div>
      </div>
      <div className="text-[11px] text-gray-500 text-right whitespace-nowrap tabular-nums">
        {e > 0 ? (
          <span title={`${p.l} reactions · ${p.cm} comments · ${p.s} reposts${p.v ? ` · ${p.v} views` : ""}`}>{fmtNum(e)} eng.</span>
        ) : (
          <span className="text-gray-400" title="The network returned no interaction counts for this post">n/a</span>
        )}
      </div>
    </li>
  );
}

export function EcosystemDashboardClient({ data }: { data: EcoData }) {
  const [win, setWin] = useEcoWindow();
  const f = useFiltered(data, win);
  const { w, wIdx, hasPrev, visible, visSet, stats, conns, netOn } = f;

  const view = useMemo(() => {
    const all = Array.from(stats.values());
    const posts = all.reduce((s, x) => s + x.posts, 0);
    const prev = hasPrev ? all.reduce((s, x) => s + (x.prev ?? 0), 0) : null;
    const e = all.reduce((s, x) => s + x.eng, 0);
    const pe = hasPrev ? all.reduce((s, x) => s + (x.prevEng ?? 0), 0) : null;
    const active = all.filter((x) => x.posts > 0).length;
    const prevActive = hasPrev ? all.filter((x) => (x.prev ?? 0) > 0).length : null;

    // By category, fixed order.
    const byCat = CATEGORY_ORDER.map((t) => {
      const rows = all.filter((x) => data.companies[x.i].type === t);
      return {
        t,
        sources: rows.length,
        posts: rows.reduce((s, x) => s + x.posts, 0),
        prev: hasPrev ? rows.reduce((s, x) => s + (x.prev ?? 0), 0) : null,
        li: rows.reduce((s, x) => s + x.byNet[0], 0),
        x: rows.reduce((s, x) => s + x.byNet[1], 0),
      };
    }).filter((r) => r.sources > 0);
    const catMax = Math.max(1, ...byCat.map((r) => Math.max(r.posts, r.prev ?? 0)));

    // Collection coverage (current state, not windowed).
    const ok = conns.filter((c) => c[2] === "collected" || c[2] === "empty").length;
    const stale = conns.filter((c) => c[2] === "stale").length;
    const failed = conns.filter((c) => c[2] === "failed").length;
    const never = conns.filter((c) => c[2] === "never").length;
    const withConn = visible.filter((v) => data.companies[v.i].networks.length > 0).length;
    const freshCompanies = new Set(conns.filter((c) => c[2] === "collected" || c[2] === "empty").map((c) => c[0]));

    const active8 = all.filter((x) => x.posts > 0).sort((a, b) => b.posts - a.posts).slice(0, 8);
    const activeMax = Math.max(1, ...active8.map((x) => x.posts));

    // Quiet = tracked with a network, no post in 30+ days (or never).
    const quiet = visible
      .filter((v) => data.companies[v.i].networks.length > 0)
      .map((v) => {
        const c = data.companies[v.i];
        return { c, i: v.i, days: c.lastPost ? daysBetween(c.lastPost, data.today) : null };
      })
      .filter((q) => q.days === null || q.days >= 30)
      .sort((a, b) => (b.days ?? 1e9) - (a.days ?? 1e9));

    const feed = (data.latest?.[wIdx] ?? []).map((k) => data.posts![k]).filter((p) => visSet.has(p.c) && netOn(p.n)).slice(0, 15);
    const top = (data.top?.[wIdx] ?? []).map((k) => data.posts![k]).filter((p) => visSet.has(p.c) && netOn(p.n)).slice(0, 6);

    // Hashtags: merge the per-category top lists of the visible categories.
    let tags: Array<{ tag: string; n: number; pn: number }> | null = null;
    if (data.tags) {
      const visTypes = new Set(visible.map((v) => data.companies[v.i].type));
      const m = new Map<string, { tag: string; n: number; pn: number }>();
      for (const [wi, ty, tag, n, pn] of data.tags) {
        if (wi !== wIdx || !visTypes.has(ty)) continue;
        const r = m.get(tag) ?? { tag, n: 0, pn: 0 };
        r.n += n;
        r.pn += pn;
        m.set(tag, r);
      }
      tags = Array.from(m.values()).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).slice(0, 15);
    }

    // Needs attention / next actions, most severe first.
    type Item = { sev: number; text: string; href: string; ext?: boolean; cta: string };
    const items: Item[] = [];
    for (const [ci, n, st, , err] of conns) {
      const c = data.companies[ci];
      if (st === "failed") items.push({ sev: 0, text: `Collection failing for ${c.name} on ${NET_LABEL[n]}${err ? ` — ${err}` : ""}`, href: `/clients/${c.id}`, cta: "Fix source" });
      else if (st === "never") items.push({ sev: 1, text: `${c.name} on ${NET_LABEL[n]} has never been checked`, href: "/extension", cta: "Run collection" });
      else if (st === "stale") items.push({ sev: 2, text: `${c.name} on ${NET_LABEL[n]} not checked for over 48h — its numbers may be incomplete`, href: "/extension", cta: "Refresh" });
    }
    for (const v of visible) {
      const c = data.companies[v.i];
      if (c.networks.length === 0) items.push({ sev: 3, text: `${c.name} (${catLabel(c.type)}) has no LinkedIn or X account to collect`, href: `/clients/${c.id}`, cta: "Add account" });
    }
    for (const p of top.slice(0, 3)) {
      const c = data.companies[p.c];
      if (c.type === "COMPANY" || c.type === "INTERNAL") continue;
      items.push({
        sev: 4,
        text: `${catLabel(c.type)} ${c.name} drew ${fmtNum(eng(p))} interactions on ${NET_LABEL[p.n]}: “${firstLine(p.t, 70)}”`,
        href: p.url ?? `/clients/${c.id}`,
        ext: !!p.url,
        cta: "Engage / review",
      });
    }
    for (const c of visible.map((v) => data.companies[v.i])) {
      for (const fo of c.followers) {
        if (fo.then && fo.then > 50 && (fo.now - fo.then) / fo.then <= -0.05) {
          items.push({ sev: 5, text: `${c.name} lost ${fmtNum(fo.then - fo.now)} ${fo.platform === "LINKEDIN" ? "LinkedIn" : "X"} followers in 30 days`, href: `/clients/${c.id}`, cta: "Look into it" });
        }
      }
    }
    for (const q of quiet.slice(0, 5)) {
      if (!freshCompanies.has(q.i)) continue; // a data gap, already listed above
      items.push({ sev: 6, text: `${q.c.name} (${catLabel(q.c.type)}) has not posted ${q.days === null ? "since tracking started" : `in ${q.days} days`}`, href: `/clients/${q.c.id}`, cta: "Check source" });
    }
    items.sort((a, b) => a.sev - b.sev);

    return { posts, prev, e, pe, active, prevActive, byCat, catMax, ok, stale, failed, never, withConn, active8, activeMax, quiet, feed, top, tags, items };
  }, [stats, hasPrev, conns, visible, visSet, netOn, data, wIdx]);

  const total = conns.length;
  const seg = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  const avg = view.posts > 0 && view.e > 0 ? (view.e / view.posts).toFixed(1) : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold text-gray-900 leading-tight">Who is posting what</h1>
          <p className="text-[13px] text-gray-600 mt-1">
            Social dashboard — what happened in your business world, what changed, what needs attention and what to do next.
          </p>
          <p className="text-[11px] text-gray-500 mt-1">
            {scopeText(f.categories, f.networks)} · {windowRangeText(w)} · last refresh {ago(data.lastUpdate)}
          </p>
        </div>
        <WindowPicker value={win} onChange={setWin} />
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Posts observed" value={fmtNum(view.posts)} sub={<Delta cur={view.posts} prev={view.prev} />} />
        <Kpi label="Sources that posted" value={`${view.active} / ${visible.length}`} sub={<Delta cur={view.active} prev={view.prevActive} />} />
        <Kpi label="Interactions" value={view.e > 0 ? fmtNum(view.e) : view.posts > 0 ? "n/a" : "0"} sub={<Delta cur={view.e} prev={view.pe} />} />
        <Kpi
          label="Avg interactions / post"
          value={avg ?? "n/a"}
          sub={<span className="text-[11px] text-gray-400">likes + comments + reposts, where returned</span>}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Coverage */}
        <Card title="Collection coverage" hint="now · enabled accounts">
          <div className="text-[13px] text-gray-700">
            <b className="text-gray-900 tabular-nums">{view.ok} / {total}</b> accounts checked successfully in the last 48h
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 mt-2" aria-hidden>
            <div style={{ width: seg(view.ok), background: STATE_META.collected.color }} />
            <div style={{ width: seg(view.stale), background: STATE_META.stale.color }} />
            <div style={{ width: seg(view.failed), background: STATE_META.failed.color }} />
            <div style={{ width: seg(view.never), background: STATE_META.never.color }} />
          </div>
          <ul className="mt-3 space-y-1 text-[12px]">
            {([["collected", view.ok, "Checked OK"], ["stale", view.stale, STATE_META.stale.label], ["failed", view.failed, STATE_META.failed.label], ["never", view.never, STATE_META.never.label]] as const).map(([k, n, l]) => (
              <li key={k} className="flex justify-between">
                <span><span style={{ color: STATE_META[k].color }}>{STATE_META[k].icon}</span> {l}</span>
                <span className="tabular-nums text-gray-900">{n}</span>
              </li>
            ))}
            <li className="flex justify-between pt-1 border-t border-gray-100">
              <span>Sources with an account to collect</span>
              <span className="tabular-nums text-gray-900">{view.withConn} / {visible.length}</span>
            </li>
          </ul>
        </Card>

        {/* Activity by category */}
        <Card title="Activity by source category" hint={hasPrev ? "this period vs previous" : "all time"} className="lg:col-span-2">
          {view.byCat.length === 0 ? (
            <p className="text-[13px] text-gray-500">No tracked sources match the current filter.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="font-medium pb-1.5">Category</th>
                  <th className="font-medium pb-1.5 w-[45%]">Posts</th>
                  <th className="font-medium pb-1.5 text-right">LinkedIn</th>
                  <th className="font-medium pb-1.5 text-right">X</th>
                  <th className="font-medium pb-1.5 text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {view.byCat.map((r) => (
                  <tr key={r.t} className="border-t border-gray-100">
                    <td className="py-1.5"><CatChip type={r.t} /> <span className="text-gray-400">({r.sources})</span></td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 space-y-0.5">
                          <div className="h-2 rounded-sm" style={{ width: `${(r.posts / view.catMax) * 100}%`, background: catColor(r.t), minWidth: r.posts ? 2 : 0 }} />
                          {r.prev !== null && <div className="h-1 rounded-sm bg-gray-300" style={{ width: `${(r.prev / view.catMax) * 100}%`, minWidth: r.prev ? 2 : 0 }} />}
                        </div>
                        <span className="tabular-nums font-semibold text-gray-900 w-10 text-right">{r.posts}</span>
                      </div>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{r.li}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.x}</td>
                    <td className="py-1.5 text-right"><Delta cur={r.posts} prev={r.prev} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {hasPrev && <p className="text-[11px] text-gray-400 mt-2">Thick bar = this period, thin grey bar = previous comparable period. Counted by publication date.</p>}
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Feed */}
        <Card title="Who posted what" hint="latest posts in the period" className="lg:col-span-2">
          {view.feed.length === 0 ? (
            <p className="text-[13px] text-gray-500">No posts observed in this period for the current filter.</p>
          ) : (
            <ul className="divide-y divide-gray-100">{view.feed.map((p, k) => <PostLine key={k} p={p} data={data} />)}</ul>
          )}
        </Card>

        {/* Needs attention */}
        <Card title="Needs attention · next actions" hint={`${view.items.length} item${view.items.length === 1 ? "" : "s"}`}>
          {view.items.length === 0 ? (
            <p className="text-[13px] text-gray-500">Nothing needs attention for this filter.</p>
          ) : (
            <ul className="space-y-2">
              {view.items.slice(0, 12).map((it, k) => (
                <li key={k} className="text-[12px] text-gray-700 flex gap-2 items-start">
                  <span className={"mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 " + (it.sev <= 1 ? "bg-red-600" : it.sev <= 3 ? "bg-amber-500" : "bg-blue-600")} aria-hidden />
                  <span className="flex-1">
                    {it.text}{" "}
                    {it.ext ? (
                      <a href={it.href} target="_blank" rel="noreferrer" className="text-red-700 font-semibold hover:underline whitespace-nowrap">{it.cta} →</a>
                    ) : (
                      <Link href={it.href} className="text-red-700 font-semibold hover:underline whitespace-nowrap">{it.cta} →</Link>
                    )}
                  </span>
                </li>
              ))}
              {view.items.length > 12 && <li className="text-[11px] text-gray-400">+{view.items.length - 12} more — see <Link className="underline" href="/summary">Summary</Link></li>}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card title="Most active sources" hint="posts in the period">
          {view.active8.length === 0 ? (
            <p className="text-[13px] text-gray-500">No source posted in this period.</p>
          ) : (
            <ul className="space-y-1.5">
              {view.active8.map((x) => {
                const c = data.companies[x.i];
                return (
                  <li key={x.i} className="text-[12px]">
                    <div className="flex justify-between gap-2">
                      <Link href={`/clients/${c.id}`} className="truncate text-gray-900 hover:underline">{c.name}</Link>
                      <span className="tabular-nums font-semibold">{x.posts}</span>
                    </div>
                    <div className="h-1.5 rounded-sm mt-0.5" style={{ width: `${(x.posts / view.activeMax) * 100}%`, background: catColor(c.type) }} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Quiet sources" hint="no post in 30+ days">
          {view.quiet.length === 0 ? (
            <p className="text-[13px] text-gray-500">Every tracked source posted in the last 30 days.</p>
          ) : (
            <ul className="space-y-1 text-[12px]">
              {view.quiet.slice(0, 10).map((q) => (
                <li key={q.c.id} className="flex justify-between gap-2">
                  <Link href={`/clients/${q.c.id}`} className="truncate text-gray-900 hover:underline">{q.c.name}</Link>
                  <span className="text-gray-500 whitespace-nowrap">{q.days === null ? "no post collected" : `${q.days}d`}</span>
                </li>
              ))}
              {view.quiet.length > 10 && <li className="text-[11px] text-gray-400">+{view.quiet.length - 10} more</li>}
            </ul>
          )}
          <p className="text-[11px] text-gray-400 mt-2">A source whose collection is stale may look quiet — check coverage first.</p>
        </Card>

        <Card title="Trending hashtags" hint={hasPrev ? "posts using it · change" : "posts using it"}>
          {view.tags === null ? (
            <p className="text-[13px] text-gray-500">Hashtag data unavailable right now.</p>
          ) : view.tags.length === 0 ? (
            <p className="text-[13px] text-gray-500">No hashtags in this period.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {view.tags.map((t) => (
                <li key={t.tag} className="text-[12px] bg-gray-100 rounded-full px-2 py-0.5 text-gray-800">
                  #{t.tag} <b className="tabular-nums">{t.n}</b>
                  {hasPrev && (t.pn === 0 ? <span className="text-green-700 text-[10px] ml-1">new</span> : t.n > t.pn ? <span className="text-green-700 text-[10px] ml-1">▲</span> : t.n < t.pn ? <span className="text-red-700 text-[10px] ml-1">▼</span> : null)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Top posts by engagement" hint="likes + comments + reposts, where the network returns them">
        {view.top.length === 0 ? (
          <p className="text-[13px] text-gray-500">No post with interaction counts in this period.</p>
        ) : (
          <ul className="divide-y divide-gray-100">{view.top.map((p, k) => <PostLine key={k} p={p} data={data} />)}</ul>
        )}
      </Card>

      <p className="text-[11px] text-gray-400">
        Campaign objectives, compliance and content stock are tracked in Social Tracking. Per-company followers are on the{" "}
        <Link href="/summary" className="underline">Summary</Link> — never added up across companies.
      </p>
    </div>
  );
}

"use client";

/**
 * /publishing/calendar — what goes out when, and whether it really did
 * (v4.37.0). Each post sits on its day with a dot per network: amber =
 * scheduled, green = posted, red = failed/missed. The month totals the same
 * thing so a gap is visible at a glance. Statuses are swept server-side on
 * every load (lib/publishing.ts → sweep).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, PenSquare } from "lucide-react";
import {
  DELIVERY_STYLE, fmt, ITEM_STYLE, ItemBadge, LiveStrip, NetChip, nets,
  type ClientLite, type Delivery, type Item, type LiveAll,
} from "@/components/publishing/shared";
import { ItemPanel } from "@/components/publishing/item-panel";

type Feed = { items: Item[]; clients: ClientLite[]; live: LiveAll; limits: { x: number; linkedin: number }; canWrite: boolean };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const DOT: Record<Delivery["status"], string> = { SCHEDULED: "#f59e0b", POSTING: "#6366f1", POSTED: "#10b981", FAILED: "#dc2626", MISSED: "#b91c1c" };

export function PublishingCalendarClient() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(dayKey(new Date()));
  const [clientFilter, setClientFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    try {
      const r = await fetch(`/api/publishing/content?from=${from.toISOString()}&to=${to.toISOString()}`, { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setFeed(j.data);
    } catch {}
    setLoading(false);
  }, [month]);

  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const items = useMemo(() => (feed?.items || []).filter((i) => i.scheduledAt && (!clientFilter || i.clientId === clientFilter)), [feed, clientFilter]);
  const clientName = useMemo(() => new Map((feed?.clients || []).map((c) => [c.id, c.name])), [feed]);

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) {
      const k = dayKey(new Date(i.scheduledAt!));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    for (const l of m.values()) l.sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
    return m;
  }, [items]);

  const totals = useMemo(() => {
    const t = { planned: 0, posted: 0, confirmed: 0, upcoming: 0, problems: 0 };
    for (const i of items) for (const d of i.deliveries) {
      t.planned++;
      if (d.status === "POSTED") { t.posted++; if (d.verifiedAt) t.confirmed++; }
      else if (d.status === "SCHEDULED" || d.status === "POSTING") t.upcoming++;
      else t.problems++;
    }
    return t;
  }, [items]);

  const cells = useMemo(() => {
    const offset = (month.getDay() + 6) % 7;
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) out.push(new Date(month.getFullYear(), month.getMonth(), 1 - offset + i));
    return out[35].getMonth() === month.getMonth() ? out : out.slice(0, 35);
  }, [month]);

  const today = dayKey(new Date());
  const dayItems = byDay.get(selected) || [];
  const stat = (label: string, n: number, cls = "text-gray-900") => (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{n}</div>
    </div>
  );

  return (
    <div>
      <Header
        title="Publishing calendar"
        eyebrow="Publishing"
        subtitle="What goes out on LinkedIn and X, and whether it really did. Each post is checked on the page right after publishing, then again by the daily collection."
        actions={
          <>
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white">
              <option value="">All clients</option>
              {(feed?.clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Link href="/publishing" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800">
              <PenSquare size={14} /> Content board
            </Link>
          </>
        }
      />
      <LiveStrip live={feed?.live ?? null} />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {stat("Planned (per network)", totals.planned)}
        {stat("Posted", totals.posted, "text-emerald-700")}
        {stat("Confirmed on the network", totals.confirmed, "text-emerald-700")}
        {stat("Still to go out", totals.upcoming, "text-amber-700")}
        {stat("Failed / missed", totals.problems, totals.problems ? "text-red-700" : "text-gray-900")}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-5">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="p-1.5 rounded-md hover:bg-gray-100" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            {loading && <Loader2 size={13} className="animate-spin text-gray-400" />}
          </div>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="p-1.5 rounded-md hover:bg-gray-100" aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-7 text-[11px] font-medium text-gray-500 border-b border-gray-100">
          {DOW.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d) => {
            const k = dayKey(d);
            const list = byDay.get(k) || [];
            return (
              <button
                key={k}
                onClick={() => setSelected(k)}
                className={`min-h-[88px] text-left border-b border-r border-gray-100 px-1.5 py-1 hover:bg-gray-50 ${selected === k ? "bg-gray-50 ring-1 ring-inset ring-gray-900/20" : ""} ${d.getMonth() === month.getMonth() ? "" : "opacity-40"}`}
              >
                <div className={`text-[11px] mb-1 ${k === today ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white font-semibold" : "text-gray-500"}`}>{d.getDate()}</div>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((i) => (
                    <div key={i.id} className="flex items-center gap-1 text-[10.5px] leading-tight text-gray-700">
                      {i.deliveries.length
                        ? i.deliveries.map((x) => <span key={x.id} className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DOT[x.status] }} />)
                        : <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ITEM_STYLE[i.status].dot }} />}
                      <span className="tabular-nums text-gray-500">{new Date(i.scheduledAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                      <span className="truncate">{i.clientId ? clientName.get(i.clientId) : i.text}</span>
                    </div>
                  ))}
                  {list.length > 3 && <div className="text-[10px] text-gray-400">+{list.length - 3} more</div>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 px-4 py-2 border-t border-gray-100 text-[11px] text-gray-500">
          {(Object.keys(DOT) as Delivery["status"][]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: DOT[s] }} />{DELIVERY_STYLE[s].label}</span>
          ))}
          <span>· one dot per network</span>
        </div>
      </div>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          {(() => { const [y, m, d] = selected.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); })()}
        </h2>
        {dayItems.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing planned this day.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {dayItems.map((i) => (
              <div key={i.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <ItemBadge s={i.status} />
                  <span className="text-xs font-medium text-gray-800">{i.clientId ? clientName.get(i.clientId) : "No client"}</span>
                  <span className="text-xs text-gray-500">{fmt(i.scheduledAt)}</span>
                  <button onClick={() => setOpenId(i.id)} className="text-xs underline text-gray-600 ml-auto">Open</button>
                </div>
                <p className="text-sm text-gray-900 whitespace-pre-wrap break-words line-clamp-4">{i.text}</p>
                <div className="flex flex-wrap gap-3 mt-2">
                  {(i.deliveries.length ? i.deliveries : []).map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1 text-xs">
                      <NetChip n={d.platform} />
                      <span className={`font-medium ${DELIVERY_STYLE[d.status].cls}`}>
                        {DELIVERY_STYLE[d.status].label}{d.status === "POSTED" ? (d.verifiedAt ? " · confirmed" : " · confirming") : ""}
                      </span>
                      {d.postUrl && <a href={d.postUrl} target="_blank" rel="noreferrer" className="text-gray-600"><ExternalLink size={11} /></a>}
                    </span>
                  ))}
                  {!i.deliveries.length && nets(i.platforms).map((n) => <NetChip key={n} n={n} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {openId && feed && (
        <ItemPanel id={openId} clients={feed.clients} limits={feed.limits} canWrite={feed.canWrite} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  );
}

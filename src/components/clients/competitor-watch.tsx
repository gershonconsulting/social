"use client";

/**
 * Competitor Watch — who the competitors are, what they post, their key words
 * and how often they post, side by side with the company itself.
 *
 * Numbers are computed server-side from collected posts on every load (free).
 * The AI brief is optional and cached; it only runs on button press.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X, Sparkles, AlertCircle, ExternalLink, Swords, RefreshCw } from "lucide-react";

type Keyword = { term: string; count: number };
type Company = {
  id: string;
  name: string;
  isSelf: boolean;
  postCount: number;
  postsPerWeek: number;
  activeWeeks: number;
  weeksInWindow: number;
  lastPostDate: string | null;
  daysSinceLastPost: number | null;
  gapDays: number;
  bestWeekday: string | null;
  avgEngagement: number;
  mediaRate: number;
  hashtagRate: number;
  keywords: Keyword[];
  phrases: Keyword[];
  hashtags: Keyword[];
  themes: Array<{ key: string; label: string; count: number; share: number }>;
  topPosts: Array<{ date: string; text: string; engagement: number; url: string | null }>;
};
type Payload = {
  client: { id: string; name: string };
  windowDays: number;
  watch: {
    self: Company;
    competitors: Company[];
    gaps: Array<{ term: string; competitors: number; mentions: number }>;
    owned: Keyword[];
    themeComparison: Array<{ key: string; label: string; self: number; competitors: number }>;
  };
  competitors: Array<{ id: string; name: string; website: string | null; linkedin: string | null; x: string | null }>;
  available: Array<{ id: string; name: string }>;
  brief: { result: Brief; model: string; generatedAt: string } | null;
  aiConfigured: boolean;
};
type Brief = {
  headline?: string;
  competitors?: Array<{ name: string; positioning: string; whatTheyPost: string; signatureKeywords: string[]; cadence: string; threatLevel: string }>;
  sharedPlaybook?: string[];
  whiteSpace?: string[];
  whereCompanyLags?: string[];
  whereCompanyLeads?: string[];
  recommendations?: Array<{ action: string; why: string; priority: string }>;
  postIdeas?: Array<{ hook: string; angle: string; hashtags: string[] }>;
};

const WINDOWS = [30, 90, 180, 365];

function heat(share: number): string {
  if (share >= 40) return "bg-red-600 text-white";
  if (share >= 25) return "bg-red-400 text-white";
  if (share >= 12) return "bg-red-200 text-red-900";
  if (share > 0) return "bg-red-50 text-red-800";
  return "bg-gray-50 text-gray-300";
}

export function CompetitorWatch({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [windowDays, setWindowDays] = useState(90);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", linkedinUrl: "", xUrl: "", website: "" });
  const [openCompany, setOpenCompany] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(`/api/clients/${clientId}/competitors?window=${windowDays}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "Failed to load");
        setData(j.data);
        setLoading(false);
        return;
      } catch (e) {
        if (attempt === 3) setError(e instanceof Error ? e.message : "Failed to load");
        await new Promise((res) => setTimeout(res, 800 * attempt));
      }
    }
    setLoading(false);
  }, [clientId, windowDays]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(body: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/clients/${clientId}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({ success: false, error: `HTTP ${r.status}` }));
      if (!j.success) throw new Error(j.error);
      setForm({ name: "", linkedinUrl: "", xUrl: "", website: "" });
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(false);
    }
  }

  async function remove(competitorId: string) {
    setBusy(true);
    try {
      await fetch(`/api/clients/${clientId}/competitors?competitorId=${competitorId}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function generateBrief() {
    setBriefBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/clients/${clientId}/competitors/brief?window=${windowDays}`, { method: "POST" });
      const j = await r.json().catch(() => ({ success: false, error: `HTTP ${r.status}` }));
      if (!j.success) throw new Error(j.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Brief failed");
    } finally {
      setBriefBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="gx-card p-8 flex items-center justify-center text-sm text-gray-500 gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading Competitor Watch…
      </div>
    );
  }

  const all: Company[] = data ? [data.watch.self, ...data.watch.competitors] : [];
  const maxPpw = Math.max(0.1, ...all.map((c) => c.postsPerWeek));
  const missing = data ? data.watch.competitors.filter((c) => c.postCount === 0) : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="gx-card p-4 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Swords size={15} className="text-red-600" /> Competitor Watch — {clientName}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Who they are, what they post, their key words and how often — from collected LinkedIn / X posts.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindowDays(w)}
                className={`px-3 py-1.5 text-xs font-medium ${windowDays === w ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {w === 365 ? "1 year" : `${w} days`}
              </button>
            ))}
          </div>
          <button onClick={load} className="gx-btn-secondary" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error && (
        <div className="gx-card p-3 border-red-200 bg-red-50 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* Tracked competitors */}
      {data && (
        <div className="gx-card p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Tracked competitors ({data.competitors.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {data.competitors.map((c) => (
              <span key={c.id} className="gx-pill bg-gray-100 text-gray-800 pr-1">
                <a href={`/clients/${c.id}`} className="hover:underline">{c.name}</a>
                {c.linkedin && (
                  <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-700">
                    <ExternalLink size={11} />
                  </a>
                )}
                <button onClick={() => remove(c.id)} disabled={busy} className="ml-1 text-gray-400 hover:text-red-600" title="Stop tracking">
                  <X size={12} />
                </button>
              </span>
            ))}
            {data.competitors.length === 0 && <span className="text-sm text-gray-500">No competitors yet — add the first one.</span>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {data.available.length > 0 && (
              <select
                className="h-9 rounded-lg border border-gray-200 text-sm px-2 bg-white"
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && add({ competitorId: e.target.value })}
              >
                <option value="">+ Add an existing Competition company…</option>
                {data.available.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
            <button onClick={() => setAdding((v) => !v)} className="gx-btn-secondary">
              <Plus size={14} /> New competitor
            </button>
          </div>

          {adding && (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <input className="h-9 rounded-lg border border-gray-200 px-3 text-sm" placeholder="Company name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="h-9 rounded-lg border border-gray-200 px-3 text-sm" placeholder="LinkedIn company URL" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} />
              <input className="h-9 rounded-lg border border-gray-200 px-3 text-sm" placeholder="X URL (optional)" value={form.xUrl} onChange={(e) => setForm({ ...form, xUrl: e.target.value })} />
              <input className="h-9 rounded-lg border border-gray-200 px-3 text-sm" placeholder="Website (optional)" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              <button className="gx-btn-primary" disabled={busy || !form.name.trim()} onClick={() => add(form)}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add &amp; start collecting
              </button>
            </div>
          )}

          {missing.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No posts collected yet in this window for: {missing.map((m) => m.name).join(", ")}. The Chrome extension collects
              Competition companies on its next run; numbers fill in automatically.
            </div>
          )}
        </div>
      )}

      {data && data.competitors.length > 0 && (
        <>
          {/* WHO + FREQUENCY */}
          <div className="gx-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">Who posts, how often</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Company</th>
                    <th className="text-left px-3 py-2 font-medium w-48">Posts / week</th>
                    <th className="text-right px-3 py-2 font-medium">Posts</th>
                    <th className="text-right px-3 py-2 font-medium">Active weeks</th>
                    <th className="text-right px-3 py-2 font-medium">Last post</th>
                    <th className="text-right px-3 py-2 font-medium">Longest silence</th>
                    <th className="text-left px-3 py-2 font-medium">Best day</th>
                    <th className="text-right px-3 py-2 font-medium">Avg engagement</th>
                    <th className="text-right px-4 py-2 font-medium">Media</th>
                  </tr>
                </thead>
                <tbody>
                  {[...all].sort((a, b) => b.postsPerWeek - a.postsPerWeek).map((c) => (
                    <tr key={c.id} className={`border-t border-gray-100 ${c.isSelf ? "bg-red-50/60 font-semibold" : ""}`}>
                      <td className="px-4 py-2">{c.name}{c.isSelf && <span className="ml-2 gx-pill bg-red-600 text-white">You</span>}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 rounded bg-gray-100 flex-1">
                            <div className={`h-2 rounded ${c.isSelf ? "bg-red-600" : "bg-gray-700"}`} style={{ width: `${(c.postsPerWeek / maxPpw) * 100}%` }} />
                          </div>
                          <span className="gx-num text-xs w-8 text-right">{c.postsPerWeek}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right gx-num">{c.postCount}</td>
                      <td className="px-3 py-2 text-right gx-num">{c.activeWeeks}/{c.weeksInWindow}</td>
                      <td className="px-3 py-2 text-right gx-num">{c.daysSinceLastPost === null ? "—" : c.daysSinceLastPost === 0 ? "today" : `${c.daysSinceLastPost}d ago`}</td>
                      <td className="px-3 py-2 text-right gx-num">{c.postCount > 1 ? `${c.gapDays}d` : "—"}</td>
                      <td className="px-3 py-2">{c.bestWeekday ?? "—"}</td>
                      <td className="px-3 py-2 text-right gx-num">{c.avgEngagement}</td>
                      <td className="px-4 py-2 text-right gx-num">{c.mediaRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
              Engagement = likes + 3×comments + 5×shares. Window: last {windowDays} days.
            </div>
          </div>

          {/* WHAT */}
          <div className="gx-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">What they post — theme mix (% of posts)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Company</th>
                    {data.watch.themeComparison.map((t) => (
                      <th key={t.key} className="px-2 py-2 font-medium text-center">{t.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {all.map((c) => (
                    <tr key={c.id} className={`border-t border-gray-100 ${c.isSelf ? "font-semibold" : ""}`}>
                      <td className="px-4 py-1.5 whitespace-nowrap">{c.name}</td>
                      {c.themes.map((t) => (
                        <td key={t.key} className="px-1 py-1">
                          <div className={`rounded text-center py-1 gx-num ${heat(t.share)}`}>{c.postCount ? `${t.share}` : "·"}</div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* KEYWORDS: gaps + owned */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="gx-card p-4">
              <div className="text-sm font-semibold text-gray-900">Competitor key words {clientName} doesn&apos;t use</div>
              <div className="text-xs text-gray-500 mb-3">Used by 2+ competitors, absent from your top words — candidate topics.</div>
              <div className="flex flex-wrap gap-1.5">
                {data.watch.gaps.map((g) => (
                  <span key={g.term} className="gx-pill bg-gray-900 text-white">
                    {g.term} <span className="text-gray-400 gx-num">×{g.competitors}</span>
                  </span>
                ))}
                {data.watch.gaps.length === 0 && <span className="text-xs text-gray-400">Not enough collected posts yet.</span>}
              </div>
            </div>
            <div className="gx-card p-4">
              <div className="text-sm font-semibold text-gray-900">Ground only {clientName} owns</div>
              <div className="text-xs text-gray-500 mb-3">Your top words that no competitor uses — differentiation to keep.</div>
              <div className="flex flex-wrap gap-1.5">
                {data.watch.owned.map((k) => (
                  <span key={k.term} className="gx-pill bg-red-50 text-red-700">{k.term}</span>
                ))}
                {data.watch.owned.length === 0 && <span className="text-xs text-gray-400">Not enough collected posts yet.</span>}
              </div>
            </div>
          </div>

          {/* Per company keywords */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {all.map((c) => (
              <div key={c.id} className={`gx-card p-4 ${c.isSelf ? "ring-1 ring-red-200" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                  <div className="text-xs text-gray-500 gx-num">{c.postCount} posts · {c.postsPerWeek}/wk</div>
                </div>
                {c.postCount === 0 ? (
                  <div className="text-xs text-gray-400 mt-2">No posts collected in this window yet.</div>
                ) : (
                  <>
                    <div className="mt-3 text-[11px] uppercase tracking-wide text-gray-400">Key words</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {c.keywords.slice(0, 15).map((k) => (
                        <span key={k.term} className="gx-pill bg-gray-100 text-gray-700">{k.term} <span className="text-gray-400 gx-num">{k.count}</span></span>
                      ))}
                    </div>
                    {c.phrases.length > 0 && (
                      <>
                        <div className="mt-3 text-[11px] uppercase tracking-wide text-gray-400">Phrases</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.phrases.slice(0, 8).map((k) => (
                            <span key={k.term} className="gx-pill bg-white border border-gray-200 text-gray-700">{k.term}</span>
                          ))}
                        </div>
                      </>
                    )}
                    {c.hashtags.length > 0 && (
                      <>
                        <div className="mt-3 text-[11px] uppercase tracking-wide text-gray-400">Hashtags</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.hashtags.slice(0, 10).map((k) => (
                            <span key={k.term} className="gx-pill bg-red-50 text-red-700">#{k.term}</span>
                          ))}
                        </div>
                      </>
                    )}
                    <button onClick={() => setOpenCompany(openCompany === c.id ? null : c.id)} className="mt-3 text-xs text-gray-500 hover:text-gray-900 underline">
                      {openCompany === c.id ? "Hide" : "Show"} top posts
                    </button>
                    {openCompany === c.id && (
                      <div className="mt-2 space-y-2">
                        {c.topPosts.map((p, i) => (
                          <div key={i} className="text-xs border-l-2 border-red-200 pl-2 text-gray-700">
                            <span className="text-gray-400 gx-num">{p.date} · {p.engagement} eng.</span>{" "}
                            {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{p.text}</a> : p.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* AI brief */}
          <div className="gx-card p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Sparkles size={14} className="text-red-600" /> AI competitor brief</div>
                <div className="text-xs text-gray-500">
                  {data.brief ? `Generated ${new Date(data.brief.generatedAt).toLocaleString()} · ${data.brief.model}` : "Positioning, white space and post ideas, based on the numbers above."}
                </div>
              </div>
              <button className="gx-btn-primary" onClick={generateBrief} disabled={briefBusy || !data.aiConfigured}>
                {briefBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {data.brief ? "Regenerate" : "Generate brief"}
              </button>
            </div>
            {!data.aiConfigured && <div className="text-xs text-amber-700">No AI key configured — add one in Settings → Content Intelligence (AI).</div>}
            {data.brief && <BriefView brief={data.brief.result} />}
          </div>
        </>
      )}
    </div>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{title}</div>
      <ul className="list-disc pl-4 space-y-0.5 text-sm text-gray-700">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  );
}

function BriefView({ brief }: { brief: Brief }) {
  return (
    <div className="space-y-4">
      {brief.headline && <div className="text-base font-semibold text-gray-900">{brief.headline}</div>}
      {brief.competitors?.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {brief.competitors.map((c, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{c.name}</div>
                <span className={`gx-pill ${c.threatLevel === "high" ? "bg-red-600 text-white" : c.threatLevel === "medium" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>{c.threatLevel}</span>
              </div>
              <div className="text-gray-600 mt-1">{c.positioning}</div>
              <div className="text-gray-700 mt-1"><b>Posts:</b> {c.whatTheyPost}</div>
              <div className="text-gray-700 mt-1"><b>Cadence:</b> {c.cadence}</div>
              {c.signatureKeywords?.length > 0 && <div className="text-xs text-gray-500 mt-1">{c.signatureKeywords.join(" · ")}</div>}
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <List title="Shared playbook" items={brief.sharedPlaybook} />
        <List title="White space to own" items={brief.whiteSpace} />
        <List title="Where you lag" items={brief.whereCompanyLags} />
        <List title="Where you lead" items={brief.whereCompanyLeads} />
      </div>
      {brief.recommendations?.length ? (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Recommendations</div>
          <div className="space-y-1.5">
            {brief.recommendations.map((r, i) => (
              <div key={i} className="text-sm"><span className="gx-pill bg-gray-100 text-gray-700 mr-2">{r.priority}</span><b>{r.action}</b> — <span className="text-gray-600">{r.why}</span></div>
            ))}
          </div>
        </div>
      ) : null}
      {brief.postIdeas?.length ? (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Post ideas</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {brief.postIdeas.map((p, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3 text-sm">
                <div className="font-semibold">{p.hook}</div>
                <div className="text-gray-600 mt-1">{p.angle}</div>
                <div className="text-xs text-red-700 mt-1">{p.hashtags?.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

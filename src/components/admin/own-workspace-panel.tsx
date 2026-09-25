"use client";

/**
 * "Give own workspace" — moves a person out of the Gershon workspace into a
 * workspace of their own, holding only the companies ticked here (mirrored,
 * so the Gershon extension keeps collecting them and their posts are copied
 * across daily). Nothing is removed from the Gershon workspace.
 *
 * Pre-selects the obvious set: the company matching the person's email domain
 * (e.g. valos.it → VALOS) as Internal, plus every competitor already tracked
 * for it in Competitor Watch as Competition. So the usual case is one click.
 */

import { useEffect, useState } from "react";
import { Loader2, Building2 } from "lucide-react";

type Company = { id: string; name: string; website: string | null; clientType: string };
type Pick = { on: boolean; clientType: string };

const TYPES = ["INTERNAL", "COMPETITION", "CLIENT", "PARTNER", "PROSPECT", "CAMPAIGN", "COMPANY"];

function stem(s: string): string {
  return s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0].replace(/[^a-z0-9]/g, "");
}

export function OwnWorkspacePanel({
  user,
  onDone,
  onCancel,
}: {
  user: { id: string; name: string; email: string };
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [home, setHome] = useState<string>("");
  const [wsName, setWsName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/clients?light=1", { cache: "no-store" });
        const j = await r.json();
        const list: Company[] = (j.data || []).map((c: Company) => ({
          id: c.id, name: c.name, website: c.website, clientType: c.clientType,
        }));
        setCompanies(list);

        const domain = stem(user.email.split("@")[1] || "");
        const match = list.find((c) => (c.website && stem(c.website) === domain) || stem(c.name) === domain);
        const next: Record<string, Pick> = {};
        if (match) {
          next[match.id] = { on: true, clientType: "INTERNAL" };
          setHome(match.id);
          setWsName(match.name);
          const cr = await fetch(`/api/clients/${match.id}/competitors?window=30`, { cache: "no-store" });
          const cj = await cr.json().catch(() => null);
          for (const c of cj?.data?.competitors || []) next[c.id] = { on: true, clientType: "COMPETITION" };
        } else {
          setWsName(user.name || user.email);
        }
        setPicks(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load companies");
      } finally {
        setLoading(false);
      }
    })();
  }, [user.email, user.name]);

  const chosen = Object.entries(picks).filter(([, p]) => p.on);

  async function submit() {
    if (!chosen.length) return;
    if (!confirm(
      `Move ${user.email} into their own workspace "${wsName}" with ${chosen.length} companies?\n\n` +
      `They will stop seeing every other Gershon company immediately. Nothing is deleted from your workspace.`
    )) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/admin/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          workspaceName: wsName.trim() || user.email,
          companies: chosen.map(([id, p]) => ({ sourceClientId: id, clientType: p.clientType })),
          competitorsOf: home && picks[home]?.on ? home : undefined,
        }),
      });
      const j = await r.json().catch(() => ({ success: false, error: `HTTP ${r.status}` }));
      if (!j.success) throw new Error(j.error || `HTTP ${r.status}`);
      onDone(
        `${user.email} now has their own workspace "${j.data.workspace.name}" with ${j.data.companies.length} companies ` +
        `(${j.data.sync?.postsCopied ?? 0} posts copied).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  const shown = companies
    .filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(!!picks[b.id]?.on) - Number(!!picks[a.id]?.on) || a.name.localeCompare(b.name));

  return (
    <div className="px-4 pb-4 -mt-1">
      <div className="bg-gray-50 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Building2 size={14} className="text-red-600" /> Own workspace for {user.name || user.email}
        </div>
        {loading ? (
          <div className="text-xs text-gray-500 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading companies…</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-gray-500">Workspace name</label>
              <input value={wsName} onChange={(e) => setWsName(e.target.value)} className="text-sm px-2 py-1 border border-gray-300 rounded-lg bg-white" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter companies…" className="text-sm px-2 py-1 border border-gray-300 rounded-lg bg-white ml-auto" />
            </div>
            <div className="max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              {shown.map((c) => {
                const p = picks[c.id];
                return (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={!!p?.on}
                      onChange={(e) =>
                        setPicks((prev) => ({ ...prev, [c.id]: { on: e.target.checked, clientType: prev[c.id]?.clientType || c.clientType } }))
                      }
                    />
                    <span className="flex-1">{c.name}</span>
                    {p?.on && (
                      <select
                        value={p.clientType}
                        onChange={(e) => setPicks((prev) => ({ ...prev, [c.id]: { on: true, clientType: e.target.value } }))}
                        className="text-xs px-1.5 py-0.5 border border-gray-300 rounded bg-white"
                      >
                        {TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
                      </select>
                    )}
                  </label>
                );
              })}
            </div>
            {error && <div className="text-xs text-red-700">{error}</div>}
            <div className="flex items-center gap-2">
              <button onClick={submit} disabled={saving || !chosen.length} className="gx-btn-primary">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />}
                Move to own workspace ({chosen.length} {chosen.length === 1 ? "company" : "companies"})
              </button>
              <button onClick={onCancel} className="gx-btn-secondary">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

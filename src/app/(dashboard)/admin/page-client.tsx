"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Plus, Loader2, RefreshCw, Archive, RotateCcw, Globe, Search, Pencil, Check, X, ExternalLink, Trash2 } from "lucide-react";
import { slugify, formatDate, formatRelative, PLATFORM_LABELS } from "@/lib/utils";
import { ConnectionBadge } from "@/components/ui/connection-badge";

interface LatestPost {
  snippet: string | null;
  url: string | null;
  publishedAt: string;
}

interface PlatformConn {
  id: string;
  platform: string;
  connectionStatus: string;
  isMandatory: boolean;
  externalAccountUrl: string | null;
  latestPost: LatestPost | null;
}

interface Client {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  website: string | null;
  campaignStartDate: string | null;
  internalOwner: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  clientType: string;
  platformConnections: PlatformConn[];
}

interface DiscoveredLink {
  platform: string;
  url: string;
}

interface DiscoveryResult {
  name: string;
  slug: string;
  website: string;
  discovered: DiscoveredLink[];
}

const CLIENT_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-50 text-gray-700",
  ACTIVE: "bg-green-50 text-green-700",
  PAUSED: "bg-amber-50 text-amber-700",
  INCOMPLETE_SETUP: "bg-orange-50 text-orange-700",
  ARCHIVED: "bg-gray-100 text-gray-400",
};

const PLATFORM_ICONS: Record<string, string> = {
  LINKEDIN: "in",
  TWITTER: "\ud835\udd4f",
  GOOGLE_BUSINESS: "G",
  TIKTOK: "\u266a",
  PINTEREST: "P",
  THREADS: "@",
};

export default function AdminPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [creating, setCreating] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [syncingClientId, setSyncingClientId] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [discoveringUrlsId, setDiscoveringUrlsId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");

  const [websiteInput, setWebsiteInput] = useState("");
  const [newClientType, setNewClientType] = useState<string>("CLIENT");
  const [newCampaignStartDate, setNewCampaignStartDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, boolean>>({});

  // Inline URL editing state
  const [editingUrlConnId, setEditingUrlConnId] = useState<string | null>(null);
  const [editingUrlValue, setEditingUrlValue] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);

  async function handleSaveUrl(connId: string) {
    setSavingUrl(true);
    try {
      const res = await fetch("/api/platforms/" + connId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalAccountUrl: editingUrlValue.trim() || null }),
      });
      if (res.ok) {
        setEditingUrlConnId(null);
        setEditingUrlValue("");
        loadClients();
      }
    } catch { /* ignore */ }
    finally { setSavingUrl(false); }
  }

  async function handleChangeCategory(clientId: string, newType: string) {
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientType: newType }),
      });
      if (res.ok) loadClients();
    } catch { /* ignore */ }
  }

  async function loadClients() {
    setLoading(true);
    setLoadError("");
    // Retry up to 3 times with backoff. The edge worker that serves
    // /api/clients occasionally returns 500/503 (CF code 1101: "Worker
    // threw exception") on cold start, especially when Neon's pooler
    // also needs to spin up. Retrying transparently hides that flake.
    const MAX_RETRIES = 5;
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`/api/clients?light=1&includeArchived=${showArchived}`);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403 || res.redirected) {
            window.location.href = "/login";
            return;
          }
          // 5xx → retry. 4xx (other) → give up immediately.
          if (res.status >= 500 && attempt < MAX_RETRIES) {
            lastError = `HTTP ${res.status}`;
            await new Promise((r) => setTimeout(r, 250 * attempt));
            continue;
          }
          throw new Error(`Server error ${res.status}`);
        }
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          window.location.href = "/login";
          return;
        }
        const data = await res.json();
        if (data.success) {
          setClients(data.data);
          setLoadError("");
          setLoading(false);
          return;
        }
        lastError = data.error || "Failed to load companies";
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Network error";
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
      }
    }
    console.error("loadClients failed after retries:", lastError);
    setLoadError(`Failed to load companies (${lastError}). Click Try again below or refresh the page.`);
    setLoading(false);
  }

  useEffect(() => { loadClients(); }, [showArchived]);

  async function handleDiscover() {
    if (!websiteInput.trim()) return;
    setDiscovering(true);
    setFormError("");
    setDiscovery(null);

    try {
      const res = await fetch("/api/clients/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: websiteInput.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        setDiscovery(data.data);
        setEditName(data.data.name);
        setEditSlug(data.data.slug);
        const sel: Record<string, boolean> = {};
        data.data.discovered.forEach((d: DiscoveredLink) => { sel[d.platform] = true; });
        setSelectedPlatforms(sel);
      } else {
        setFormError(data.error ?? "Failed to scan website");
      }
    } catch {
      setFormError("Network error scanning website. Please try again.");
    } finally {
      setDiscovering(false);
    }
  }

  // Did a company with this slug land in the DB? Used to tell a genuine
  // failure apart from "the request blew up on the way back but the row was
  // committed" — the case that made every create look like an error.
  async function clientExists(slug: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`/api/clients?light=1&includeArchived=true`, { cache: "no-store" });
        if (res.ok) {
          const d = await res.json();
          if (d?.success && Array.isArray(d.data)) {
            return d.data.some((c: { slug: string }) => c.slug === slug);
          }
        }
      } catch { /* fall through to retry */ }
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    return false;
  }

  function resetCreateForm() {
    setShowCreateForm(false);
    setDiscovery(null);
    setWebsiteInput("");
    setEditName("");
    setEditSlug("");
    setSelectedPlatforms({});
    setNewClientType("CLIENT");
    setNewCampaignStartDate(new Date().toISOString().slice(0, 10));
  }

  async function handleCreate() {
    if (!discovery) return;
    setCreating(true);
    setFormError("");

    const slug = editSlug;
    const name = editName;

    try {
      const connections = discovery.discovered
        .filter((d) => selectedPlatforms[d.platform])
        .map((d) => ({ platform: d.platform, externalAccountUrl: d.url }));

      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          slug,
          website: discovery.website,
          clientType: newClientType,
          status: "ACTIVE",
          campaignStartDate: newCampaignStartDate
            ? new Date(newCampaignStartDate + "T00:00:00").toISOString()
            : new Date().toISOString(),
          platformConnections: connections,
        }),
      });

      // The edge worker can return a non-JSON body (Cloudflare 1101/1102 error
      // page) on a request whose DB write already committed. Never let a parse
      // failure alone decide that the create failed.
      const data = await res.json().catch(() => null);

      if (data?.success) {
        const warnings: string[] | undefined = data.warnings;
        resetCreateForm();
        loadClients();
        setSyncMsg(
          warnings?.length
            ? `“${name}” was created, but: ${warnings.join(" ")}`
            : `“${name}” was created.`
        );
        void syncPhantombusterSheet();
        return;
      }

      // A clean 4xx from our own API is a real, actionable rejection
      // (validation, duplicate slug) — nothing was written, so report it.
      if (data && data.success === false && res.status >= 400 && res.status < 500) {
        setFormError(data.error ?? "Failed to create company");
        return;
      }

      // Anything else (5xx, unparseable body, aborted response): the row may
      // well be in the database. Check before crying wolf.
      if (await clientExists(slug)) {
        resetCreateForm();
        loadClients();
        setSyncMsg(`“${name}” was created. (The server hiccuped on the way back, but the company is saved.)`);
        void syncPhantombusterSheet();
        return;
      }

      setFormError(data?.error ?? `Failed to create company (server returned ${res.status}).`);
    } catch {
      // fetch() itself rejected — same reasoning as above.
      if (await clientExists(slug)) {
        resetCreateForm();
        loadClients();
        setSyncMsg(`“${name}” was created. (The connection dropped on the way back, but the company is saved.)`);
        void syncPhantombusterSheet();
        return;
      }
      setFormError("Network error creating company. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  // Rebuild the Phantombuster source spreadsheet after a create. Fired from the
  // browser rather than as an un-awaited self-fetch inside the API route: on the
  // Cloudflare edge runtime that dangling fetch could abort the create response
  // itself. Failure here is invisible and harmless — the nightly job re-syncs.
  async function syncPhantombusterSheet() {
    try {
      await fetch("/api/admin/sheets-sync", { method: "POST" });
    } catch { /* non-fatal */ }
  }

  function handleCancel() {
    setShowCreateForm(false);
    setDiscovery(null);
    setWebsiteInput("");
    setEditName("");
    setEditSlug("");
    setSelectedPlatforms({});
    setFormError("");
  }

  async function handleHardDelete(clientId: string, clientName: string) {
    const confirmed = confirm(
      `PERMANENTLY DELETE "${clientName}"?\n\n` +
      `This removes the company AND all of its posts, compliance records, ` +
      `follower snapshots, and platform connections. THIS CANNOT BE UNDONE.\n\n` +
      `If you just want to hide it but keep the data, use Archive instead.`
    );
    if (!confirmed) return;
    const res = await fetch(`/api/clients/${clientId}?hard=true`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (data?.success) {
      loadClients();
    } else {
      alert(`Delete failed: ${data?.error ?? "Unknown error"}`);
    }
  }

  async function handleArchive(clientId: string) {
    if (!confirm("Archive this client? Historical data will be preserved.")) return;
    await fetch(`/api/clients/${clientId}?reason=Archived via admin`, { method: "DELETE" });
    loadClients();
  }

  async function handleRestore(clientId: string) {
    await fetch(`/api/clients/${clientId}/restore`, { method: "POST" });
    loadClients();
  }

  async function handleBackfill(clientId: string) {
    setSyncingClientId(clientId);
    setSyncMsg("");
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);
    since.setMonth(0);
    since.setDate(1);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "backfill",
          clientId,
          since: since.toISOString(),
          until: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      setSyncMsg(data.success ? "Backfill complete" : `Error: ${data.error}`);
    } catch {
      setSyncMsg("Backfill request failed");
    } finally {
      setSyncingClientId(null);
    }
  }



  async function handleDiscoverUrls(clientId: string, website: string) {
    setDiscoveringUrlsId(clientId);
    setSyncMsg("");
    try {
      const res = await fetch("/api/clients/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website }),
      });
      const data = await res.json();
      if (!data.success) {
        setSyncMsg("Discovery failed: " + (data.error || "Unknown error"));
        return;
      }
      const discovered: DiscoveredLink[] = data.data.discovered;
      const client = clients.find((c) => c.id === clientId);
      if (!client) return;

      let updated = 0;
      for (const disc of discovered) {
        const conn = client.platformConnections.find((c) => c.platform === disc.platform);
        if (conn && !conn.externalAccountUrl) {
          const patchRes = await fetch("/api/platforms/" + conn.id, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ externalAccountUrl: disc.url }),
          });
          if (patchRes.ok) updated++;
        }
      }
      setSyncMsg(updated > 0 ? updated + " profile URL(s) discovered and saved" : "No new URLs found");
      loadClients();
    } catch {
      setSyncMsg("Discovery request failed");
    } finally {
      setDiscoveringUrlsId(null);
    }
  }

  function truncate(str: string | null, len: number): string {
    if (!str) return "";
    return str.length > len ? str.slice(0, len) + "\u2026" : str;
  }

  return (
    <div>
      <Header
        title="Admin"
        subtitle="Company Management, platform connections, and system controls"
        actions={
          <a
            href="/gershonai-extension.zip"
            download="gershonai-extension.zip"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            ⬇️ Download GershonAI extension
          </a>
        }
      />

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Companies</h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded"
              />
              Show archived
            </label>
            <button
              onClick={() => setShowCreateForm(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#FE1B04] rounded-lg hover:bg-[#d11200] transition-colors"
            >
              <Plus size={14} />
              Add Company
            </button>
          </div>
        </div>

        {syncMsg && (
          <div className="mb-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            {syncMsg}
          </div>
        )}

        {showCreateForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            {!discovery ? (
              <>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Add New Company</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Enter the client&apos;s website and we&apos;ll automatically find their social media profiles.
                </p>
                {formError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                    {formError}
                  </div>
                )}
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="url"
                      value={websiteInput}
                      onChange={(e) => setWebsiteInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
                      className="w-full pl-10 pr-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                      placeholder="https://example.com"
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={handleDiscover}
                    disabled={discovering || !websiteInput.trim()}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-[#FE1B04] rounded-lg hover:bg-[#d11200] disabled:opacity-60 transition-colors"
                  >
                    {discovering ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Search size={14} />
                    )}
                    {discovering ? "Scanning\u2026" : "Scan Website"}
                  </button>
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Review &amp; Create Company</h3>
                {formError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                    {formError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Company Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value);
                        setEditSlug(slugify(e.target.value));
                      }}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
                    <input
                      type="text"
                      value={editSlug}
                      onChange={(e) => setEditSlug(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                    <select
                      value={newClientType}
                      onChange={(e) => setNewClientType(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <option value="CAMPAIGN">Campaign</option>
                      <option value="CLIENT">Client</option>
                      <option value="PROSPECT">Prospect</option>
                      <option value="PARTNER">Partner</option>
                      <option value="COMPETITION">Competition</option>
                      <option value="INTERNAL">Internal</option>
                      <option value="RECYCLED">Recycled</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Campaign Start Date</label>
                    <input
                      type="date"
                      value={newCampaignStartDate}
                      onChange={(e) => setNewCampaignStartDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>

                <div className="mb-5">
                  <label className="block text-xs font-medium text-gray-600 mb-2">
                    Discovered Social Profiles
                    {discovery.discovered.length === 0 && (
                      <span className="text-gray-400 font-normal ml-1">&mdash; none found on this website</span>
                    )}
                  </label>
                  {discovery.discovered.length > 0 ? (
                    <div className="space-y-2">
                      {discovery.discovered.map((d) => (
                        <label
                          key={d.platform}
                          className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPlatforms[d.platform] ?? false}
                            onChange={(e) =>
                              setSelectedPlatforms((s) => ({ ...s, [d.platform]: e.target.checked }))
                            }
                            className="rounded text-blue-600"
                          />
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-white border border-gray-200 rounded text-xs font-bold text-gray-600">
                            {PLATFORM_ICONS[d.platform] ?? "?"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900">
                              {PLATFORM_LABELS[d.platform] ?? d.platform}
                            </div>
                            <div className="text-xs text-gray-500 truncate">{d.url}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">
                      You can manually add platform connections after creating the client.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCreate}
                    disabled={creating || !editName.trim() || !editSlug.trim()}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-[#FE1B04] rounded-lg hover:bg-[#d11200] disabled:opacity-60 transition-colors"
                  >
                    {creating && <Loader2 size={14} className="animate-spin" />}
                    Create Company
                  </button>
                  <button
                    onClick={() => setDiscovery(null)}
                    className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Client Type Tabs */}
        <div className="flex items-center gap-1 mb-4">
          {[
            { key: "ALL", label: "All" },
            { key: "CAMPAIGN", label: "Campaigns" },
            { key: "CLIENT", label: "Clients" },
            { key: "PROSPECT", label: "Prospects" },
            { key: "PARTNER", label: "Partners" },
            { key: "COMPETITION", label: "Competition" },
            { key: "INTERNAL", label: "Internal" },
            { key: "RECYCLED", label: "Recycled" },
          ].map((tab) => {
            const count = tab.key === "ALL"
              ? clients.length
              : clients.filter((c) => c.clientType === tab.key).length;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.key
                    ? "bg-[#FE1B04] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 text-xs ${activeTab === tab.key ? "text-blue-200" : "text-gray-400"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Client table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">
              <Loader2 size={16} className="animate-spin mx-auto mb-2" />
              Loading clients&hellip;
            </div>
          ) : loadError ? (
            <div className="px-6 py-12 text-center text-sm">
              <div className="text-red-500 mb-2">{loadError}</div>
              <button
                onClick={() => loadClients()}
                className="text-blue-600 hover:underline text-xs"
              >
                Try again
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Platforms &amp; Last Posts</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clients.filter((c) => activeTab === "ALL" || c.clientType === activeTab).map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50 align-top">
                    <td className="px-6 py-3">
                      <div className="font-medium text-gray-900">{client.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{client.slug}</div>
                      {client.website && (
                        <a
                          href={client.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline flex items-center gap-0.5 mt-0.5"
                        >
                          <Globe size={10} />
                          {(() => { try { return new URL(client.website).hostname; } catch { return client.website; } })()}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CLIENT_STATUS_COLORS[client.status] ?? ""}`}>
                        {client.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {client.platformConnections.length > 0 ? (
                        <div className="space-y-1.5">
                          {client.platformConnections.filter((c) => ["LINKEDIN","TWITTER","GOOGLE_BUSINESS"].includes(c.platform)).map((conn) => (
                            <div key={conn.id} className="flex items-start gap-2">
                              <span className="inline-flex items-center justify-center w-5 h-5 bg-gray-100 rounded text-[10px] font-bold text-gray-500 mt-0.5 shrink-0">
                                {PLATFORM_ICONS[conn.platform] ?? "?"}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-gray-700">
                                    {PLATFORM_LABELS[conn.platform] ?? conn.platform}
                                  </span>
                                  <ConnectionBadge status={conn.connectionStatus} />
                                </div>
                                {/* Editable external URL */}
                                {editingUrlConnId === conn.id ? (
                                  <div className="flex items-center gap-1 mt-1">
                                    <input
                                      type="url"
                                      value={editingUrlValue}
                                      onChange={(e) => setEditingUrlValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleSaveUrl(conn.id);
                                        if (e.key === "Escape") { setEditingUrlConnId(null); setEditingUrlValue(""); }
                                      }}
                                      className="flex-1 px-2 py-1 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500 min-w-[200px]"
                                      placeholder="https://linkedin.com/company/..."
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleSaveUrl(conn.id)}
                                      disabled={savingUrl}
                                      className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                                      title="Save"
                                    >
                                      {savingUrl ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                    </button>
                                    <button
                                      onClick={() => { setEditingUrlConnId(null); setEditingUrlValue(""); }}
                                      className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                                      title="Cancel"
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 mt-0.5 group">
                                    {conn.externalAccountUrl ? (
                                      <a
                                        href={conn.externalAccountUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[11px] text-blue-500 hover:underline truncate max-w-[260px] inline-flex items-center gap-0.5"
                                        title={conn.externalAccountUrl}
                                      >
                                        <ExternalLink size={9} className="shrink-0" />
                                        {conn.externalAccountUrl.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "")}
                                      </a>
                                    ) : (
                                      <span className="text-[11px] text-gray-300 italic">No URL set</span>
                                    )}
                                    <button
                                      onClick={() => { setEditingUrlConnId(conn.id); setEditingUrlValue(conn.externalAccountUrl || ""); }}
                                      className="p-0.5 text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Edit URL"
                                    >
                                      <Pencil size={10} />
                                    </button>
                                  </div>
                                )}
                                {conn.latestPost ? (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    {conn.latestPost.url ? (
                                      <a
                                        href={conn.latestPost.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-gray-500 hover:text-blue-600 hover:underline truncate max-w-[280px]"
                                        title={conn.latestPost.snippet ?? ""}
                                      >
                                        {truncate(conn.latestPost.snippet, 60) || "View post"}
                                      </a>
                                    ) : (
                                      <span className="text-xs text-gray-500 truncate max-w-[280px]">
                                        {truncate(conn.latestPost.snippet, 60)}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-gray-400 shrink-0">
                                      &middot; {formatRelative(conn.latestPost.publishedAt)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400 mt-0.5 block">No posts yet</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">No platforms</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {client.status !== "ARCHIVED" ? (
                          <>
                            {client.website && (
                            <button
                              onClick={() => handleDiscoverUrls(client.id, client.website!)}
                              disabled={discoveringUrlsId === client.id}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 bg-blue-50 rounded hover:bg-blue-100 disabled:opacity-60"
                              title="Discover social profile URLs from website"
                            >
                              {discoveringUrlsId === client.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Globe size={11} />
                              )}
                              Discover
                            </button>
                            )}
                            <button
                                       onClick={() => handleBackfill(client.id)}
                              disabled={syncingClientId === client.id}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-60"
                              title="Run backfill from Jan 1"
                            >
                              {syncingClientId === client.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RefreshCw size={11} />
                              )}
                              Backfill
                            </button>
                            <button
                              onClick={() => handleArchive(client.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-amber-600 bg-amber-50 rounded hover:bg-amber-100"
                              title="Archive — soft delete, historical data preserved"
                            >
                              <Archive size={11} />
                              Archive
                            </button>
                            <button
                              onClick={() => handleHardDelete(client.id, client.name)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-700 bg-red-100 rounded hover:bg-red-200"
                              title="Delete permanently — removes posts, compliance, followers, the company itself"
                            >
                              <Trash2 size={11} />
                              Delete
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleRestore(client.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-green-600 bg-green-50 rounded hover:bg-green-100"
                          >
                            <RotateCcw size={11} />
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm">
                      No companies found. Click &quot;Add Company&quot; to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}

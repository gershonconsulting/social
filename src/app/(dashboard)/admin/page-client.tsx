"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Plus, Loader2, RefreshCw, Archive, RotateCcw, Globe, Search } from "lucide-react";
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
  FACEBOOK: "f",
  INSTAGRAM: "ig",
  YOUTUBE: "\u25b6",
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
  const [creating, setCreating] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [syncingClientId, setSyncingClientId] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [formError, setFormError] = useState("");

  const [websiteInput, setWebsiteInput] = useState("");
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, boolean>>({});

  async function loadClients() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/clients?includeArchived=${showArchived}`);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.redirected) {
          window.location.href = "/login";
          return;
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
      } else {
        setLoadError(data.error || "Failed to load clients");
      }
    } catch (err) {
      console.error("loadClients error:", err);
      setLoadError("Failed to load clients. Please refresh the page.");
    } finally {
      setLoading(false);
    }
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

  async function handleCreate() {
    if (!discovery) return;
    setCreating(true);
    setFormError("");

    try {
      const connections = discovery.discovered
        .filter((d) => selectedPlatforms[d.platform])
        .map((d) => ({ platform: d.platform, externalAccountUrl: d.url }));

      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          slug: editSlug,
          website: discovery.website,
          status: "ACTIVE",
          campaignStartDate: new Date().toISOString(),
          platformConnections: connections,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setShowCreateForm(false);
        setDiscovery(null);
        setWebsiteInput("");
        setEditName("");
        setEditSlug("");
        setSelectedPlatforms({});
        loadClients();
      } else {
        setFormError(data.error ?? "Failed to create client");
      }
    } catch {
      setFormError("Network error creating client. Please try again.");
    } finally {
      setCreating(false);
    }
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

  function truncate(str: string | null, len: number): string {
    if (!str) return "";
    return str.length > len ? str.slice(0, len) + "\u2026" : str;
  }

  return (
    <div>
      <Header title="Admin" subtitle="Client management, platform connections, and system controls" />

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Clients</h2>
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={14} />
              Add Client
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
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Add New Client</h3>
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
                      className="w-full pl-10 pr-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="https://example.com"
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={handleDiscover}
                    disabled={discovering || !websiteInput.trim()}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
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
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Review &amp; Create Client</h3>
                {formError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                    {formError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Client Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value);
                        setEditSlug(slugify(e.target.value));
                      }}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
                    <input
                      type="text"
                      value={editSlug}
                      onChange={(e) => setEditSlug(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
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
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
                  >
                    {creating && <Loader2 size={14} className="animate-spin" />}
                    Create Client
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
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Client</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Platforms &amp; Last Posts</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clients.map((client) => (
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
                          {client.platformConnections.map((conn) => (
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
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 bg-red-50 rounded hover:bg-red-100"
                            >
                              <Archive size={11} />
                              Archive
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
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-400 text-sm">
                      No clients found. Click &quot;Add Client&quot; to create one.
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

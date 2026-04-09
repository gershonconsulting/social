"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Plus, Loader2, RefreshCw, Archive, RotateCcw } from "lucide-react";
import { slugify, formatDate, formatDateTime } from "@/lib/utils";
import { ConnectionBadge } from "@/components/ui/connection-badge";

interface Client {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  campaignStartDate: string | null;
  internalOwner: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  platformConnections: {
    platform: string;
    connectionStatus: string;
    isMandatory: boolean;
  }[];
}

const CLIENT_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-50 text-gray-700",
  ACTIVE: "bg-green-50 text-green-700",
  PAUSED: "bg-amber-50 text-amber-700",
  INCOMPLETE_SETUP: "bg-orange-50 text-orange-700",
  ARCHIVED: "bg-gray-100 text-gray-400",
};

export default function AdminPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [syncingClientId, setSyncingClientId] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [formError, setFormError] = useState("");

  const [form, setForm] = useState({
    name: "",
    slug: "",
    timezone: "America/New_York",
    internalOwner: "",
    campaignStartDate: "",
    reportingStartDate: "",
    website: "",
    industry: "",
    notes: "",
    status: "DRAFT",
  });

  async function loadClients() {
    setLoading(true);
    const res = await fetch(`/api/clients?includeArchived=${showArchived}`);
    const data = await res.json();
    if (data.success) setClients(data.data);
    setLoading(false);
  }

  useEffect(() => { loadClients(); }, [showArchived]);

  function handleNameChange(name: string) {
    setForm((f) => ({ ...f, name, slug: slugify(name) }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFormError("");

    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        campaignStartDate: form.campaignStartDate ? new Date(form.campaignStartDate).toISOString() : null,
        reportingStartDate: form.reportingStartDate ? new Date(form.reportingStartDate).toISOString() : null,
        website: form.website || null,
      }),
    });

    const data = await res.json();
    setCreating(false);

    if (data.success) {
      setShowCreateForm(false);
      setForm({ name: "", slug: "", timezone: "America/New_York", internalOwner: "", campaignStartDate: "", reportingStartDate: "", website: "", industry: "", notes: "", status: "DRAFT" });
      loadClients();
    } else {
      setFormError(data.error ?? "Failed to create client");
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
    setSyncingClientId(null);
    setSyncMsg(data.success ? "Backfill complete" : `Error: ${data.error}`);
  }

  return (
    <div>
      <Header title="Admin" subtitle="Client management, platform connections, and system controls" />

      {/* Clients section */}
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

        {/* Create form */}
        {showCreateForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">New Client</h3>
            {formError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {formError}
              </div>
            )}
            <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Client Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Slug *</label>
                <input
                  type="text"
                  required
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="acme-corp"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Timezone</label>
                <select
                  value={form.timezone}
                  onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="America/New_York">America/New_York</option>
                  <option value="America/Chicago">America/Chicago</option>
                  <option value="America/Denver">America/Denver</option>
                  <option value="America/Los_Angeles">America/Los_Angeles</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Internal Owner</label>
                <input
                  type="text"
                  value={form.internalOwner}
                  onChange={(e) => setForm((f) => ({ ...f, internalOwner: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="John Smith"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Campaign Start</label>
                <input
                  type="date"
                  value={form.campaignStartDate}
                  onChange={(e) => setForm((f) => ({ ...f, campaignStartDate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reporting Start</label>
                <input
                  type="date"
                  value={form.reportingStartDate}
                  onChange={(e) => setForm((f) => ({ ...f, reportingStartDate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused</option>
                  <option value="INCOMPLETE_SETUP">Incomplete Setup</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Website</label>
                <input
                  type="url"
                  value={form.website}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                >
                  {creating && <Loader2 size={13} className="animate-spin" />}
                  Create Client
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Client table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">
              <Loader2 size={16} className="animate-spin mx-auto mb-2" />
              Loading clients…
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Client</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Platforms</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Campaign Start</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <div className="font-medium text-gray-900">{client.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{client.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CLIENT_STATUS_COLORS[client.status] ?? ""}`}>
                        {client.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {client.platformConnections.map((conn) => (
                          <ConnectionBadge key={conn.platform} status={conn.connectionStatus} />
                        ))}
                        {client.platformConnections.length === 0 && (
                          <span className="text-xs text-gray-400">None</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(client.campaignStartDate)}
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
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm">
                      No clients found. Click "Add Client" to create one.
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

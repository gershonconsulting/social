"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { FileDown, Loader2, TrendingUp, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { formatPercent } from "@/lib/utils";
import type { ClientMonthlyReport } from "@/types";

interface Client {
  id: string;
  name: string;
  slug: string;
}

interface MonthlyReportData extends ClientMonthlyReport {}

const BADGE_CONFIG = {
  "100_PCT": { label: "100% Objective Met", icon: CheckCircle2, color: "text-green-700 bg-green-50 border-green-200" },
  BELOW_TARGET: { label: "Objective Not Met", icon: XCircle, color: "text-red-700 bg-red-50 border-red-200" },
  INCOMPLETE_VERIFICATION: { label: "Incomplete Verification", icon: AlertCircle, color: "text-amber-700 bg-amber-50 border-amber-200" },
};

export default function ReportsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [report, setReport] = useState<MonthlyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients?clientType=CAMPAIGN")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setClients(d.data);
      });

    // Check URL params
    const params = new URLSearchParams(window.location.search);
    const cid = params.get("clientId");
    if (cid) setSelectedClientId(cid);
  }, []);

  useEffect(() => {
    if (!selectedClientId) return;
    fetch(`/api/reports/monthly?clientId=${selectedClientId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setAvailableMonths(d.data);
          if (d.data.length > 0) setSelectedMonth(d.data[0]);
        }
      });
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId || !selectedMonth) return;
    setLoading(true);
    setError(null);
    fetch(`/api/reports/monthly?clientId=${selectedClientId}&month=${selectedMonth}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setReport(d.data);
        else setError(d.error);
      })
      .catch(() => setError("Failed to load report"))
      .finally(() => setLoading(false));
  }, [selectedClientId, selectedMonth]);

  async function handleExportCSV() {
    if (!selectedClientId || !selectedMonth) return;
    setExporting(true);
    const res = await fetch(
      `/api/reports/export?clientId=${selectedClientId}&month=${selectedMonth}&format=csv`
    );
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  }

  return (
    <div>
      <Header title="Monthly Reports" subtitle="Posting objective compliance by campaign and platform" />

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Campaign</label>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Select a campaign…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {availableMonths.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        {report && (
          <div className="ml-auto">
            <label className="block text-xs font-medium text-transparent mb-1">Export</label>
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              Export CSV
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-12 justify-center">
          <Loader2 size={16} className="animate-spin" />
          Loading report…
        </div>
      )}

      {error && (
        <div className="text-red-600 text-sm p-4 bg-red-50 rounded-lg">{error}</div>
      )}

      {!loading && !report && !selectedClientId && clients.length > 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">
          Select a campaign to view monthly compliance reports.
        </div>
      )}

      {!loading && clients.length === 0 && (
        <div className="mx-auto max-w-md mt-8 p-6 text-center bg-amber-50 border border-amber-200 rounded-xl">
          <div className="text-sm font-semibold text-amber-900 mb-1">
            No campaigns yet
          </div>
          <div className="text-xs text-amber-800">
            Monthly reports cover companies categorized as Campaign. Tag a
            company as Campaign on its per-client page (or in the Companies
            list) and it will show up here.
          </div>
        </div>
      )}

      {!loading && !error && selectedClientId && availableMonths.length === 0 && (
        <div className="mx-auto max-w-md mt-8 p-6 text-center bg-amber-50 border border-amber-200 rounded-xl">
          <div className="text-sm font-semibold text-amber-900 mb-1">
            No report data yet for this client
          </div>
          <div className="text-xs text-amber-800">
            We have neither compliance records nor posts in any month for this client.
            Run a sync from the client page, then come back.
          </div>
        </div>
      )}

      {!loading && !error && selectedClientId && availableMonths.length > 0 && !selectedMonth && (
        <div className="text-center py-16 text-gray-400 text-sm">
          Pick a month to view the report.
        </div>
      )}

      {!loading && report && (
        <div className="space-y-6">
          {/* Executive summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{report.clientName}</h2>
                <div className="text-sm text-gray-500">{report.month}</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-gray-900">
                  {formatPercent(report.overallCompletionRate)}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Overall completion</div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
              <div>
                <div className="text-2xl font-bold text-gray-900">{report.totalExpectedPlatformDays}</div>
                <div className="text-xs text-gray-500">Expected days</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">{report.totalVerifiedPlatformDays}</div>
                <div className="text-xs text-gray-500">Verified</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{report.totalMissingPlatformDays}</div>
                <div className="text-xs text-gray-500">Missing</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-600">{report.totalUnknownPlatformDays}</div>
                <div className="text-xs text-gray-500">Unknown</div>
              </div>
            </div>

            {report.hasVerificationIssues && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <AlertCircle size={12} className="inline mr-1" />
                Some days could not be verified due to API or connection issues. Final completion rate may differ from actual activity.
              </div>
            )}
          </div>

          {/* Per-platform scorecards */}
          <div className="space-y-4">
            {report.platforms.map((p) => {
              const badge = BADGE_CONFIG[p.badge as keyof typeof BADGE_CONFIG] ?? BADGE_CONFIG.BELOW_TARGET;
              const BadgeIcon = badge.icon;

              return (
                <div key={p.platform} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-semibold text-gray-900">{p.platformLabel}</h3>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${badge.color}`}
                      >
                        <BadgeIcon size={11} />
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-xl font-bold text-gray-900">
                      {formatPercent(p.completionRate)}
                    </div>
                  </div>

                  <div className="px-6 py-4 grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-gray-500 text-xs mb-0.5">Expected</div>
                      <div className="font-semibold">{p.expectedDays} days</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs mb-0.5">Verified</div>
                      <div className="font-semibold text-green-700">{p.verifiedDays} days</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs mb-0.5">Missing</div>
                      <div className="font-semibold text-red-700">{p.missingDays} days</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs mb-0.5">Followers</div>
                      <div className="font-semibold text-gray-700">
                        {p.followerStart !== null && p.followerEnd !== null ? (
                          <>
                            {p.followerEnd.toLocaleString()}
                            <span className={`ml-1 text-xs ${(p.followerGrowth ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                              ({(p.followerGrowth ?? 0) >= 0 ? "+" : ""}{p.followerGrowth?.toLocaleString()})
                            </span>
                          </>
                        ) : (
                          <span className="text-gray-400">N/A</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {p.missingDates.length > 0 && (
                    <div className="px-6 pb-4">
                      <div className="text-xs text-gray-500 mb-2">Missing dates:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.missingDates.map((d) => (
                          <span key={d} className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs font-mono">
                            {d}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {p.verifiedLinks.length > 0 && (
                    <div className="px-6 pb-4 border-t border-gray-50 pt-3">
                      <div className="text-xs text-gray-500 mb-2">Verified posts:</div>
                      <div className="space-y-1">
                        {p.verifiedLinks.slice(0, 5).map((link) => (
                          <div key={link.date} className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-gray-500">{link.date}</span>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline truncate max-w-sm"
                            >
                              {link.url}
                            </a>
                          </div>
                        ))}
                        {p.verifiedLinks.length > 5 && (
                          <div className="text-xs text-gray-400">
                            +{p.verifiedLinks.length - 5} more — export CSV for full list
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-xs text-gray-400 text-right">
            Report generated at {new Date(report.generatedAt).toLocaleString("en-US")}
          </div>
        </div>
      )}
    </div>
  );
}

export const runtime = 'edge';
import { Header } from "@/components/layout/header";
import prisma from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  CLIENT_CREATED: "Client Created",
  CLIENT_UPDATED: "Client Updated",
  CLIENT_ARCHIVED: "Client Archived",
  CLIENT_RESTORED: "Client Restored",
  PLATFORM_CONNECTED: "Platform Connected",
  PLATFORM_DISCONNECTED: "Platform Disconnected",
  PLATFORM_REQUIREMENT_CHANGED: "Platform Requirement Changed",
  POSTING_CALENDAR_CHANGED: "Posting Calendar Changed",
  MANUAL_SYNC_TRIGGERED: "Manual Sync",
  BACKFILL_TRIGGERED: "Backfill Triggered",
  REPORT_EXPORTED: "Report Exported",
  USER_CREATED: "User Created",
  USER_UPDATED: "User Updated",
};

export default async function LogsPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  const syncJobs = await prisma.syncJob.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
    include: {
      triggeredBy: { select: { name: true } },
      client: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-8">
      <Header title="Audit Logs" subtitle="System activity and admin action history" />

      {/* Sync jobs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Recent Sync Jobs</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-6 py-3 font-medium text-gray-500">Job Type</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Client</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Results</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Triggered By</th>
              <th className="text-left px-6 py-3 font-medium text-gray-500">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {syncJobs.map((job) => (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-xs font-mono text-gray-700">{job.jobType}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{job.client?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      job.status === "COMPLETED"
                        ? "bg-green-50 text-green-700"
                        : job.status === "FAILED"
                          ? "bg-red-50 text-red-700"
                          : job.status === "PARTIAL"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-gray-50 text-gray-500"
                    }`}
                  >
                    {job.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {job.itemsSucceeded}/{job.itemsProcessed}
                  {job.itemsFailed > 0 && (
                    <span className="ml-1 text-red-600">({job.itemsFailed} failed)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{job.triggeredBy?.name ?? "System"}</td>
                <td className="px-6 py-3 text-xs text-gray-400">{formatDateTime(job.startedAt)}</td>
              </tr>
            ))}
            {syncJobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-400 text-sm">
                  No sync jobs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Audit log */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Admin Audit Log</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-6 py-3 font-medium text-gray-500">Timestamp</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">User</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Action</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Entity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-xs text-gray-400 font-mono">
                  {formatDateTime(log.createdAt)}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {log.user?.name ?? "System"}
                </td>
                <td className="px-4 py-3 text-xs font-medium text-gray-700">
                  {ACTION_LABELS[log.actionType] ?? log.actionType}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {log.entityType} <span className="font-mono text-gray-400">{log.entityId.slice(0, 8)}…</span>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-400 text-sm">
                  No audit log entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

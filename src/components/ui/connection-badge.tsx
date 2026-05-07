import { cn } from "@/lib/utils";
import { CheckCircle2, AlertCircle, Clock, XCircle, Wifi } from "lucide-react";

const CONNECTION_CONFIG = {
  CONNECTED: { label: "Connected", icon: CheckCircle2, text: "text-green-700", bg: "bg-green-50" },
  PENDING: { label: "Pending", icon: Clock, text: "text-amber-700", bg: "bg-amber-50" },
  EXPIRED: { label: "Token Expired", icon: AlertCircle, text: "text-red-700", bg: "bg-red-50" },
  ERROR: { label: "Error", icon: XCircle, text: "text-red-700", bg: "bg-red-50" },
  DISCONNECTED: { label: "Disconnected", icon: Wifi, text: "text-gray-500", bg: "bg-gray-50" },
};

interface ConnectionBadgeProps {
  status: string;
  /**
   * If a connection's stored status is CONNECTED but lastSyncError is non-null,
   * the stored status is stale — the API rejected our last call. Treat it as
   * EXPIRED in the badge so the user sees a red warning + reconnect CTA, not
   * a green 'Connected' lie.
   */
  lastSyncError?: string | null;
  className?: string;
}

export function ConnectionBadge({ status, lastSyncError, className }: ConnectionBadgeProps) {
  // Override CONNECTED → EXPIRED when there's a real error on file.
  const effective = status === "CONNECTED" && lastSyncError ? "EXPIRED" : status;
  const config = CONNECTION_CONFIG[effective as keyof typeof CONNECTION_CONFIG] ?? CONNECTION_CONFIG.DISCONNECTED;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        config.text,
        config.bg,
        className
      )}
    >
      <Icon size={11} />
      {config.label}
    </span>
  );
}

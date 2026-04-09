import { cn } from "@/lib/utils";

const STATUS_CONFIG = {
  GREEN: { label: "Verified", dot: "bg-green-500", text: "text-green-700", bg: "bg-green-50", border: "border-green-200" },
  RED: { label: "Missing", dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
  YELLOW: { label: "Unknown", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  GRAY: { label: "N/A", dot: "bg-gray-400", text: "text-gray-500", bg: "bg-gray-50", border: "border-gray-200" },
};

interface StatusBadgeProps {
  status: string;
  compact?: boolean;
  className?: string;
}

export function StatusBadge({ status, compact = false, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.GRAY;

  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center w-6 h-6 rounded-full",
          config.bg,
          className
        )}
        title={config.label}
      >
        <span className={cn("w-2.5 h-2.5 rounded-full", config.dot)} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border",
        config.text,
        config.bg,
        config.border,
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", config.dot)} />
      {config.label}
    </span>
  );
}

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business Profile",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  THREADS: "Threads",
  PINTEREST: "Pinterest",
  MEDIUM: "Medium",
  REDDIT: "Reddit",
  BLOG_RSS: "Blog / RSS",
  OTHER: "Other",
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function statusColor(status: string): string {
  switch (status) {
    case "GREEN": return "text-green-700 bg-green-50 border-green-200";
    case "RED": return "text-red-700 bg-red-50 border-red-200";
    case "YELLOW": return "text-amber-700 bg-amber-50 border-amber-200";
    case "GRAY": return "text-gray-500 bg-gray-50 border-gray-200";
    default: return "text-gray-500 bg-gray-50 border-gray-200";
  }
}

export function statusDot(status: string): string {
  switch (status) {
    case "GREEN": return "bg-green-500";
    case "RED": return "bg-red-500";
    case "YELLOW": return "bg-amber-500";
    default: return "bg-gray-400";
  }
}

export function connectionStatusColor(status: string): string {
  switch (status) {
    case "CONNECTED": return "text-green-700 bg-green-50";
    case "EXPIRED": return "text-red-700 bg-red-50";
    case "ERROR": return "text-red-700 bg-red-50";
    case "DISCONNECTED": return "text-gray-500 bg-gray-50";
    case "PENDING": return "text-amber-700 bg-amber-50";
    default: return "text-gray-500 bg-gray-50";
  }
}

export function freshnessFromLastSync(lastSyncAt: string | null): {
  label: string;
  color: string;
} {
  if (!lastSyncAt) return { label: "Never synced", color: "text-gray-400" };
  const diff = Date.now() - new Date(lastSyncAt).getTime();
  const hours = diff / 3600000;
  if (hours < 2) return { label: "Live", color: "text-green-600" };
  if (hours < 6) return { label: "Delayed", color: "text-amber-600" };
  if (hours < 25) return { label: "Stale", color: "text-orange-600" };
  return { label: "Sync Error", color: "text-red-600" };
}

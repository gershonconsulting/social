// Re-export Prisma enums for use throughout the app
export {
  UserRole,
  ClientStatus,
  Platform,
  ConnectionStatus,
  PostingMode,
  ComplianceStatus,
  SyncStatus,
  SyncJobType,
  SyncScopeType,
  AuditAction,
} from "@prisma/client";

export type { User, Client, PlatformConnection, PostingSchedule, SocialPost, DailyCompliance, FollowerSnapshot, SyncJob, AuditLog } from "@prisma/client";

// ─── Platform display metadata ────────────────────────────────────────────────

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

export const PLATFORM_COLORS: Record<string, string> = {
  LINKEDIN: "#0A66C2",
  TWITTER: "#000000",
  GOOGLE_BUSINESS: "#4285F4",
  FACEBOOK: "#1877F2",
  INSTAGRAM: "#E1306C",
  TIKTOK: "#010101",
  THREADS: "#000000",
  PINTEREST: "#E60023",
  MEDIUM: "#12100E",
  REDDIT: "#FF4500",
  BLOG_RSS: "#F26522",
  OTHER: "#6B7280",
};

// ─── Compliance status display ─────────────────────────────────────────────────

export const STATUS_COLORS: Record<string, string> = {
  GREEN: "#16a34a",
  RED: "#dc2626",
  YELLOW: "#d97706",
  GRAY: "#6b7280",
};

export const STATUS_LABELS: Record<string, string> = {
  GREEN: "Verified",
  RED: "Missing",
  YELLOW: "Unknown",
  GRAY: "Not Expected",
};

// ─── API response types ────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Dashboard types ──────────────────────────────────────────────────────────

export interface DashboardSummary {
  totalActiveClients: number;
  clientsMissingPostsToday: number;
  clientsWithConnectionErrors: number;
  clientsFullyCompliantToday: number;
  totalPostsDetectedToday: number;
  totalUnknownVerificationsToday: number;
  lastUpdated: string;
}

export interface ClientDashboardRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  todayOverallStatus: string;
  linkedinStatus: string | null;
  twitterStatus: string | null;
  googleBusinessStatus: string | null;
  optionalPlatformSummary: string;
  lastSyncAt: string | null;
  connectionIssueCount: number;
}

// ─── Monthly report types ─────────────────────────────────────────────────────

export interface PlatformMonthlyReport {
  platform: string;
  platformLabel: string;
  expectedDays: number;
  verifiedDays: number;
  missingDays: number;
  unknownDays: number;
  completionRate: number;
  missingDates: string[];
  verifiedLinks: { date: string; url: string }[];
  followerStart: number | null;
  followerEnd: number | null;
  followerGrowth: number | null;
  connectionIssues: string[];
  badge: "100_PCT" | "BELOW_TARGET" | "INCOMPLETE_VERIFICATION";
}

export interface ClientMonthlyReport {
  clientId: string;
  clientName: string;
  month: string; // YYYY-MM
  totalExpectedPlatformDays: number;
  totalVerifiedPlatformDays: number;
  totalMissingPlatformDays: number;
  totalUnknownPlatformDays: number;
  overallCompletionRate: number;
  platforms: PlatformMonthlyReport[];
  generatedAt: string;
  hasVerificationIssues: boolean;
}

// ─── Sync / Adapter types ─────────────────────────────────────────────────────

export interface NormalizedPost {
  externalPostId: string;
  postUrl: string | null;
  postTextSnippet: string | null;
  hasMedia: boolean;
  publishedAtUtc: Date;
  publishedAtLocal: Date;
  publishedDateLocal: string;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  rawPayload: Record<string, unknown>;
}

export interface AdapterFetchResult {
  posts: NormalizedPost[];
  followerCount: number | null;
  error: string | null;
  errorCode: string | null;
  isRetryable: boolean;
}

export interface AdapterConfig {
  platform: string;
  clientId: string;
  connectionId: string;
  externalAccountId: string;
  tokenReference: string | null;
  timezone: string;
}

// ─── Connection health indicator ──────────────────────────────────────────────

export type DataFreshness = "LIVE" | "DELAYED" | "STALE" | "SYNC_ERROR";

export interface FreshnessIndicator {
  status: DataFreshness;
  label: string;
  lastUpdated: string | null;
  description: string;
}


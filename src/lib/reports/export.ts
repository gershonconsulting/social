/**
 * Export helpers for CSV and PDF generation.
 */

import { ClientMonthlyReport } from "@/types";

// ─── CSV Export ───────────────────────────────────────────────────────────────

/**
 * Convert a monthly report to CSV format (platform-level summary).
 */
export function reportToCSV(report: ClientMonthlyReport): string {
  const headers = [
    "Client",
    "Month",
    "Platform",
    "Expected Days",
    "Verified Days",
    "Missing Days",
    "Unknown Days",
    "Completion Rate %",
    "Follower Start",
    "Follower End",
    "Follower Growth",
    "Badge",
  ];

  const rows = report.platforms.map((p) => [
    csvEscape(report.clientName),
    report.month,
    csvEscape(p.platformLabel),
    p.expectedDays,
    p.verifiedDays,
    p.missingDays,
    p.unknownDays,
    (p.completionRate * 100).toFixed(1),
    p.followerStart ?? "N/A",
    p.followerEnd ?? "N/A",
    p.followerGrowth ?? "N/A",
    p.badge,
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

/**
 * Convert post history data to CSV.
 */
export function postsToCSV(
  posts: {
    date: string;
    platform: string;
    url: string | null;
    snippet: string | null;
    publishedAt: string;
  }[]
): string {
  const headers = ["Date", "Platform", "Post URL", "Text Snippet", "Published At"];
  const rows = posts.map((p) => [
    p.date,
    p.platform,
    csvEscape(p.url ?? ""),
    csvEscape(p.snippet ?? ""),
    p.publishedAt,
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

/**
 * Generate PDF report data structure for client-side rendering.
 * Actual PDF rendering happens in the browser using jsPDF.
 * This function returns the structured data for the PDF template.
 */
export function buildPDFReportData(report: ClientMonthlyReport): {
  title: string;
  subtitle: string;
  generatedAt: string;
  executiveSummary: {
    overallRate: string;
    badge: string;
    totalExpected: number;
    totalVerified: number;
    totalMissing: number;
    totalUnknown: number;
    hasIssues: boolean;
  };
  platforms: {
    name: string;
    rate: string;
    badge: string;
    expectedDays: number;
    verifiedDays: number;
    missingDays: number;
    unknownDays: number;
    missingDates: string[];
    verifiedLinks: { date: string; url: string }[];
    followerSummary: string;
  }[];
  caveats: string[];
} {
  const caveats: string[] = [];
  if (report.hasVerificationIssues) {
    caveats.push(
      "Some days could not be verified due to platform API issues or connection errors. " +
        "Final completion rate may differ from actual posting activity."
    );
  }

  for (const p of report.platforms) {
    if (p.connectionIssues.length > 0) {
      caveats.push(`${p.platformLabel}: ${p.connectionIssues.join("; ")}`);
    }
    if (!p.followerStart && !p.followerEnd) {
      caveats.push(`${p.platformLabel}: Follower history not available for this period.`);
    }
  }

  const overallBadge =
    report.totalUnknownPlatformDays > 0
      ? "INCOMPLETE VERIFICATION"
      : report.overallCompletionRate >= 1.0
        ? "100% OBJECTIVE MET"
        : "OBJECTIVE NOT MET";

  return {
    title: `${report.clientName} — Monthly Compliance Report`,
    subtitle: formatMonth(report.month),
    generatedAt: new Date(report.generatedAt).toLocaleString("en-US", {
      timeZone: "America/New_York",
    }),
    executiveSummary: {
      overallRate: `${(report.overallCompletionRate * 100).toFixed(1)}%`,
      badge: overallBadge,
      totalExpected: report.totalExpectedPlatformDays,
      totalVerified: report.totalVerifiedPlatformDays,
      totalMissing: report.totalMissingPlatformDays,
      totalUnknown: report.totalUnknownPlatformDays,
      hasIssues: report.hasVerificationIssues,
    },
    platforms: report.platforms.map((p) => ({
      name: p.platformLabel,
      rate: `${(p.completionRate * 100).toFixed(1)}%`,
      badge:
        p.badge === "100_PCT"
          ? "100% OBJECTIVE MET"
          : p.badge === "BELOW_TARGET"
            ? "OBJECTIVE NOT MET"
            : "INCOMPLETE VERIFICATION",
      expectedDays: p.expectedDays,
      verifiedDays: p.verifiedDays,
      missingDays: p.missingDays,
      unknownDays: p.unknownDays,
      missingDates: p.missingDates,
      verifiedLinks: p.verifiedLinks,
      followerSummary:
        p.followerStart !== null && p.followerEnd !== null
          ? `${p.followerStart.toLocaleString()} → ${p.followerEnd.toLocaleString()} (${p.followerGrowth! >= 0 ? "+" : ""}${p.followerGrowth!.toLocaleString()})`
          : "Not available",
    })),
    caveats,
  };
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

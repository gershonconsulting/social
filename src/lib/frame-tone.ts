/**
 * Client status frame — Green / Orange / Red (Olivier, 2026-10-27).
 *
 * One rule shared by Social, Social Tracking and Publish (same file in all
 * three repos): the frame around a client shows how far along it is.
 *   GREEN  — 100% or more (target met)
 *   ORANGE — 50% to 99%  ("50% is the line")
 *   RED    — under 50%
 *   GREY   — nothing to measure yet
 * Each platform feeds its own ratio:
 *   Social Tracking — verified posting days / days due (posting objective)
 *   Publish         — validated posts / posts scheduled in the next 14 days
 *   Social          — company's networks collected recently / networks tracked
 */
export type FrameTone = "green" | "orange" | "red" | "none";

export const FRAME_LINE = 0.5;

export function frameTone(ratio: number | null | undefined): FrameTone {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "none";
  if (ratio >= 1) return "green";
  if (ratio >= FRAME_LINE) return "orange";
  return "red";
}

export const FRAME_STYLE: Record<FrameTone, { border: string; bg: string; text: string; label: string }> = {
  green: { border: "#16A34A", bg: "#F0FDF4", text: "#166534", label: "On target" },
  orange: { border: "#F97316", bg: "#FFF7ED", text: "#9A3412", label: "Below target" },
  red: { border: "#DC2626", bg: "#FEF2F2", text: "#991B1B", label: "Under 50%" },
  none: { border: "#D1D5DB", bg: "#F9FAFB", text: "#6B7280", label: "Nothing to measure" },
};

export const pctLabel = (r: number | null | undefined) =>
  r === null || r === undefined || Number.isNaN(r) ? "—" : `${Math.round(r * 100)}%`;

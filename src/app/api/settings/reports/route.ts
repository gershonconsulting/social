export const runtime = "edge";
/**
 * Settings → Reports (v4.71.0).
 *
 * GET → every report / alert the app emails: what it is, when it runs,
 *       who receives it today and how often (saved value or current default).
 * PUT → { reports: { "<id>": { to?: string[] | "a@b, c@d", frequency?: Frequency } } }
 *       { reset: "<id>" } puts one report back on its defaults.
 *
 * Gershon's own workspace admins only — these are Gershon's internal reports.
 * Stored in the global Setting `report_settings` (see lib/reports/settings.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import prisma from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { primaryOrgId } from "@/lib/reports/monthly/data";
import {
  REPORT_CATALOG, FREQUENCY_LABEL, REPORT_SETTINGS_KEY, allowedFrequencies, envFallback,
  readReportSettings, reportConfig, saveReportSettings,
} from "@/lib/reports/settings";

async function guard(): Promise<NextResponse | null> {
  try {
    const actor = await requireRole(UserRole.ADMIN);
    if ((actor as { organizationId?: string | null }).organizationId !== (await primaryOrgId())) {
      return NextResponse.json({ success: false, error: "Gershon workspace admins only" }, { status: 403 });
    }
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    return NextResponse.json({ success: false, error: "Admins only" }, { status: 403 });
  }
}

async function payload() {
  const reports = [];
  for (const def of REPORT_CATALOG) {
    const cfg = await reportConfig(def.id);
    reports.push({
      ...def,
      to: cfg.to,
      frequency: cfg.frequency,
      custom: cfg.custom,
      defaultRecipients: envFallback(def.id),
      frequencies: allowedFrequencies(def).map((f) => ({ value: f, label: FREQUENCY_LABEL[f] })),
    });
  }
  return { count: reports.filter((r) => r.group !== "Alerts").length, alerts: reports.filter((r) => r.group === "Alerts").length, reports };
}

export async function GET() {
  const g = await guard();
  if (g) return g;
  try {
    return NextResponse.json({ success: true, data: await payload() });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const g = await guard();
  if (g) return g;
  try {
    const body = (await req.json().catch(() => ({}))) as { reports?: Record<string, { to?: unknown; frequency?: unknown }>; reset?: string };
    if (body.reset) {
      const cur = await readReportSettings();
      delete cur[body.reset];
      const value = JSON.stringify(cur);
      await prisma.setting.upsert({ where: { key: REPORT_SETTINGS_KEY }, update: { value }, create: { key: REPORT_SETTINGS_KEY, value } });
    }
    if (body.reports) await saveReportSettings(body.reports);
    return NextResponse.json({ success: true, data: await payload() });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}

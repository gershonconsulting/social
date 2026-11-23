/**
 * Report bundling switch (v4.82.0). ON by default.
 * Setting `report_bundling` = "off" restores the separate emails (pre-4.81 behaviour).
 */
import prisma from "@/lib/db";

export const BUNDLE_KEY = "report_bundling";

export async function bundlingOn(): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: BUNDLE_KEY } });
    return (row?.value || "").trim().toLowerCase() !== "off";
  } catch {
    return true;
  }
}

/**
 * Should this workspace be shown the getting-started page instead of a page of
 * zeroes?
 *
 * Only in the one state where the dashboard genuinely has nothing to say: no
 * companies at all. Past that first company every chart has something in it, and
 * sending somebody who is mid-setup back to a checklist they have already seen
 * would be worse than useless.
 *
 * Dismissible, and the dismissal is per workspace rather than per browser — the
 * person who turns it off is speaking for the workspace, and the next person to
 * sign in should not be greeted by a checklist that was already dealt with.
 *
 * Never throws. A failure here must not be able to take the dashboard down, so
 * it answers "no" and the dashboard renders as it always did.
 */
import prisma from "@/lib/db";
import rawPrisma from "@/lib/db-raw";
import { getCurrentOrgId } from "@/lib/scoped-db";

const DISMISS_KEY = "onboarding_dismissed";

export async function shouldShowOnboarding(): Promise<boolean> {
  try {
    const orgId = await getCurrentOrgId();
    if (!orgId) return false;

    const companies = await prisma.client.count({ where: { status: { not: "ARCHIVED" } } });
    if (companies > 0) return false;

    const dismissed = await rawPrisma.orgSetting.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: DISMISS_KEY } },
      select: { id: true },
    });
    return !dismissed;
  } catch {
    return false;
  }
}

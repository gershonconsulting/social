/**
 * How LinkedIn self-registration behaves.
 *
 * Sign-in is open: anyone with a LinkedIn account can come through
 * /api/auth/linkedin/login and end up as a user here. What that new user can
 * actually DO is the question this setting answers.
 *
 *   "approval" (default) — they land pending. They can't read anything until an
 *                          admin approves them in Admin > Users. This is the
 *                          safe default: this app holds client data, and an
 *                          open door plus instant read access is the same thing
 *                          as publishing it.
 *   "open"              — they're active the moment they sign up, at the
 *                          lowest role. Nobody has to let them in.
 *
 * Either way a self-registered user gets READ_ONLY. Roles are only ever raised
 * by an admin, never by signing up.
 */
import prisma from "@/lib/db";

export type RegistrationMode = "approval" | "open";

const SETTING_KEY = "registration";
// v4.32.0 — Olivier 2026-10-05: open to everyone until further notice.
// Safe since v4.4.0: a signup gets its own empty workspace, never Gershon's data.
const DEFAULT_MODE: RegistrationMode = "open";

export async function getRegistrationMode(): Promise<RegistrationMode> {
  try {
    // One-shot v4.32.0 opening (same marker as linkedin-login-flow.ts), so the
    // Admin > Users toggle shows "open" even before the next signup.
    const opened = await prisma.setting.findUnique({ where: { key: "registration_opened_v4_32" } });
    if (!opened) {
      await setRegistrationMode("open");
      await prisma.setting.upsert({
        where: { key: "registration_opened_v4_32" },
        create: { key: "registration_opened_v4_32", value: JSON.stringify({ at: new Date().toISOString() }) },
        update: {},
      });
    }
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return DEFAULT_MODE;
    const parsed = JSON.parse(row.value) as { mode?: string };
    return parsed.mode === "approval" ? "approval" : "open";
  } catch {
    // A broken read must never mean "let everyone in".
    return "approval";
  }
}

export async function setRegistrationMode(mode: RegistrationMode): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify({ mode }) },
    update: { value: JSON.stringify({ mode }) },
  });
}

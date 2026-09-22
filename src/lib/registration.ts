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
const DEFAULT_MODE: RegistrationMode = "approval";

export async function getRegistrationMode(): Promise<RegistrationMode> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return DEFAULT_MODE;
    const parsed = JSON.parse(row.value) as { mode?: string };
    return parsed.mode === "open" ? "open" : "approval";
  } catch {
    // Unreadable or malformed setting must never mean "let everyone in".
    return DEFAULT_MODE;
  }
}

export async function setRegistrationMode(mode: RegistrationMode): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify({ mode }) },
    update: { value: JSON.stringify({ mode }) },
  });
}

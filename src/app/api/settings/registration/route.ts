export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { getRegistrationMode, setRegistrationMode } from "@/lib/registration";

const schema = z.object({ mode: z.enum(["approval", "open"]) });

function authErr(e: unknown): NextResponse | null {
  const m = e instanceof Error ? e.message : "";
  if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "Admins only" }, { status: 403 });
  return null;
}

export async function GET() {
  try {
    await requireRole(UserRole.ADMIN);
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Auth error" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { mode: await getRegistrationMode() } });
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(UserRole.ADMIN);
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Auth error" }, { status: 500 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'mode must be "approval" or "open".' },
      { status: 400 },
    );
  }

  await setRegistrationMode(parsed.data.mode);
  return NextResponse.json({ success: true, data: { mode: parsed.data.mode } });
}

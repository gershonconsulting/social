export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { z } from "zod";

const twitterSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = twitterSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Username and password are required" },
      { status: 400 }
    );
  }

  const { username, password } = parsed.data;

  // Store credentials as a JSON token reference on all Twitter platform connections
  // For security, in production this should use encrypted storage
  const tokenRef = JSON.stringify({ username, password });

  // Update all Twitter connections to CONNECTED with credentials
  const twitterConnections = await prisma.platformConnection.findMany({
    where: { platform: "TWITTER" },
  });

  if (twitterConnections.length === 0) {
    return NextResponse.json(
      { success: false, error: "No Twitter platform connections found. Add a client with Twitter first." },
      { status: 404 }
    );
  }

  for (const conn of twitterConnections) {
    await prisma.platformConnection.update({
      where: { id: conn.id },
      data: {
        tokenReference: tokenRef,
        connectionStatus: "CONNECTED",
        externalAccountName: username,
      },
    });
  }

  return NextResponse.json({
    success: true,
    message: `Twitter credentials saved for ${twitterConnections.length} connection(s)`,
  });
}

export const runtime = "edge";

export async function GET() {
  return new Response(JSON.stringify({
    hasSecret: !!process.env.NEXTAUTH_SECRET,
    hasUrl: !!process.env.NEXTAUTH_URL,
    hasDb: !!process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
  }), { headers: { "content-type": "application/json" } });
}

export const runtime = "edge";

export async function GET(req: Request) {
  try {
    // Try importing next-auth components one by one
    const results: Record<string, string> = {};
    
    try {
      const { getToken } = await import("next-auth/jwt");
      results.jwt = "ok";
    } catch (e: any) {
      results.jwt = e.message;
    }
    
    try {
      const mod = await import("@/app/api/auth/[...nextauth]/options");
      results.options = mod.authOptions ? "ok" : "missing";
    } catch (e: any) {
      results.options = e.message?.substring(0, 200);
    }
    
    try {
      const { default: prisma } = await import("@/lib/db");
      const count = await prisma.user.count();
      results.db = `ok (${count} users)`;
    } catch (e: any) {
      results.db = e.message?.substring(0, 200);
    }

    return new Response(JSON.stringify(results, null, 2), { 
      headers: { "content-type": "application/json" } 
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500,
      headers: { "content-type": "application/json" } 
    });
  }
}

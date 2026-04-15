export const runtime = "edge";

export async function GET(req: Request) {
  try {
    const NextAuth = (await import("next-auth")).default;
    const { authOptions } = await import("@/app/api/auth/[...nextauth]/options");
    
    // Try to create the handler
    const handler = NextAuth(authOptions);
    
    // Try to call it
    const response = await handler(req, { params: { nextauth: ["csrf"] } });
    return response;
  } catch (e: any) {
    return new Response(JSON.stringify({ 
      error: e.message,
      stack: e.stack?.substring(0, 500),
      name: e.name
    }, null, 2), { 
      status: 500,
      headers: { "content-type": "application/json" } 
    });
  }
}

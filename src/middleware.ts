// Polyfill crypto.randomBytes for Cloudflare Workers edge runtime
const _gm = globalThis as any;
if (typeof _gm.crypto !== "undefined" && !_gm.crypto.randomBytes) {
  _gm.crypto.randomBytes = (size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return bytes as any;
  };
}

import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(_req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/clients/:path*",
    "/reports/:path*",
    "/followers/:path*",
    "/admin/:path*",
    "/logs/:path*",
    "/api/clients/:path*",
    "/api/platforms/:path*",
    "/api/compliance/:path*",
    "/api/reports/:path*",
    "/api/followers/:path*",
    "/api/sync/:path*",
    "/api/jobs/:path*",
    "/api/users/:path*",
    "/api/audit/:path*",
    "/api/dashboard/:path*",
  ],
};

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

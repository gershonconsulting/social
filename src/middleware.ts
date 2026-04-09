export { default } from "next-auth/middleware";

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
  ],
};

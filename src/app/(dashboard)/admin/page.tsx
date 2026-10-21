export const runtime = 'edge';
import { Suspense } from 'react';
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import AdminPage from './page-client';

export default async function Page() {
  // v4.59.0 audit: role gate (same pattern as admin/users) — only ADMIN / OPERATIONS.
  const session = await getSession();
  const role = session?.user?.role as UserRole | undefined;
  if (!session?.user) redirect("/login");
  if (role !== UserRole.ADMIN && role !== UserRole.OPERATIONS) redirect("/dashboard");
  // v4.59.0 audit: page-client reads useSearchParams, which Next requires inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <AdminPage />
    </Suspense>
  );
}

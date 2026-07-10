export const runtime = 'edge';
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import UsersAdminClient from "./page-client";

export default async function UsersAdminPage() {
  const session = await getSession();
  const role = session?.user?.role as UserRole | undefined;
  if (!session?.user) redirect("/login");
  if (role !== UserRole.ADMIN) redirect("/dashboard");
  return <UsersAdminClient />;
}

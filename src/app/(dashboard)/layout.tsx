export const runtime = 'edge';
import { Sidebar } from "@/components/layout/sidebar";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

const APP_VERSION = "2.0.0";
const BUILD_DATE = "2026-04-15T02:50:00Z";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {children}
          <div className="text-center text-[10px] text-gray-300 mt-12 pb-4">
            v{APP_VERSION} &middot; {BUILD_DATE.replace("T", " ").replace(":00Z", " UTC")}
          </div>
        </div>
      </main>
    </div>
  );
}

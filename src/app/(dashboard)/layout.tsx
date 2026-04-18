export const runtime = 'edge';
import { Sidebar } from "@/components/layout/sidebar";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE || new Date().toISOString();

function formatBuildDate(raw: string): string {
  try {
    const d = new Date(raw);
    return d.toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZoneName: "short",
    });
  } catch {
    return raw.replace("T", " ").replace(/:\d{2}Z$/, " UTC").replace(/\+.*$/, "");
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const shortVersion = APP_VERSION.length > 8 ? APP_VERSION.slice(0, 7) : APP_VERSION;
  const buildDate = formatBuildDate(BUILD_DATE);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-[11px] text-gray-400 mb-4 font-mono">
            v{shortVersion} &middot; {buildDate}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

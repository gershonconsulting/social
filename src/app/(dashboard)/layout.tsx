export const runtime = 'edge';
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE || new Date().toISOString();
const BUILD_NUMBER = process.env.NEXT_PUBLIC_BUILD_NUMBER || "";

function formatBuildDate(raw: string): string {
  try {
    const d = new Date(raw);
    return d.toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZone: "America/New_York",
      timeZoneName: "short",
    });
  } catch {
    return raw.replace("T", " ").replace(/:\\d{2}Z$/, " UTC").replace(/\\+.*$/, "");
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Multi-user: require a signed-in session for the whole dashboard.
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }

  const shortVersion = APP_VERSION.length > 8 ? APP_VERSION.slice(0, 7) : APP_VERSION;
  const buildDate = formatBuildDate(BUILD_DATE);
  const buildLabel = BUILD_NUMBER ? `Build #${BUILD_NUMBER}` : "";

  return (
    <div className="flex h-screen overflow-hidden bg-[#fafafa]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-[11px] text-gray-400 mb-4 font-mono">
            {buildLabel && <>{buildLabel} &middot; </>}v{shortVersion} &middot; {buildDate}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

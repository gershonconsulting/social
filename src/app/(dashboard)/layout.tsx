export const runtime = 'edge';
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { ViewFiltersProvider } from "@/lib/view-filters";
import { ExtensionSeenReporter } from "@/components/layout/extension-seen-reporter";
import { ensureTenancy } from "@/lib/tenancy";

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

  // One-time, idempotent: create the primary organization and adopt every
  // pre-tenancy row into it. Free after the first successful run, and it
  // swallows its own errors so it can never take the dashboard down.
  await ensureTenancy();

  const shortVersion = APP_VERSION.length > 8 ? APP_VERSION.slice(0, 7) : APP_VERSION;
  const buildDate = formatBuildDate(BUILD_DATE);
  const buildLabel = BUILD_NUMBER ? `Build #${BUILD_NUMBER}` : "";

  return (
    // One filter state shared by the sidebar controls and the page content.
    <ViewFiltersProvider>
      {/* Invisible: reports the installed Chrome-extension version to the
          server so the daily progress report can warn about a stale build. */}
      <ExtensionSeenReporter />
      <div className="flex h-screen overflow-hidden bg-[#F5F4F0]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto px-9 pt-7 pb-10">
            {children}
            <footer className="mt-12 pt-4 border-t border-gray-200 text-[11px] text-gray-500 font-mono">
              {buildLabel && <>{buildLabel} &middot; </>}v{shortVersion} &middot; {buildDate}
            </footer>
          </div>
        </main>
      </div>
    </ViewFiltersProvider>
  );
}

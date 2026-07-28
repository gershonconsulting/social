"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  BarChart3,
  Building2,
  LayoutDashboard,
  LayoutList,
  Settings,
  Shield,
  LogOut,
  ScrollText,
  AlertOctagon,
  Network,
  PlayCircle,
  StopCircle,
} from "lucide-react";
import { useDemoMode, setDemoMode } from "@/lib/use-demo-mode";
import { cn } from "@/lib/utils";

const navItems = [
  // Menu aligned with the other platform dashboards:
  // Dashboard (dynamic insights + charts) → Summary (company-by-company view)
  // → Companies → Networks → Analytics → Logs → Errors → Admin → Settings.
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/summary", icon: LayoutList, label: "Summary" },
  {
    href: "/clients",
    icon: Building2,
    label: "Companies",
    children: [{ href: "/clients/by-cloudcampaign", label: "By Cloud Campaign" }, { href: "/clients/by-heropost", label: "By HeroPost" }],
  },
  { href: "/networks", icon: Network, label: "Networks" },
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/logs", icon: ScrollText, label: "Logs" },
  { href: "/errors", icon: AlertOctagon, label: "Errors" },
  { href: "/admin", icon: Shield, label: "Admin", children: [{ href: "/admin/users", label: "Users" }] },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-[#FE1B04] flex-shrink-0" />
          <div>
            <div className="text-sm font-semibold text-gray-900 leading-tight">social.gershonCRM</div>
            <div className="text-[11px] text-gray-400 leading-tight">Campaign Compliance</div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const children = "children" in item ? item.children : undefined;
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-red-50 text-[#FE1B04]"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon className="flex-shrink-0" size={18} />
                {item.label}
              </Link>
              {children && isActive && (
                <div className="mt-0.5 mb-1 ml-7 pl-3 border-l border-gray-200 space-y-0.5">
                  {children.map((sub) => {
                    const subActive = pathname === sub.href || pathname.startsWith(sub.href + "/");
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        className={cn(
                          "block px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors",
                          subActive
                            ? "bg-red-50 text-[#FE1B04]"
                            : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                        )}
                      >
                        {sub.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 border-t border-gray-100">
        <div className="px-3 py-2 mb-1">
          <div className="text-sm font-medium text-gray-900 truncate">{session?.user?.name}</div>
          <div className="text-xs text-gray-400 truncate">{session?.user?.email}</div>
          <span className="inline-block mt-1 text-[10px] font-medium text-[#FE1B04] bg-red-50 px-1.5 py-0.5 rounded capitalize">
            {(session?.user as { role?: string })?.role?.toLowerCase() ?? "user"}
          </span>
        </div>
        <DemoToggleButton />
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}


function DemoToggleButton() {
  const demoOn = useDemoMode();
  return (
    <button
      onClick={() => {
        setDemoMode(!demoOn);
        // Force a hard reload so page data refetches with the new flag.
        setTimeout(() => { window.location.reload(); }, 80);
      }}
      title={demoOn ? "Currently showing FAKE demo data. Click to switch back to real." : "Switch to fake demo data — every chart full, every number inflated."}
      className={
        "w-full flex items-center gap-3 px-3 py-2 mb-1 rounded-lg text-sm font-medium transition-colors " +
        (demoOn
          ? "bg-amber-100 text-amber-800 hover:bg-amber-200 ring-1 ring-amber-300"
          : "text-gray-400 hover:bg-gray-50 hover:text-gray-600")
      }
    >
      {demoOn ? <StopCircle size={16} /> : <PlayCircle size={16} />}
      {demoOn ? "Demo mode ON" : "Demo mode"}
    </button>
  );
}

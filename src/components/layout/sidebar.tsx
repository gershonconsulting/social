"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  BarChart3,
  Building2,
  LayoutDashboard,
  FileText,
  Settings,
  Shield,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/clients", icon: Building2, label: "Companies" },
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/reports", icon: FileText, label: "Reports" },
  { href: "/admin", icon: Shield, label: "Admin", adminOnly: true },
  { href: "/settings", icon: Settings, label: "Settings", adminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string })?.role === "ADMIN";

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
          if (item.adminOnly && !isAdmin) return null;

          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
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

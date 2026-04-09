"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  BarChart3,
  LayoutDashboard,
  Users,
  FileText,
  TrendingUp,
  Settings,
  ScrollText,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/clients", icon: Users, label: "Clients" },
  { href: "/reports", icon: FileText, label: "Reports" },
  { href: "/followers", icon: TrendingUp, label: "Followers" },
  { href: "/admin", icon: Settings, label: "Admin", adminOnly: true },
  { href: "/logs", icon: ScrollText, label: "Audit Logs" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string })?.role === "ADMIN";

  return (
    <aside className="w-64 flex-shrink-0 bg-gray-900 text-white flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-700">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <BarChart3 className="h-6 w-6 text-blue-400" />
          <div>
            <div className="text-sm font-bold text-white leading-tight">social.gershonCRM</div>
            <div className="text-xs text-gray-400">Campaign Compliance</div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          if (item.adminOnly && !isAdmin) return null;

          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              )}
            >
              <item.icon className="h-4.5 w-4.5 flex-shrink-0" size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 border-t border-gray-700">
        <div className="px-3 py-2 mb-1">
          <div className="text-sm font-medium text-white truncate">{session?.user?.name}</div>
          <div className="text-xs text-gray-400 truncate">{session?.user?.email}</div>
          <div className="text-xs text-blue-400 mt-0.5 capitalize">
            {(session?.user as { role?: string })?.role?.toLowerCase() ?? "user"}
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

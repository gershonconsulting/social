"use client";

/**
 * The left menu — v4.66.0 unified Gershon design (Linalysis layout).
 *
 * White 240px rail, grouped sections (Overview · Portfolio ·
 * System · Workspace), a solid Gershon-red pill on the current page. Below
 * 1024px it becomes an off-canvas drawer opened by the ☰ button, which sits
 * inside the white top bar's left gutter so it never covers a page title.
 * Routes and order are unchanged from v2.6.0.
 */

import { SocialMark, SocialWordmark } from "@/components/brand/social-mark";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  BarChart3,
  Building2,
  LayoutDashboard,
  LayoutList,
  Settings,
  Users,
  LogOut,
  Menu,
  X,
  ScrollText,
  AlertOctagon,
  Network,
  PlayCircle,
  StopCircle,
  Rocket,
  Puzzle,
} from "lucide-react";
import { useDemoMode, setDemoMode } from "@/lib/use-demo-mode";
import { FilterPanel } from "./filter-panel";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
  children?: { href: string; label: string }[];
};

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/summary", icon: LayoutList, label: "Summary" },
    ],
  },
  {
    label: "Portfolio",
    items: [
      {
        href: "/clients",
        icon: Building2,
        label: "Companies",
        children: [
          { href: "/clients/by-cloudcampaign", label: "By Cloud Campaign" },
          { href: "/clients/by-heropost", label: "By HeroPost" },
        ],
      },
      { href: "/networks", icon: Network, label: "Networks" },
      { href: "/analytics", icon: BarChart3, label: "Analytics" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/logs", icon: ScrollText, label: "Logs" },
      { href: "/errors", icon: AlertOctagon, label: "Errors" },
      { href: "/extension", icon: Puzzle, label: "Extension" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/admin", icon: Users, label: "Admin", children: [{ href: "/admin/users", label: "Users" }] },
      { href: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

/**
 * Whether this workspace still has setup left. Asked once per mount; a failure
 * answers "complete", because a menu entry is not worth an error state.
 */
function useSetupIncomplete(): boolean {
  const [incomplete, setIncomplete] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/onboarding");
        const j = await r.json();
        if (live && j?.success) setIncomplete(!j.data.complete);
      } catch {
        /* leave it hidden */
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return incomplete;
}

function initials(name?: string | null, email?: string | null): string {
  const src = (name || email || "?").replace(/[^A-Za-z ]/g, " ").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role?.toLowerCase() ?? "user";
  const setupIncomplete = useSetupIncomplete();

  // "Getting started" earns a place in the menu only while there is still
  // something to do. A finished workspace shouldn't carry a permanent reminder
  // of setup it completed months ago.
  const groups = setupIncomplete
    ? navGroups.map((g) =>
        g.label === "Overview"
          ? { ...g, items: [{ href: "/welcome", icon: Rocket, label: "Getting started" }, ...g.items] }
          : g,
      )
    : navGroups;

  // Phone / tablet drawer. Closed on every navigation.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="lg:hidden fixed top-2.5 left-3 z-50 w-9 h-9 rounded-lg bg-white border border-gray-200 text-gray-900 flex items-center justify-center hover:border-red-600 hover:text-red-600"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
      {open && (
        <div className="lg:hidden fixed inset-0 z-30 bg-black/20" onClick={() => setOpen(false)} aria-hidden="true" />
      )}
    <aside
      className={cn(
        "gx-sidebar w-[240px] flex-shrink-0 bg-white text-gray-900 flex flex-col h-screen border-r border-gray-200",
        "fixed inset-y-0 left-0 z-40 transition-transform lg:sticky lg:top-0 lg:translate-x-0",
        open ? "is-open translate-x-0" : "-translate-x-full"
      )}
    >
      {/* Brand */}
      <div className="pl-[60px] lg:pl-5 pr-5 h-14 flex items-center border-b border-gray-200">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <SocialMark size={30} className="flex-shrink-0" />
          <SocialWordmark />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5">
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
              {group.label}
            </div>
            {group.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-red-600 text-white font-semibold hover:bg-red-700"
                        : "text-gray-900 hover:bg-red-50 hover:text-red-600"
                    )}
                  >
                    <item.icon className="flex-shrink-0" size={17} strokeWidth={1.8} />
                    {item.label}
                  </Link>
                  {item.children && isActive && (
                    <div className="mt-1 mb-1 ml-[30px] pl-2.5 border-l border-gray-200 space-y-0.5">
                      {item.children.map((sub) => {
                        // A child that shares its parent's href is active on that exact page only.
                        const subActive =
                          pathname === sub.href || (sub.href !== item.href && pathname.startsWith(sub.href + "/"));
                        return (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            aria-current={subActive ? "page" : undefined}
                            className={cn(
                              "block px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors",
                              subActive ? "text-red-700 bg-red-50 font-semibold" : "text-gray-600 hover:text-red-600"
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
          </div>
        ))}

        {/* View filters — category / month / network, applied across the
            dashboard views. Hidden on pages the filters don't drive. */}
        <FilterPanel />
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-gray-200">
        <DemoToggleButton />
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-red-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {initials(session?.user?.name, session?.user?.email)}
          </div>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-[13px] font-medium text-gray-900 truncate">{session?.user?.name}</div>
            <div className="text-xs text-gray-500 truncate capitalize">{role}</div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            aria-label="Sign out"
            title="Sign out"
            className="w-8 h-8 rounded-md flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
    </>
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
        "w-full flex items-center gap-2.5 px-2.5 py-1.5 mb-1 rounded-md text-[13px] font-medium transition-colors " +
        (demoOn
          ? "bg-amber-50 text-amber-800 ring-1 ring-amber-300"
          : "text-gray-600 hover:bg-red-50 hover:text-red-600")
      }
    >
      {demoOn ? <StopCircle size={15} /> : <PlayCircle size={15} />}
      {demoOn ? "Demo mode ON" : "Demo mode"}
    </button>
  );
}

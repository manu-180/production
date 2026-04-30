"use client";
import {
  ActivityIcon,
  FileTextIcon,
  HomeIcon,
  LayersIcon,
  SettingsIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ClaudeAuthStatus } from "./claude-auth-status";
import { SystemStatusIndicator } from "./system-status-indicator";

interface NavItem {
  href: string;
  label: string;
  icon: typeof HomeIcon;
  match: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: HomeIcon,
    match: (p) => p === "/dashboard",
  },
  {
    href: "/dashboard/runs",
    label: "Runs",
    icon: ActivityIcon,
    match: (p) => p.startsWith("/dashboard/runs"),
  },
  {
    href: "/dashboard/plans",
    label: "Plans",
    icon: FileTextIcon,
    match: (p) => p.startsWith("/dashboard/plans"),
  },
  {
    href: "/dashboard/templates",
    label: "Templates",
    icon: LayersIcon,
    match: (p) => p.startsWith("/dashboard/templates"),
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: SettingsIcon,
    match: (p) => p.startsWith("/dashboard/settings"),
  },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex h-full w-[220px] shrink-0 flex-col border-r border-border bg-sidebar",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="size-6 rounded-md bg-primary/90" aria-hidden="true" />
        <span className="font-heading text-sm font-semibold text-sidebar-foreground tracking-tight">
          Conductor
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        <ClaudeAuthStatus />
        <SystemStatusIndicator />
      </div>
    </aside>
  );
}

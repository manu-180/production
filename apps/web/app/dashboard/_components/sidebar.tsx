"use client";
import { cn } from "@/lib/utils";
import {
  ActivityIcon,
  BarChart2Icon,
  CalendarClockIcon,
  FileTextIcon,
  HomeIcon,
  LayersIcon,
  LinkIcon,
  SettingsIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
    label: "Panel",
    icon: HomeIcon,
    match: (p) => p === "/dashboard",
  },
  {
    href: "/dashboard/runs",
    label: "Ejecuciones",
    icon: ActivityIcon,
    match: (p) => p.startsWith("/dashboard/runs"),
  },
  {
    href: "/dashboard/insights",
    label: "Perspectivas",
    icon: BarChart2Icon,
    match: (p) => p.startsWith("/dashboard/insights"),
  },
  {
    href: "/dashboard/plans",
    label: "Planes",
    icon: FileTextIcon,
    match: (p) => p.startsWith("/dashboard/plans"),
  },
  {
    href: "/dashboard/schedule",
    label: "Programaciones",
    icon: CalendarClockIcon,
    match: (p) => p.startsWith("/dashboard/schedule"),
  },
  {
    href: "/dashboard/templates",
    label: "Plantillas",
    icon: LayersIcon,
    match: (p) => p.startsWith("/dashboard/templates"),
  },
  {
    href: "/dashboard/integrations",
    label: "Integraciones",
    icon: LinkIcon,
    match: (p) => p.startsWith("/dashboard/integrations"),
  },
  {
    href: "/dashboard/settings",
    label: "Configuración",
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

      <nav className="flex flex-1 flex-col gap-0.5 p-3" data-tour="sidebar">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);
          const getTourAttribute = () => {
            const map: Record<string, string> = {
              "/dashboard": "nav-dashboard",
              "/dashboard/runs": "nav-runs",
              "/dashboard/insights": "nav-insights",
              "/dashboard/plans": "nav-plans",
              "/dashboard/schedule": "nav-schedules",
              "/dashboard/templates": "nav-templates",
              "/dashboard/integrations": "nav-integrations",
              "/dashboard/settings": "nav-settings",
            };
            return map[item.href];
          };
          return (
            <Link
              key={item.href}
              href={item.href}
              data-tour={getTourAttribute()}
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

"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SETTINGS_NAV = [
  {
    href: "/dashboard/settings",
    label: "General",
    match: (p: string) => p === "/dashboard/settings",
  },
  {
    href: "/dashboard/settings/notifications",
    label: "Notificaciones",
    match: (p: string) => p.startsWith("/dashboard/settings/notifications"),
  },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-border">
      {SETTINGS_NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

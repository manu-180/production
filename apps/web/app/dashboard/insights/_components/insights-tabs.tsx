"use client";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/insights", label: "Overview", exact: true },
  { href: "/dashboard/insights/runs", label: "Runs", exact: false },
  { href: "/dashboard/insights/prompts", label: "Prompts", exact: false },
  { href: "/dashboard/insights/guardian", label: "Guardian", exact: false },
  { href: "/dashboard/insights/audit", label: "Audit Log", exact: false },
];

export function InsightsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-border pb-0">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

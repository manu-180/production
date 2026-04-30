"use client";
import { ChevronRightIcon, MenuIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { NotificationBell } from "./notification-bell";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

interface Crumb {
  href: string;
  label: string;
}

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let acc = "";
  for (const s of segments) {
    acc += `/${s}`;
    crumbs.push({
      href: acc,
      label: s.length > 24 ? `${s.slice(0, 8)}…${s.slice(-4)}` : titleize(s),
    });
  }
  return crumbs;
}

function titleize(s: string): string {
  if (s === "dashboard") return "Dashboard";
  if (s === "runs") return "Runs";
  if (s === "plans") return "Plans";
  if (s === "templates") return "Templates";
  if (s === "settings") return "Settings";
  if (s === "decisions") return "Decisions";
  if (s === "diff") return "Diff";
  return s;
}

export function Topbar() {
  const pathname = usePathname();
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      {/* Mobile: hamburger opens sidebar drawer */}
      <Sheet>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Open navigation" className="lg:hidden">
              <MenuIcon className="size-4" />
            </Button>
          }
        />
        <SheetContent side="left" className="w-[240px] p-0">
          <Sidebar />
        </SheetContent>
      </Sheet>

      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map((c, i) => (
          <span key={c.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRightIcon className="size-3" aria-hidden="true" />}
            <Link
              href={c.href}
              className="truncate hover:text-foreground transition-colors"
              aria-current={i === crumbs.length - 1 ? "page" : undefined}
            >
              {c.label}
            </Link>
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open command palette (Cmd+K)"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("open-command-palette"))
          }
          className="gap-2 text-muted-foreground"
        >
          <SearchIcon className="size-3.5" />
          <span className="hidden sm:inline">Search…</span>
          <kbd className="ml-2 hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground sm:inline">
            ⌘K
          </kbd>
        </Button>
        <NotificationBell />
        <ThemeToggle />
      </div>
    </header>
  );
}

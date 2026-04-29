import { ActivityIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Dashboard — Conductor",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-[220px] flex-col border-r border-border bg-sidebar">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <span className="font-heading text-sm font-semibold text-sidebar-foreground tracking-tight">
            Conductor
          </span>
        </div>

        <nav className="flex flex-col gap-1 p-3">
          <Link
            href="/dashboard/runs"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ActivityIcon className="size-4 shrink-0" />
            Runs
          </Link>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col pl-[220px]">{children}</main>
    </div>
  );
}

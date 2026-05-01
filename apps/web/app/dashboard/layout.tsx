import type { Metadata } from "next";
import { DashboardProviders } from "./_components/dashboard-providers";
import { Sidebar } from "./_components/sidebar";
import { Topbar } from "./_components/topbar";

export const metadata: Metadata = {
  title: "Dashboard — Conductor",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar className="fixed inset-y-0 left-0 z-30 hidden lg:flex" />
      <div className="flex min-h-screen w-full flex-col lg:pl-[220px]">
        <Topbar />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
      {/* Client boundary: CommandPalette + ShortcutsModal + useShortcuts */}
      <DashboardProviders />
    </div>
  );
}

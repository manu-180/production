import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Setup — Conductor",
};

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex flex-col flex-1 items-center justify-center min-h-screen px-4 py-16 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background to-background/95 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.08),transparent)] pointer-events-none" />
      <div className="relative z-10 w-full max-w-lg">{children}</div>
    </main>
  );
}

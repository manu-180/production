import { LandingHero } from "@/components/landing/landing-hero";
import { SystemStatus } from "@/components/landing/system-status";
import { Suspense } from "react";

export default function HomePage() {
  return (
    <main className="relative flex flex-col flex-1 items-center justify-center min-h-screen px-4 py-16 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background to-background/95 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.08),transparent)] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-12 w-full max-w-2xl">
        <LandingHero />

        {/* System status */}
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-mono">
            System Status
          </p>
          <Suspense
            fallback={
              <div className="text-xs text-muted-foreground font-mono animate-pulse">Checking…</div>
            }
          >
            <SystemStatus />
          </Suspense>
        </div>

        {/* Footer */}
        <footer className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
          <span>v0.1.0</span>
          <span>·</span>
          <a href="/docs" className="hover:text-foreground transition-colors">
            docs
          </a>
          <span>·</span>
          <span>conductor</span>
        </footer>
      </div>
    </main>
  );
}

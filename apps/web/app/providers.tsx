"use client";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReactQueryProvider } from "@/lib/react-query/provider";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ReactQueryProvider>
        <TooltipProvider delay={150}>
          {children}
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </ReactQueryProvider>
    </ThemeProvider>
  );
}

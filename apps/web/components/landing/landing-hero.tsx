"use client";

import { Button } from "@/components/ui/button";
import { type Variants, motion } from "framer-motion";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { BatonLogo } from "./baton-logo";

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

export function LandingHero() {
  const { theme, setTheme } = useTheme();

  return (
    <motion.div
      className="flex flex-col items-center text-center gap-8"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Logo */}
      <motion.div variants={item} className="relative">
        <div className="size-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <BatonLogo className="size-10 text-primary" />
        </div>
      </motion.div>

      {/* Title */}
      <motion.div variants={item} className="space-y-3">
        <h1 className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl">Conductor</h1>
        <p className="text-lg text-muted-foreground font-mono">Plan it once. Conduct it forever.</p>
      </motion.div>

      {/* Description */}
      <motion.p
        variants={item}
        className="max-w-md text-base text-muted-foreground leading-relaxed"
      >
        Orchestrate multi-step AI plans across any codebase. Define prompts once, execute them
        reliably — with checkpoints, retries, and live streaming.
      </motion.p>

      {/* CTA */}
      <motion.div variants={item} className="flex items-center gap-3">
        <Button
          size="lg"
          render={
            <Link href="/dashboard" className="gap-2 inline-flex items-center">
              Open Dashboard
              <ArrowRight className="size-4" />
            </Link>
          }
        />
        <Button
          variant="outline"
          size="lg"
          render={
            <a href="/docs" target="_blank" rel="noopener noreferrer">
              Docs
            </a>
          }
        />
      </motion.div>

      {/* Theme toggle */}
      <motion.button
        variants={item}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="absolute top-4 right-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </motion.button>
    </motion.div>
  );
}

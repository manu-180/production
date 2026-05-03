"use client";

import { Button } from "@/components/ui/button";
import { type Variants, motion } from "framer-motion";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
        <p className="text-lg text-muted-foreground font-mono">
          Planealo una vez. Conducilo para siempre.
        </p>
      </motion.div>

      {/* Description */}
      <motion.p
        variants={item}
        className="max-w-md text-base text-muted-foreground leading-relaxed"
      >
        Orquestá planes de IA de múltiples pasos en cualquier codebase. Definí los prompts una vez y
        ejecutalos de forma confiable — con checkpoints, reintentos y streaming en vivo.
      </motion.p>

      {/* CTA */}
      <motion.div variants={item} className="flex items-center gap-3">
        <Button
          size="lg"
          render={
            <Link href="/dashboard" className="gap-2 inline-flex items-center">
              Abrir Dashboard
              <ArrowRight className="size-4" />
            </Link>
          }
        />
        <Button
          variant="outline"
          size="lg"
          render={
            <a href="/docs" target="_blank" rel="noopener noreferrer">
              Documentación
            </a>
          }
        />
      </motion.div>

      {/* Theme toggle */}
      <motion.button
        variants={item}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="absolute top-4 right-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Cambiar tema"
      >
        {mounted ? (
          theme === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )
        ) : (
          <Moon className="size-4" />
        )}
      </motion.button>
    </motion.div>
  );
}

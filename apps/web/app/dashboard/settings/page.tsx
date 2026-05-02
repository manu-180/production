import type { Metadata } from "next";
import { SettingsForm } from "./_components/settings-form";
import { SettingsNav } from "./_components/settings-nav";

export const metadata: Metadata = {
  title: "Settings — Conductor",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          Configuración
        </h1>
        <p className="text-sm text-muted-foreground">
          Valores predeterminados para nuevas ejecuciones. Las configuraciones por plan tienen
          prioridad.
        </p>
      </header>

      <SettingsNav />

      <SettingsForm />
    </div>
  );
}

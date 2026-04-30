import type { Metadata } from "next";
import { SettingsForm } from "./_components/settings-form";

export const metadata: Metadata = {
  title: "Settings — Conductor",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Defaults applied to new runs. Per-plan overrides take precedence.
        </p>
      </header>
      <SettingsForm />
    </div>
  );
}

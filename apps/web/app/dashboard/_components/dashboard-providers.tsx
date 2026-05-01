"use client";

import { OnboardingTour } from "@/components/onboarding-tour";
import { ShortcutsModal } from "@/components/shortcuts-modal";
import { useShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useThemeConfig } from "@/hooks/use-theme-config";
import { qk } from "@/lib/react-query/keys";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { CommandPalette } from "./command-palette";

interface SettingsRow {
  onboarding_completed?: boolean;
}

/**
 * Client boundary that wires together the CommandPalette, ShortcutsModal, and OnboardingTour.
 *
 * Rendered inside the server DashboardLayout so both overlays are available
 * everywhere in the dashboard without turning the layout into a client component.
 */
export function DashboardProviders() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  // Apply color theme class to <html> element
  useThemeConfig();

  const { data: settings } = useQuery<SettingsRow>({
    queryKey: qk.settings.detail(),
    queryFn: async () => {
      const response = await fetch("/api/settings");
      if (!response.ok) throw new Error("Failed to fetch settings");
      return response.json();
    },
  });

  const onOpenCommandPalette = useCallback(() => setCommandPaletteOpen(true), []);
  const onShowShortcutsModal = useCallback(() => setShortcutsModalOpen(true), []);

  useShortcuts({ onOpenCommandPalette, onShowShortcutsModal });

  return (
    <>
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onShowShortcuts={onShowShortcutsModal}
      />
      <ShortcutsModal open={shortcutsModalOpen} onOpenChange={setShortcutsModalOpen} />
      <OnboardingTour onboardingCompleted={settings?.onboarding_completed ?? false} />
    </>
  );
}

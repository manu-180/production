"use client";

import { ShortcutsModal } from "@/components/shortcuts-modal";
import { useShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useCallback, useState } from "react";
import { CommandPalette } from "./command-palette";

/**
 * Client boundary that wires together the CommandPalette and ShortcutsModal.
 *
 * Rendered inside the server DashboardLayout so both overlays are available
 * everywhere in the dashboard without turning the layout into a client component.
 */
export function DashboardProviders() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

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
    </>
  );
}

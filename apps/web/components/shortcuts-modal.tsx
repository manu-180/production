"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SHORTCUTS, type ShortcutKey } from "@/hooks/use-keyboard-shortcuts";
import { useEffect } from "react";

interface ShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Shortcut groups for display purposes
// ---------------------------------------------------------------------------

interface ShortcutRow {
  key: ShortcutKey;
  label: string;
}

interface ShortcutGroup {
  heading: string;
  rows: ShortcutRow[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    heading: "Navigation",
    rows: [
      { key: "G H", label: SHORTCUTS["G H"] },
      { key: "G R", label: SHORTCUTS["G R"] },
      { key: "G P", label: SHORTCUTS["G P"] },
      { key: "G S", label: SHORTCUTS["G S"] },
    ],
  },
  {
    heading: "Actions",
    rows: [
      { key: "Cmd+K", label: SHORTCUTS["Cmd+K"] },
      { key: "Cmd+Shift+R", label: SHORTCUTS["Cmd+Shift+R"] },
    ],
  },
  {
    heading: "General",
    rows: [
      { key: "?", label: SHORTCUTS["?"] },
      { key: "Escape", label: SHORTCUTS["Escape"] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Render a shortcut key string as styled <kbd> elements.
// Handles compound keys like "Cmd+Shift+R" and chords like "G H".
// ---------------------------------------------------------------------------

function KeyBadge({ shortcut }: { shortcut: ShortcutKey }) {
  // Chords (space-separated, e.g. "G H") → render each key separately
  const isChord = shortcut.includes(" ") && !shortcut.includes("+");

  if (isChord) {
    const parts = shortcut.split(" ");
    return (
      <span className="flex items-center gap-1">
        {parts.map((part) => (
          <kbd
            key={part}
            className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
          >
            {part}
          </kbd>
        ))}
      </span>
    );
  }

  // Compound keys (plus-separated, e.g. "Cmd+Shift+R") → single <kbd>
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {shortcut}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShortcutsModal({ open, onOpenChange }: ShortcutsModalProps) {
  // Also listen for the custom event so the modal can be opened without props
  useEffect(() => {
    function onOpenEvent() {
      onOpenChange(true);
    }
    window.addEventListener("open-shortcuts-modal", onOpenEvent);
    return () => window.removeEventListener("open-shortcuts-modal", onOpenEvent);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          All available keyboard shortcuts for the Conductor dashboard.
        </DialogDescription>
      </DialogHeader>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <div className="mb-4">
          <h2 className="font-heading text-base font-medium leading-none">Keyboard shortcuts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Press{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              ?
            </kbd>{" "}
            at any time to show this dialog.
          </p>
        </div>

        <div className="flex flex-col gap-5">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.heading} aria-labelledby={`shortcut-group-${group.heading}`}>
              <h3
                id={`shortcut-group-${group.heading}`}
                className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {group.heading}
              </h3>
              <div className="flex flex-col gap-1">
                {group.rows.map(({ key, label }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <span className="text-foreground">{label}</span>
                    <KeyBadge shortcut={key} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

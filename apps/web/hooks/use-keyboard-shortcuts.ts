"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Subscribe to a keyboard combo. Combo syntax:
 *  - "mod+k"   → Cmd on macOS, Ctrl elsewhere
 *  - "esc"     → Escape
 *  - "?"       → literal "?" (shift+/)
 *  - "shift+/" → same as above
 *
 * Handler runs only when no input/textarea/contenteditable has focus,
 * unless `allowInInput: true`.
 */
export function useShortcut(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  opts?: { allowInInput?: boolean; deps?: ReadonlyArray<unknown> },
): void {
  useEffect(() => {
    function isInInput(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function matches(e: KeyboardEvent, c: string): boolean {
      const parts = c.toLowerCase().split("+");
      const key = parts.pop() ?? "";
      const wantMod = parts.includes("mod");
      const wantShift = parts.includes("shift");
      const wantAlt = parts.includes("alt");
      const wantCtrl = parts.includes("ctrl");
      const isMac =
        typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform);
      const modOk = wantMod ? (isMac ? e.metaKey : e.ctrlKey) : true;
      const shiftOk = wantShift ? e.shiftKey : true;
      const altOk = wantAlt ? e.altKey : true;
      const ctrlOk = wantCtrl ? e.ctrlKey : true;

      const eKey = e.key.toLowerCase();
      const keyOk = eKey === key || (key === "esc" && eKey === "escape");
      return modOk && shiftOk && altOk && ctrlOk && keyOk;
    }

    function onKey(e: KeyboardEvent) {
      if (!opts?.allowInInput && isInInput(e.target)) return;
      if (matches(e, combo)) handler(e);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo, handler, opts?.allowInInput, ...(opts?.deps ?? [])]);
}

// ---------------------------------------------------------------------------
// Shortcut registry — used by ShortcutsModal for display
// ---------------------------------------------------------------------------

export const SHORTCUTS = {
  "Cmd+K": "Open command palette",
  "Cmd+Shift+R": "Launch run from current plan",
  "?": "Show shortcuts modal",
  "G H": "Go to Dashboard",
  "G R": "Go to Runs",
  "G P": "Go to Plans",
  "G S": "Go to Settings",
  Escape: "Close modal / cancel",
} as const;

export type ShortcutKey = keyof typeof SHORTCUTS;

// ---------------------------------------------------------------------------
// Chord timeout: how long to wait for the second key in a g-chord (ms)
// ---------------------------------------------------------------------------
const CHORD_TIMEOUT_MS = 500;

interface UseShortcutsOptions {
  onOpenCommandPalette: () => void;
  onShowShortcutsModal: () => void;
}

/**
 * Registers all global keyboard shortcuts for the dashboard.
 *
 * Handles:
 *  - Cmd/Ctrl+K  → open command palette
 *  - Cmd/Ctrl+Shift+R → dispatch "launch-run" custom event
 *  - ?           → show shortcuts modal
 *  - g h / g r / g p / g s → vim-style navigation chords
 *
 * Ignores shortcuts when focus is inside an input, textarea, select, or
 * contenteditable element.
 */
export function useShortcuts(options: UseShortcutsOptions): void {
  const router = useRouter();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    // Pending first key of a chord ("g" pressed, waiting for second key)
    let pendingChord: string | null = null;
    let chordTimer: ReturnType<typeof setTimeout> | null = null;

    function clearChord() {
      pendingChord = null;
      if (chordTimer !== null) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
    }

    function isInInput(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function isMac(): boolean {
      return typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform);
    }

    function onKey(e: KeyboardEvent) {
      if (isInInput(e.target)) {
        clearChord();
        return;
      }

      const key = e.key;
      const mod = isMac() ? e.metaKey : e.ctrlKey;

      // --- Cmd/Ctrl+K → open command palette ---
      if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        clearChord();
        optionsRef.current.onOpenCommandPalette();
        return;
      }

      // --- Cmd/Ctrl+Shift+R → launch run ---
      if (mod && e.shiftKey && key === "R") {
        e.preventDefault();
        clearChord();
        window.dispatchEvent(new CustomEvent("launch-run"));
        return;
      }

      // Don't process further if modifier keys are held (avoids interfering
      // with browser shortcuts like Cmd+R, Cmd+S, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) {
        clearChord();
        return;
      }

      // --- ? → show shortcuts modal ---
      if (key === "?") {
        e.preventDefault();
        clearChord();
        optionsRef.current.onShowShortcutsModal();
        return;
      }

      // --- Vim-style g-chords ---
      if (pendingChord === "g") {
        clearChord();
        switch (key.toLowerCase()) {
          case "h":
            e.preventDefault();
            router.push("/dashboard");
            break;
          case "r":
            e.preventDefault();
            router.push("/dashboard/runs");
            break;
          case "p":
            e.preventDefault();
            router.push("/dashboard/plans");
            break;
          case "s":
            e.preventDefault();
            router.push("/dashboard/settings");
            break;
          default:
            break;
        }
        return;
      }

      // --- First key of a chord: "g" ---
      if (key.toLowerCase() === "g") {
        pendingChord = "g";
        chordTimer = setTimeout(clearChord, CHORD_TIMEOUT_MS);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearChord();
    };
  }, [router]);
}

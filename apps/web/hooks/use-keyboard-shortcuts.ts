"use client";
import { useEffect } from "react";

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: combo+opts are stable strings/booleans
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
        typeof navigator !== "undefined" &&
        /mac|iphone|ipad|ipod/i.test(navigator.platform);
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

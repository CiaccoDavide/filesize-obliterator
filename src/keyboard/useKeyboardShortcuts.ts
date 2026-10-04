import { useEffect, useRef } from "react";
import {
  detectPlatform,
  isTypingTarget,
  matchShortcut,
  type ShortcutId,
} from "./shortcuts";

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

type Options = {
  /** When true, Escape → abortAll is armed. Otherwise abort is a no-op. */
  canAbort: boolean;
  /** Help overlay open — Escape closes it; other actions (except toggle) ignored. */
  helpOpen: boolean;
  enabled?: boolean;
};

/**
 * Window-level shortcuts. Skips when focus is in a text field.
 * Abort is hard-bound only while `canAbort` (jobs running).
 */
export function useKeyboardShortcuts(
  handlers: ShortcutHandlers,
  { canAbort, helpOpen, enabled = true }: Options,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const platform = detectPlatform(
      typeof navigator !== "undefined" ? navigator.platform : "Win32",
    );

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      const typing =
        target instanceof HTMLElement
          ? isTypingTarget({
              tagName: target.tagName,
              isContentEditable: target.isContentEditable,
              inputType:
                target instanceof HTMLInputElement ? target.type : undefined,
            })
          : false;
      if (typing) return;

      const id = matchShortcut(
        {
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
        },
        platform,
      );
      if (!id) return;

      const h = handlersRef.current;

      if (helpOpen) {
        if (id === "toggleHelp" || id === "abortAll") {
          // Escape while help is open closes the overlay (not abort).
          e.preventDefault();
          h.toggleHelp?.();
        }
        return;
      }

      if (id === "abortAll" && !canAbort) return;

      const run = h[id];
      if (!run) return;
      e.preventDefault();
      run();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canAbort, helpOpen, enabled]);
}

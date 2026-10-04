import { useEffect, useRef } from "react";
import type { BatchSummary } from "../compress/batchSummary";
import type { ProgressRow } from "../compress/progressState";
import { listenNotificationFocus, tauriNotificationHost } from "../ipc/notify";
import {
  bytesSavedForCurrentBatch,
  runCompletionNotification,
  type NotificationHost,
} from "../notify/completionNotification";

function summaryFingerprint(summary: BatchSummary): string {
  return `${summary.status}:${summary.succeeded}:${summary.failed}:${summary.failures
    .map((f) => `${f.path}|${f.reason}`)
    .join(";")}`;
}

function isWindowFocused(): boolean {
  if (typeof document === "undefined") return true;
  return document.hasFocus();
}

type Options = {
  enabled: boolean;
  summary: BatchSummary | null;
  rows: ProgressRow[];
  host?: NotificationHost;
  isFocused?: () => boolean;
};

/**
 * Fire a local OS notification when a batch reaches a terminal summary
 * while the window is unfocused (permission permitting).
 */
export function useCompletionNotification({
  enabled,
  summary,
  rows,
  host = tauriNotificationHost,
  isFocused = isWindowFocused,
}: Options): void {
  const lastNotifiedRef = useRef<string | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | undefined;
    void listenNotificationFocus().then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      teardown = fn;
    });
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  useEffect(() => {
    if (!summary) {
      lastNotifiedRef.current = null;
      return;
    }
    const key = summaryFingerprint(summary);
    if (lastNotifiedRef.current === key) return;
    lastNotifiedRef.current = key;

    void runCompletionNotification({
      enabled,
      focused: isFocused(),
      summary,
      bytesSaved: bytesSavedForCurrentBatch(rowsRef.current),
      host,
    });
  }, [enabled, summary, host, isFocused]);
}

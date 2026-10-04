import type { BatchSummary } from "../compress/batchSummary";
import { formatSignedBytes } from "../compress/sessionStats";
import type { ProgressRow } from "../compress/progressState";

export type CompletionNotificationCopy = {
  title: string;
  body: string;
};

export type NotificationHost = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission | string>;
  sendNotification: (options: { title: string; body: string }) => void;
};

/** Terse OS notification copy from a terminal batch summary. */
export function formatCompletionNotification(
  summary: BatchSummary,
  opts?: { bytesSaved?: number | null },
): CompletionNotificationCopy {
  let body = `OK ${summary.succeeded} · FAIL ${summary.failed}`;
  const saved = opts?.bytesSaved;
  if (typeof saved === "number" && Number.isFinite(saved)) {
    body += ` · saved ${formatSignedBytes(saved)}`;
  }
  return { title: summary.status, body };
}

export function shouldNotifyBatchComplete(args: {
  enabled: boolean;
  focused: boolean;
  summary: BatchSummary | null;
}): boolean {
  return Boolean(args.enabled && !args.focused && args.summary);
}

function scopedCurrentBatch(rows: ProgressRow[]): ProgressRow[] {
  if (rows.length === 0) return [];
  const currentGen = rows.reduce(
    (max, r) => Math.max(max, r.batchGeneration ?? 0),
    0,
  );
  if (currentGen === 0) return rows;
  return rows.filter((r) => (r.batchGeneration ?? 0) === currentGen);
}

/**
 * Bytes saved for COMPLETE jobs in the current batch generation.
 * Null when no completed job contributed byte totals.
 */
export function bytesSavedForCurrentBatch(rows: ProgressRow[]): number | null {
  const scoped = scopedCurrentBatch(rows);
  let bytesIn = 0;
  let bytesOut = 0;
  let counted = false;
  for (const row of scoped) {
    if (row.phase !== "COMPLETE") continue;
    if (
      typeof row.originalBytes !== "number" ||
      typeof row.resultBytes !== "number"
    ) {
      continue;
    }
    counted = true;
    bytesIn += row.originalBytes;
    bytesOut += row.resultBytes;
  }
  return counted ? bytesIn - bytesOut : null;
}

export async function runCompletionNotification(args: {
  enabled: boolean;
  focused: boolean;
  summary: BatchSummary | null;
  bytesSaved?: number | null;
  host: NotificationHost;
}): Promise<boolean> {
  if (
    !shouldNotifyBatchComplete({
      enabled: args.enabled,
      focused: args.focused,
      summary: args.summary,
    }) ||
    !args.summary
  ) {
    return false;
  }

  let granted = false;
  try {
    granted = await args.host.isPermissionGranted();
    if (!granted) {
      const permission = await args.host.requestPermission();
      granted = permission === "granted";
    }
  } catch {
    return false;
  }
  if (!granted) return false;

  const copy = formatCompletionNotification(args.summary, {
    bytesSaved: args.bytesSaved,
  });
  try {
    args.host.sendNotification(copy);
    return true;
  } catch {
    return false;
  }
}

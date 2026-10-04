import type { ProgressRow } from "./progressState";

/** Session aggregates derived from completed/failed job rows. */
export type SessionStats = {
  filesDone: number;
  filesFailed: number;
  bytesIn: number;
  bytesOut: number;
  bytesSaved: number;
  /** Null when no successful jobs contributed input bytes. */
  savePercent: number | null;
};

/**
 * Derive live session meters from HUD rows.
 * Failed jobs count toward filesFailed only — never toward byte savings.
 */
export function aggregateSessionStats(rows: ProgressRow[]): SessionStats {
  let filesDone = 0;
  let filesFailed = 0;
  let bytesIn = 0;
  let bytesOut = 0;

  for (const row of rows) {
    if (row.phase === "COMPLETE") {
      filesDone += 1;
      if (
        typeof row.originalBytes === "number" &&
        typeof row.resultBytes === "number"
      ) {
        bytesIn += row.originalBytes;
        bytesOut += row.resultBytes;
      }
    } else if (row.phase === "FAILED") {
      filesFailed += 1;
    }
  }

  const bytesSaved = bytesIn - bytesOut;
  const savePercent =
    bytesIn > 0 ? (bytesSaved / bytesIn) * 100 : null;

  return {
    filesDone,
    filesFailed,
    bytesIn,
    bytesOut,
    bytesSaved,
    savePercent,
  };
}

/** Compact save-% for HUD meters (one decimal under 100, integer at 100). */
export function formatSavePercent(savePercent: number | null): string {
  if (savePercent === null || !Number.isFinite(savePercent)) return "—";
  const abs = Math.abs(savePercent);
  const digits = abs >= 99.95 || abs < 10 ? 0 : 1;
  const rounded = Number(savePercent.toFixed(digits));
  return `${rounded}%`;
}

import type { ProgressRow } from "./progressState";

/** First-class outcome when every queue row is terminal. */
export type BatchSummaryStatus = "COMPLETE" | "FAILED" | "PARTIAL";

export type BatchFailure = {
  path: string;
  reason: string;
};

export type BatchSummary = {
  status: BatchSummaryStatus;
  succeeded: number;
  failed: number;
  failures: BatchFailure[];
};

export type RetryCandidate = {
  sourcePath: string;
  mediaKind: string;
  presetId: string;
};

const STALL_ERROR = "encoder stalled — no progress";

/** Map raw encoder/OS errors into terse Ice HUD ops lines. */
export function normalizeOpsError(raw: string): string {
  const msg = raw.trim();
  if (!msg) return "encode failed";
  if (msg === "cancelled" || msg === STALL_ERROR) return msg;

  const lower = msg.toLowerCase();

  if (
    lower.includes("permission denied") ||
    lower.includes("operation not permitted") ||
    lower.includes("access is denied")
  ) {
    if (lower.includes("write") || lower.includes("_compressed") || lower.includes("reserve")) {
      return "permission denied — cannot write output";
    }
    return "permission denied — cannot read source";
  }

  if (lower.startsWith("missing codec") || lower.includes("missing codec:")) {
    return "missing codec — encoder unavailable";
  }

  const missingTool = lower.match(/^missing tool:\s*([a-z0-9_-]+)/);
  if (missingTool) {
    return `missing tool — ${missingTool[1]} unavailable`;
  }

  if (lower.includes("unsupported or corrupt")) {
    if (lower.includes("video")) return "unsupported or corrupt — video";
    if (lower.includes("audio")) return "unsupported or corrupt — audio";
    if (lower.includes("pdf")) return "unsupported or corrupt — pdf";
    if (lower.includes("image")) return "unsupported or corrupt — image";
    return "unsupported or corrupt — media";
  }

  if (lower.includes("unsupported")) {
    if (lower.includes("video")) return "unsupported type — video";
    if (lower.includes("audio")) return "unsupported type — audio";
    if (lower.includes("pdf")) return "unsupported type — pdf";
    if (lower.includes("image")) return "unsupported type — image";
    return "unsupported type — media";
  }

  return msg;
}

function isActivePhase(phase: ProgressRow["phase"]): boolean {
  return (
    phase === "AWAITING" || phase === "COMPRESSING" || phase === "ABORTING"
  );
}

/** Aggregate counts + failure reasons once the queue has no active rows. */
export function buildBatchSummary(rows: ProgressRow[]): BatchSummary | null {
  if (rows.length === 0) return null;
  if (rows.some((r) => isActivePhase(r.phase))) return null;

  const succeeded = rows.filter((r) => r.phase === "COMPLETE").length;
  const failedRows = rows.filter((r) => r.phase === "FAILED");
  const failed = failedRows.length;
  const failures = failedRows.map((r) => ({
    path: r.sourcePath,
    reason: normalizeOpsError(r.error ?? "encode failed"),
  }));

  let status: BatchSummaryStatus;
  if (failed === 0) status = "COMPLETE";
  else if (succeeded === 0) status = "FAILED";
  else status = "PARTIAL";

  return { status, succeeded, failed, failures };
}

export function failedRowsForRetry(rows: ProgressRow[]): RetryCandidate[] {
  return rows
    .filter((r) => r.phase === "FAILED" && r.presetId)
    .map((r) => ({
      sourcePath: r.sourcePath,
      mediaKind: r.mediaKind,
      presetId: r.presetId,
    }));
}

/** Drop FAILED rows; leave COMPLETE (and any active) untouched. */
export function dismissFailedRows(rows: ProgressRow[]): ProgressRow[] {
  return rows.filter((r) => r.phase !== "FAILED");
}

/**
 * COMPRESSING video jobs silent longer than `stallMs`.
 *
 * Only video emits dense progress during encode; image/audio/pdf tick sparsely
 * (e.g. 0 → 20 → 90), so silence there is not a stall signal.
 * Callers must compressCancel these ids (mark ABORTING first) — never flip
 * straight to FAILED while the backend may still hold reserved paths/.partial.
 */
export function stalledJobIds(
  rows: ProgressRow[],
  lastActivityMs: ReadonlyMap<string, number>,
  nowMs: number,
  stallMs: number,
): string[] {
  return rows
    .filter((row) => {
      if (row.phase !== "COMPRESSING") return false;
      if (row.mediaKind !== "video") return false;
      const last = lastActivityMs.get(row.jobId);
      if (last === undefined) return false;
      return nowMs - last >= stallMs;
    })
    .map((row) => row.jobId);
}

export const ENCODER_STALL_ERROR = STALL_ERROR;
/** Default stall window when video progress events stop arriving. */
export const ENCODER_STALL_MS = 45_000;

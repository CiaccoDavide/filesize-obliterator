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
 * COMPRESSING jobs silent longer than their kind's stall window.
 *
 * Video emits dense progress; `stallMs` (default 45s) applies.
 * Image/audio/pdf tick sparsely (0 → 20 → 90), so they use a much longer
 * `sparseStallMs` — long enough not to false-fail normal encodes, short enough
 * that a hung encoder cannot stay COMPRESSING forever.
 * Callers must compressCancel these ids (mark ABORTING first) — never flip
 * straight to FAILED while the backend may still hold reserved paths/.partial.
 */
export function stalledJobIds(
  rows: ProgressRow[],
  lastActivityMs: ReadonlyMap<string, number>,
  nowMs: number,
  stallMs: number,
  sparseStallMs: number = ENCODER_SPARSE_STALL_MS,
): string[] {
  return rows
    .filter((row) => {
      if (row.phase !== "COMPRESSING") return false;
      const last = lastActivityMs.get(row.jobId);
      if (last === undefined) return false;
      const silentFor = nowMs - last;
      if (row.mediaKind === "video") {
        return silentFor >= stallMs;
      }
      return silentFor >= sparseStallMs;
    })
    .map((row) => row.jobId);
}

export const ENCODER_STALL_ERROR = STALL_ERROR;
/** Default stall window when video progress events stop arriving. */
export const ENCODER_STALL_MS = 45_000;
/**
 * Stall window for image/audio/pdf (sparse progress). Far longer than a normal
 * encode gap between 20% and 90% ticks; still bounds hung COMPRESSING rows.
 */
export const ENCODER_SPARSE_STALL_MS = 10 * 60_000;

/**
 * UI escape hatch after cancel: Rust force-fails within ~8s cancel grace.
 * If the Failed event is dropped, force-fail ABORTING so RETRY is not gated forever.
 */
export const CANCEL_CLEANUP_TIMEOUT_MS = 15_000;

/** ABORTING jobs whose cancel cleanup window elapsed without a terminal event. */
export function abortingPastCleanupTimeout(
  rows: ProgressRow[],
  abortStartedMs: ReadonlyMap<string, number>,
  nowMs: number,
  timeoutMs: number = CANCEL_CLEANUP_TIMEOUT_MS,
): string[] {
  return rows
    .filter((row) => {
      if (row.phase !== "ABORTING") return false;
      const started = abortStartedMs.get(row.jobId);
      if (started === undefined) return false;
      return nowMs - started >= timeoutMs;
    })
    .map((row) => row.jobId);
}

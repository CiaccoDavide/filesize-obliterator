import type { CompressEvent, JobInfo, JobStatus } from "../ipc/compress";
import { ENCODER_STALL_ERROR, normalizeOpsError } from "./batchSummary";

/** Operational phase shown on the live HUD strip. */
export type OpsPhase =
  | "AWAITING"
  | "COMPRESSING"
  | "COMPLETE"
  | "FAILED"
  | "PARTIAL"
  | "ABORTING"
  | "SKIPPED";

/** Per-file row tracked from job IPC + event stream. */
export type ProgressRow = {
  jobId: string;
  sourcePath: string;
  mediaKind: string;
  presetId: string;
  phase: OpsPhase;
  percent: number;
  bytesProcessed?: number;
  bytesTotal?: number;
  outputPath?: string;
  originalBytes?: number;
  resultBytes?: number;
  durationMs?: number;
  error?: string;
  /** Admission generation for this row's batch; scopes batch summary. */
  batchGeneration?: number;
  /**
   * Set when the UI force-fails ABORTING after CANCEL_CLEANUP_TIMEOUT_MS while
   * Rust may still be inside finish_after_staging_cleanup. RETRY stays gated
   * until a real Failed event clears this flag.
   */
  cleanupPending?: boolean;
};

const PHASE_RANK: Record<OpsPhase, number> = {
  AWAITING: 0,
  COMPRESSING: 1,
  ABORTING: 2,
  COMPLETE: 3,
  FAILED: 3,
  PARTIAL: 3,
  SKIPPED: 3,
};

export function jobStatusToPhase(status: JobStatus): OpsPhase {
  switch (status) {
    case "queued":
      return "AWAITING";
    case "running":
      return "COMPRESSING";
    case "completed":
      return "COMPLETE";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "FAILED";
    case "skipped":
      return "SKIPPED";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function rowFromJobInfo(job: JobInfo): ProgressRow {
  const phase = jobStatusToPhase(job.status);
  const failed = phase === "FAILED";
  return {
    jobId: job.id,
    sourcePath: job.sourcePath,
    mediaKind: job.mediaKind,
    presetId: job.presetId,
    phase,
    percent: job.percent,
    bytesTotal: job.originalBytes,
    originalBytes: job.originalBytes,
    resultBytes: job.resultBytes,
    outputPath: failed ? undefined : job.outputPath,
    durationMs: job.durationMs,
    error: job.error ? normalizeOpsError(job.error) : job.error,
  };
}

function placeholderRow(jobId: string): ProgressRow {
  return {
    jobId,
    sourcePath: "—",
    mediaKind: "",
    presetId: "",
    phase: "AWAITING",
    percent: 0,
  };
}

/** Prefer stall watchdog reason over cancel's generic "cancelled". */
function mergeOpsError(
  existing: string | undefined,
  incoming: string | undefined,
): string | undefined {
  if (
    existing === ENCODER_STALL_ERROR &&
    (incoming === undefined || incoming === "cancelled")
  ) {
    return ENCODER_STALL_ERROR;
  }
  return incoming ?? existing;
}

/** Merge JobInfo into an existing row without regressing event-driven progress. */
export function mergeJobRow(
  existing: ProgressRow,
  fromJob: ProgressRow,
): ProgressRow {
  const keepEventPhase = PHASE_RANK[existing.phase] > PHASE_RANK[fromJob.phase];
  const phase = keepEventPhase ? existing.phase : fromJob.phase;
  // FAILED must never retain a prior success outputPath (`??` would keep it).
  const outputPath =
    phase === "FAILED"
      ? undefined
      : (fromJob.outputPath ?? existing.outputPath);
  return {
    ...existing,
    ...fromJob,
    sourcePath: fromJob.sourcePath || existing.sourcePath,
    mediaKind: fromJob.mediaKind || existing.mediaKind,
    presetId: fromJob.presetId || existing.presetId,
    phase,
    percent: Math.max(existing.percent, fromJob.percent),
    bytesProcessed: fromJob.bytesProcessed ?? existing.bytesProcessed,
    bytesTotal: fromJob.bytesTotal ?? existing.bytesTotal,
    outputPath,
    originalBytes: fromJob.originalBytes ?? existing.originalBytes,
    resultBytes: fromJob.resultBytes ?? existing.resultBytes,
    durationMs: fromJob.durationMs ?? existing.durationMs,
    error: mergeOpsError(existing.error, fromJob.error),
    // JobInfo-derived rows omit batchGeneration — keep the admit tag.
    batchGeneration: existing.batchGeneration ?? fromJob.batchGeneration,
  };
}

export function upsertJob(rows: ProgressRow[], job: JobInfo): ProgressRow[] {
  const next = rowFromJobInfo(job);
  const idx = rows.findIndex((r) => r.jobId === job.id);
  if (idx === -1) return [...rows, next];
  const copy = rows.slice();
  copy[idx] = mergeJobRow(rows[idx], next);
  return copy;
}

export function markAborting(
  rows: ProgressRow[],
  jobIds: string[],
): ProgressRow[] {
  if (jobIds.length === 0) return rows;
  const set = new Set(jobIds);
  return rows.map((row) =>
    set.has(row.jobId) &&
    (row.phase === "AWAITING" || row.phase === "COMPRESSING")
      ? { ...row, phase: "ABORTING" }
      : row,
  );
}

export function markFailed(
  rows: ProgressRow[],
  jobId: string,
  error: string,
  options?: { cleanupPending?: boolean },
): ProgressRow[] {
  const terse = normalizeOpsError(error);
  const idx = rows.findIndex((r) => r.jobId === jobId);
  // Unknown ids stay unknown — never invent a placeholder FAILED row.
  if (idx === -1) return rows;
  const copy = rows.slice();
  copy[idx] = {
    ...rows[idx],
    phase: "FAILED",
    error: terse,
    outputPath: undefined,
    ...(options?.cleanupPending ? { cleanupPending: true } : {}),
  };
  return copy;
}

function isTerminalPhase(phase: OpsPhase): boolean {
  return phase === "COMPLETE" || phase === "FAILED" || phase === "SKIPPED";
}

function rejectMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * True when compress_cancel returned for a job that was already running — the
 * worker still owns StagingCleanup and will emit Failed after release. Keep
 * ABORTING (RETRY gated) until that event; queued-only cancels never emit.
 */
export function awaitFailedEventAfterCancel(
  phaseAtCancel: OpsPhase | undefined,
): boolean {
  return phaseAtCancel === "COMPRESSING" || phaseAtCancel === "ABORTING";
}

/** Apply compress_cancel PromiseSettled results — never leave rows stuck in ABORTING. */
export function applyCancelResults(
  rows: ProgressRow[],
  ids: string[],
  results: PromiseSettledResult<JobInfo>[],
  /** Phase before markAborting; running jobs stay ABORTING until Failed event. */
  phasesAtCancel?: ReadonlyMap<string, OpsPhase>,
): ProgressRow[] {
  let next = rows;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const result = results[i];
    if (!result) continue;
    if (result.status === "fulfilled") {
      const existing = next.find((r) => r.jobId === id);
      // Event already terminalized (e.g. Failed after cleanup) — don't clobber.
      if (existing && isTerminalPhase(existing.phase)) continue;
      if (
        phasesAtCancel &&
        awaitFailedEventAfterCancel(phasesAtCancel.get(id))
      ) {
        // Still cleaning up reserved/.partial — leave ABORTING for RETRY gate.
        continue;
      }
      next = upsertJob(next, result.value);
    } else {
      const existing = next.find((r) => r.jobId === id);
      // Cancel often rejects with "job already finished" after Complete/Failed;
      // do not clobber a correct terminal phase.
      if (existing && isTerminalPhase(existing.phase)) continue;
      next = markFailed(next, id, rejectMessage(result.reason));
    }
  }
  return next;
}

/**
 * Surface error for abortAll: only real cancel failures on still-active/ABORTING
 * rows. Ignore "job already finished" (and similar) when the row is already terminal.
 */
export function abortSurfaceErrorFromCancelResults(
  rows: ProgressRow[],
  ids: string[],
  results: PromiseSettledResult<JobInfo>[],
): string | null {
  for (let i = 0; i < ids.length; i++) {
    const result = results[i];
    if (!result || result.status !== "rejected") continue;
    const existing = rows.find((r) => r.jobId === ids[i]);
    if (existing && isTerminalPhase(existing.phase)) continue;
    return rejectMessage(result.reason);
  }
  return null;
}

export function applyCompressEvent(
  rows: ProgressRow[],
  event: CompressEvent,
  ignoredJobIds?: ReadonlySet<string>,
): ProgressRow[] {
  // DISMISS/RETRY/admit tombstones — never rehydrate dropped FAILED rows.
  if (ignoredJobIds?.has(event.jobId)) return rows;

  let working = rows;
  let idx = working.findIndex((r) => r.jobId === event.jobId);
  if (idx === -1) {
    if (event.type === "log") return rows;
    working = [...rows, placeholderRow(event.jobId)];
    idx = working.length - 1;
  }
  const row = working[idx];
  const copy = working.slice();

  switch (event.type) {
    case "progress": {
      // Abandoned encoders can still flush progress after Failed/Complete —
      // never reopen a terminal row into COMPRESSING.
      if (isTerminalPhase(row.phase)) {
        return working;
      }
      if (row.phase === "ABORTING") {
        copy[idx] = {
          ...row,
          percent: event.percent,
          bytesProcessed: event.bytesProcessed,
          bytesTotal: event.bytesTotal ?? row.bytesTotal,
        };
        return copy;
      }
      copy[idx] = {
        ...row,
        phase: "COMPRESSING",
        percent: event.percent,
        bytesProcessed: event.bytesProcessed,
        bytesTotal: event.bytesTotal ?? row.bytesTotal,
      };
      return copy;
    }
    case "log":
      return working;
    case "complete":
      // Complete may win over ABORTING (cancel raced with a finished encode).
      // Do not overwrite FAILED/SKIPPED/COMPLETE — late complete after failure
      // must not resurrect a success path.
      if (
        row.phase === "FAILED" ||
        row.phase === "SKIPPED" ||
        row.phase === "COMPLETE"
      ) {
        return working;
      }
      copy[idx] = {
        ...row,
        phase: "COMPLETE",
        percent: 100,
        outputPath: event.outputPath,
        originalBytes: event.originalBytes,
        resultBytes: event.resultBytes,
        durationMs: event.durationMs,
        bytesProcessed: event.resultBytes,
        bytesTotal: event.originalBytes,
        error: undefined,
        cleanupPending: undefined,
      };
      return copy;
    case "failed": {
      const incoming = normalizeOpsError(event.error);
      // Stall watchdog cancel emits Failed{"cancelled"} after cleanup — keep
      // the stall reason if the UI already labeled it (or caller remapped).
      const error = mergeOpsError(row.error, incoming) ?? incoming;
      copy[idx] = {
        ...row,
        phase: "FAILED",
        error,
        // Incomplete / reserved outputs are never success paths.
        outputPath: undefined,
        // Real Failed after staging cleanup — RETRY may proceed.
        cleanupPending: undefined,
      };
      return copy;
    }
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function deriveOpsPhase(rows: ProgressRow[]): OpsPhase {
  if (rows.length === 0) return "AWAITING";
  if (rows.some((r) => r.phase === "ABORTING")) return "ABORTING";
  if (rows.some((r) => r.phase === "COMPRESSING" || r.phase === "AWAITING")) {
    return "COMPRESSING";
  }
  const hasFail = rows.some((r) => r.phase === "FAILED");
  const hasOk = rows.some((r) => r.phase === "COMPLETE");
  if (hasFail && hasOk) return "PARTIAL";
  if (hasFail) return "FAILED";
  if (rows.every((r) => r.phase === "SKIPPED")) return "SKIPPED";
  if (rows.some((r) => r.phase === "SKIPPED") && !hasOk) {
    return "SKIPPED";
  }
  return "COMPLETE";
}

export function activeJobIds(rows: ProgressRow[]): string[] {
  return rows
    .filter(
      (r) =>
        r.phase === "AWAITING" ||
        r.phase === "COMPRESSING" ||
        r.phase === "ABORTING",
    )
    .map((r) => r.jobId);
}

export function formatByteMeter(
  processed: number | undefined,
  total: number | undefined,
  formatBytes: (n: number) => string,
): string {
  if (total === undefined) return "—";
  const done = processed ?? 0;
  return `${formatBytes(done)} / ${formatBytes(total)}`;
}

export function sizeDeltaLabel(
  original: number | undefined,
  result: number | undefined,
  formatBytes: (n: number) => string,
): string | null {
  if (original === undefined || result === undefined) return null;
  const delta = original - result;
  if (delta >= 0) return `−${formatBytes(delta)}`;
  return `+${formatBytes(-delta)}`;
}

import type { CompressEvent, JobInfo, JobStatus } from "../ipc/compress";

/** Operational phase shown on the live HUD strip. */
export type OpsPhase =
  | "AWAITING"
  | "COMPRESSING"
  | "COMPLETE"
  | "FAILED"
  | "ABORTING";

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
};

const PHASE_RANK: Record<OpsPhase, number> = {
  AWAITING: 0,
  COMPRESSING: 1,
  ABORTING: 2,
  COMPLETE: 3,
  FAILED: 3,
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
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function rowFromJobInfo(job: JobInfo): ProgressRow {
  return {
    jobId: job.id,
    sourcePath: job.sourcePath,
    mediaKind: job.mediaKind,
    presetId: job.presetId,
    phase: jobStatusToPhase(job.status),
    percent: job.percent,
    bytesTotal: job.originalBytes,
    originalBytes: job.originalBytes,
    resultBytes: job.resultBytes,
    outputPath: job.outputPath,
    durationMs: job.durationMs,
    error: job.error,
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

/** Merge JobInfo into an existing row without regressing event-driven progress. */
export function mergeJobRow(
  existing: ProgressRow,
  fromJob: ProgressRow,
): ProgressRow {
  const keepEventPhase = PHASE_RANK[existing.phase] > PHASE_RANK[fromJob.phase];
  return {
    ...existing,
    ...fromJob,
    sourcePath: fromJob.sourcePath || existing.sourcePath,
    mediaKind: fromJob.mediaKind || existing.mediaKind,
    presetId: fromJob.presetId || existing.presetId,
    phase: keepEventPhase ? existing.phase : fromJob.phase,
    percent: Math.max(existing.percent, fromJob.percent),
    bytesProcessed: fromJob.bytesProcessed ?? existing.bytesProcessed,
    bytesTotal: fromJob.bytesTotal ?? existing.bytesTotal,
    outputPath: fromJob.outputPath ?? existing.outputPath,
    originalBytes: fromJob.originalBytes ?? existing.originalBytes,
    resultBytes: fromJob.resultBytes ?? existing.resultBytes,
    durationMs: fromJob.durationMs ?? existing.durationMs,
    error: fromJob.error ?? existing.error,
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
): ProgressRow[] {
  const idx = rows.findIndex((r) => r.jobId === jobId);
  if (idx === -1) {
    return [
      ...rows,
      {
        ...placeholderRow(jobId),
        phase: "FAILED",
        error,
      },
    ];
  }
  const copy = rows.slice();
  copy[idx] = { ...rows[idx], phase: "FAILED", error };
  return copy;
}

function isTerminalPhase(phase: OpsPhase): boolean {
  return phase === "COMPLETE" || phase === "FAILED";
}

/** Apply compress_cancel PromiseSettled results — never leave rows stuck in ABORTING. */
export function applyCancelResults(
  rows: ProgressRow[],
  ids: string[],
  results: PromiseSettledResult<JobInfo>[],
): ProgressRow[] {
  let next = rows;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const result = results[i];
    if (!result) continue;
    if (result.status === "fulfilled") {
      next = upsertJob(next, result.value);
    } else {
      const existing = next.find((r) => r.jobId === id);
      // Cancel often rejects with "job already finished" after Complete/Failed;
      // do not clobber a correct terminal phase.
      if (existing && isTerminalPhase(existing.phase)) continue;
      const reason = result.reason;
      const message =
        reason instanceof Error ? reason.message : String(reason);
      next = markFailed(next, id, message);
    }
  }
  return next;
}

export function applyCompressEvent(
  rows: ProgressRow[],
  event: CompressEvent,
): ProgressRow[] {
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
      };
      return copy;
    case "failed":
      copy[idx] = {
        ...row,
        phase: "FAILED",
        error: event.error,
      };
      return copy;
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
  if (rows.some((r) => r.phase === "FAILED")) return "FAILED";
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

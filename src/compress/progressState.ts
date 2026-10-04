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

export function upsertJob(rows: ProgressRow[], job: JobInfo): ProgressRow[] {
  const next: ProgressRow = {
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
  const idx = rows.findIndex((r) => r.jobId === job.id);
  if (idx === -1) return [...rows, next];
  const copy = rows.slice();
  copy[idx] = { ...rows[idx], ...next };
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

export function applyCompressEvent(
  rows: ProgressRow[],
  event: CompressEvent,
): ProgressRow[] {
  const idx = rows.findIndex((r) => r.jobId === event.jobId);
  if (idx === -1) return rows;
  const row = rows[idx];
  const copy = rows.slice();

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
      return rows;
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

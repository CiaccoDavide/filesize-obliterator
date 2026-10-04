import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createBatchAdmissionController,
  runSequentialAdmit,
} from "../compress/batchAdmission";
import {
  buildBatchSummary,
  dismissFailedRows,
  ENCODER_STALL_ERROR,
  ENCODER_STALL_MS,
  failedRowsForRetry,
  normalizeOpsError,
  stalledJobIds,
  type BatchSummary,
} from "../compress/batchSummary";
import {
  abortSurfaceErrorFromCancelResults,
  activeJobIds,
  applyCancelResults,
  applyCompressEvent,
  deriveOpsPhase,
  markAborting,
  markFailed,
  upsertJob,
  type OpsPhase,
  type ProgressRow,
} from "../compress/progressState";
import {
  compressCancel,
  compressStart,
  listenCompressEvents,
  type MediaKind,
} from "../ipc/compress";
import type { StagedFile } from "../intake/types";

export type StartStagedOptions = {
  stripMetadata?: boolean;
};

function cancelableActiveIds(rows: ProgressRow[]): string[] {
  return activeJobIds(rows).filter((id) => {
    const row = rows.find((r) => r.jobId === id);
    return row != null && row.phase !== "ABORTING";
  });
}

function errorMessage(err: unknown): string {
  return normalizeOpsError(err instanceof Error ? err.message : String(err));
}

function asMediaKind(kind: string): MediaKind | null {
  if (
    kind === "image" ||
    kind === "audio" ||
    kind === "video" ||
    kind === "pdf"
  ) {
    return kind;
  }
  return null;
}

type AdmitTarget = {
  path: string;
  kind: MediaKind;
  presetId: string;
};

export function useCompressProgress() {
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const admissionRef = useRef(createBatchAdmissionController());
  /** Jobs admitted by the current startStaged; abortAll always cancels these. */
  const admittedIdsRef = useRef<Set<string>>(new Set());
  const lastActivityRef = useRef<Map<string, number>>(new Map());
  /** Stall cancels in flight — avoid double-cancel before ABORTING is committed. */
  const stallCancelInFlightRef = useRef<Set<string>>(new Set());
  /** Jobs cancelled by the stall watchdog — remap Failed{"cancelled"} to stall reason. */
  const stallLabeledIdsRef = useRef<Set<string>>(new Set());
  const lastOptionsRef = useRef<StartStagedOptions>({});
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const touchActivity = useCallback((jobId: string) => {
    lastActivityRef.current.set(jobId, Date.now());
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function subscribe() {
      try {
        unlisten = await listenCompressEvents((event) => {
          if (cancelled) return;
          touchActivity(event.jobId);
          setRows((prev) => {
            let ev = event;
            if (
              ev.type === "failed" &&
              stallLabeledIdsRef.current.has(ev.jobId)
            ) {
              stallLabeledIdsRef.current.delete(ev.jobId);
              if (normalizeOpsError(ev.error) === "cancelled") {
                ev = { ...ev, error: ENCODER_STALL_ERROR };
              }
            }
            return applyCompressEvent(prev, ev);
          });
        });
      } catch {
        // Vite-only / non-Tauri: event bus unavailable.
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [touchActivity]);

  // Stall watchdog — cancel silent video jobs so reserved paths/.partial clean up.
  // Keep ABORTING until Failed (after StagingCleanup) so RETRY stays off.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const stalled = stalledJobIds(
        rowsRef.current,
        lastActivityRef.current,
        Date.now(),
        ENCODER_STALL_MS,
      ).filter((id) => !stallCancelInFlightRef.current.has(id));
      if (stalled.length === 0) return;

      const phasesAtCancel = new Map<string, OpsPhase>();
      for (const id of stalled) {
        stallCancelInFlightRef.current.add(id);
        stallLabeledIdsRef.current.add(id);
        const row = rowsRef.current.find((r) => r.jobId === id);
        if (row) phasesAtCancel.set(id, row.phase);
      }
      setRows((prev) => markAborting(prev, stalled));

      void (async () => {
        try {
          const results = await Promise.allSettled(
            stalled.map((id) => compressCancel(id)),
          );
          setRows((prev) => {
            let next = applyCancelResults(
              prev,
              stalled,
              results,
              phasesAtCancel,
            );
            // Cancel reject: no Failed event — surface stall reason and clear label.
            for (let i = 0; i < stalled.length; i++) {
              const id = stalled[i];
              const result = results[i];
              if (!result || result.status !== "rejected") continue;
              stallLabeledIdsRef.current.delete(id);
              const row = next.find((r) => r.jobId === id);
              if (row?.phase === "FAILED") {
                next = markFailed(next, id, ENCODER_STALL_ERROR);
              }
            }
            return next;
          });
        } finally {
          for (const id of stalled) stallCancelInFlightRef.current.delete(id);
        }
      })();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  const phase = useMemo(() => deriveOpsPhase(rows), [rows]);
  const batchSummary: BatchSummary | null = useMemo(
    () => buildBatchSummary(rows),
    [rows],
  );
  const canAbort = useMemo(
    () =>
      rows.some(
        (r) =>
          r.phase === "AWAITING" ||
          r.phase === "COMPRESSING" ||
          r.phase === "ABORTING",
      ) || starting,
    [rows, starting],
  );
  const aborting = phase === "ABORTING";
  const canRetryFailed = useMemo(
    () => failedRowsForRetry(rows).length > 0 && !canAbort && !starting,
    [rows, canAbort, starting],
  );
  const canDismissFailed = useMemo(
    () => rows.some((r) => r.phase === "FAILED") && !canAbort && !starting,
    [rows, canAbort, starting],
  );

  const admitTargets = useCallback(
    async (targets: AdmitTarget[], options?: StartStagedOptions) => {
      if (targets.length === 0) {
        setError("NO PRESET — select an alternative");
        return;
      }
      lastOptionsRef.current = options ?? lastOptionsRef.current;
      const token = admissionRef.current.begin();
      admittedIdsRef.current = new Set();
      setStarting(true);
      setError(null);
      try {
        await runSequentialAdmit(targets, {
          isCurrent: () => admissionRef.current.isCurrent(token),
          start: (file) =>
            compressStart({
              sourcePath: file.path,
              mediaKind: file.kind,
              presetId: file.presetId,
              stripMetadata: lastOptionsRef.current.stripMetadata,
            }),
          onAdmitted: (job) => {
            admittedIdsRef.current.add(job.id);
            touchActivity(job.id);
            setRows((prev) => upsertJob(prev, job));
          },
          onLateAdmit: (job) => {
            void compressCancel(job.id).catch(() => {
              /* best-effort: batch already aborted */
            });
          },
          onStartError: (file, err) => {
            const message = errorMessage(err);
            setError(message);
            setRows((prev) => [
              ...prev,
              {
                jobId: `admit-failed:${file.path}:${Date.now()}`,
                sourcePath: file.path,
                mediaKind: file.kind,
                presetId: file.presetId,
                phase: "FAILED",
                percent: 0,
                error: message,
              },
            ]);
          },
        });
      } catch (err: unknown) {
        setError(errorMessage(err));
      } finally {
        setStarting(false);
      }
    },
    [touchActivity],
  );

  const startStaged = useCallback(
    async (files: StagedFile[], options?: StartStagedOptions) => {
      const ready = files
        .filter((f) => f.presetId)
        .map((f) => ({
          path: f.path,
          kind: f.kind,
          presetId: f.presetId,
        }));
      await admitTargets(ready, options);
    },
    [admitTargets],
  );

  const retryFailed = useCallback(async () => {
    const candidates = failedRowsForRetry(rowsRef.current);
    const targets: AdmitTarget[] = [];
    for (const c of candidates) {
      const kind = asMediaKind(c.mediaKind);
      if (!kind || !c.presetId) continue;
      targets.push({
        path: c.sourcePath,
        kind,
        presetId: c.presetId,
      });
    }
    if (targets.length === 0) {
      setError("RETRY FAILED — no retryable items");
      return;
    }
    // Drop failed rows first so successes stay and new job ids replace failures.
    setRows((prev) => dismissFailedRows(prev));
    await admitTargets(targets, lastOptionsRef.current);
  }, [admitTargets]);

  const dismissFailed = useCallback(() => {
    setRows((prev) => dismissFailedRows(prev));
    setError(null);
  }, []);

  const abortAll = useCallback(async () => {
    // Invalidate any in-flight startStaged so it stops admitting further files.
    admissionRef.current.abort();

    // Union of HUD rows + admission-tracked ids so a job upserted during abort
    // (empty rows at setState time) is still cancelled.
    let ids: string[] = [];
    const phasesAtCancel = new Map<string, OpsPhase>();
    setRows((prev) => {
      const fromRows = cancelableActiveIds(prev);
      ids = [...new Set([...fromRows, ...admittedIdsRef.current])];
      for (const id of ids) {
        phasesAtCancel.set(
          id,
          prev.find((r) => r.jobId === id)?.phase ?? "AWAITING",
        );
      }
      return ids.length === 0 ? prev : markAborting(prev, ids);
    });
    for (const id of admittedIdsRef.current) {
      if (!ids.includes(id)) {
        ids.push(id);
        if (!phasesAtCancel.has(id)) phasesAtCancel.set(id, "AWAITING");
      }
    }
    if (ids.length === 0) return;

    setError(null);
    const results = await Promise.allSettled(
      ids.map((id) => compressCancel(id)),
    );
    let surfaceError: string | null = null;
    setRows((prev) => {
      surfaceError = abortSurfaceErrorFromCancelResults(prev, ids, results);
      return applyCancelResults(prev, ids, results, phasesAtCancel);
    });
    if (surfaceError) setError(normalizeOpsError(surfaceError));
  }, []);

  const cancelOne = useCallback(async (jobId: string) => {
    const row = rowsRef.current.find((r) => r.jobId === jobId);
    if (
      !row ||
      row.phase === "COMPLETE" ||
      row.phase === "FAILED" ||
      row.phase === "ABORTING"
    ) {
      return;
    }
    const phasesAtCancel = new Map<string, OpsPhase>([[jobId, row.phase]]);
    setRows((prev) => markAborting(prev, [jobId]));
    setError(null);
    const results = await Promise.allSettled([compressCancel(jobId)]);
    let surfaceError: string | null = null;
    setRows((prev) => {
      surfaceError = abortSurfaceErrorFromCancelResults(prev, [jobId], results);
      return applyCancelResults(prev, [jobId], results, phasesAtCancel);
    });
    if (surfaceError) setError(normalizeOpsError(surfaceError));
  }, []);

  /** Clears finished HUD rows only — never deletes on-disk `_compressed` outputs. */
  const clearFinished = useCallback(() => {
    setRows((prev) =>
      prev.filter((r) => r.phase !== "COMPLETE" && r.phase !== "FAILED"),
    );
  }, []);

  return {
    rows,
    phase,
    batchSummary,
    error,
    starting,
    canAbort,
    aborting,
    canRetryFailed,
    canDismissFailed,
    startStaged,
    retryFailed,
    dismissFailed,
    abortAll,
    cancelOne,
    clearFinished,
  };
}

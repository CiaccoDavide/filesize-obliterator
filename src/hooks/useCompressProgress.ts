import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createBatchAdmissionController,
  runSequentialAdmit,
} from "../compress/batchAdmission";
import {
  abortSurfaceErrorFromCancelResults,
  activeJobIds,
  applyCancelResults,
  applyCompressEvent,
  deriveOpsPhase,
  markAborting,
  upsertJob,
  type ProgressRow,
} from "../compress/progressState";
import {
  compressCancel,
  compressStart,
  listenCompressEvents,
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
  return err instanceof Error ? err.message : String(err);
}

export function useCompressProgress() {
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const admissionRef = useRef(createBatchAdmissionController());
  /** Jobs admitted by the current startStaged; abortAll always cancels these. */
  const admittedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function subscribe() {
      try {
        unlisten = await listenCompressEvents((event) => {
          if (cancelled) return;
          setRows((prev) => applyCompressEvent(prev, event));
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
  }, []);

  const phase = useMemo(() => deriveOpsPhase(rows), [rows]);
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

  const startStaged = useCallback(
    async (files: StagedFile[], options?: StartStagedOptions) => {
      const ready = files.filter((f) => f.presetId);
      if (ready.length === 0) {
        setError("NO PRESET — select an alternative");
        return;
      }
      const token = admissionRef.current.begin();
      admittedIdsRef.current = new Set();
      setStarting(true);
      setError(null);
      try {
        await runSequentialAdmit(ready, {
          isCurrent: () => admissionRef.current.isCurrent(token),
          start: (file) =>
            compressStart({
              sourcePath: file.path,
              mediaKind: file.kind,
              presetId: file.presetId,
              stripMetadata: options?.stripMetadata,
            }),
          onAdmitted: (job) => {
            admittedIdsRef.current.add(job.id);
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
                jobId: `admit-failed:${file.path}`,
                sourcePath: file.path,
                mediaKind: file.kind,
                presetId: file.presetId ?? "",
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
    [],
  );

  const abortAll = useCallback(async () => {
    // Invalidate any in-flight startStaged so it stops admitting further files.
    admissionRef.current.abort();

    // Union of HUD rows + admission-tracked ids so a job upserted during abort
    // (empty rows at setState time) is still cancelled.
    let ids: string[] = [];
    setRows((prev) => {
      const fromRows = cancelableActiveIds(prev);
      ids = [...new Set([...fromRows, ...admittedIdsRef.current])];
      return ids.length === 0 ? prev : markAborting(prev, ids);
    });
    for (const id of admittedIdsRef.current) {
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length === 0) return;

    setError(null);
    const results = await Promise.allSettled(
      ids.map((id) => compressCancel(id)),
    );
    let surfaceError: string | null = null;
    setRows((prev) => {
      surfaceError = abortSurfaceErrorFromCancelResults(prev, ids, results);
      return applyCancelResults(prev, ids, results);
    });
    if (surfaceError) setError(surfaceError);
  }, []);

  const cancelOne = useCallback(async (jobId: string) => {
    const row = rows.find((r) => r.jobId === jobId);
    if (
      !row ||
      row.phase === "COMPLETE" ||
      row.phase === "FAILED" ||
      row.phase === "ABORTING"
    ) {
      return;
    }
    setRows((prev) => markAborting(prev, [jobId]));
    setError(null);
    const results = await Promise.allSettled([compressCancel(jobId)]);
    let surfaceError: string | null = null;
    setRows((prev) => {
      surfaceError = abortSurfaceErrorFromCancelResults(prev, [jobId], results);
      return applyCancelResults(prev, [jobId], results);
    });
    if (surfaceError) setError(surfaceError);
  }, [rows]);

  /** Clears finished HUD rows only — never deletes on-disk `_compressed` outputs. */
  const clearFinished = useCallback(() => {
    setRows((prev) =>
      prev.filter(
        (r) => r.phase !== "COMPLETE" && r.phase !== "FAILED",
      ),
    );
  }, []);

  return {
    rows,
    phase,
    error,
    starting,
    canAbort,
    aborting,
    startStaged,
    abortAll,
    cancelOne,
    clearFinished,
  };
}

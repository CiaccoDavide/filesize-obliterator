import { useCallback, useEffect, useMemo, useState } from "react";
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

export function useCompressProgress() {
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

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
      ),
    [rows],
  );
  const aborting = phase === "ABORTING";

  const startStaged = useCallback(
    async (files: StagedFile[], options?: StartStagedOptions) => {
      const ready = files.filter((f) => f.presetId);
      if (ready.length === 0) {
        setError("NO PRESET — select an alternative");
        return;
      }
      setStarting(true);
      setError(null);
      try {
        for (const file of ready) {
          const job = await compressStart({
            sourcePath: file.path,
            mediaKind: file.kind,
            presetId: file.presetId,
            stripMetadata: options?.stripMetadata,
          });
          setRows((prev) => upsertJob(prev, job));
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setStarting(false);
      }
    },
    [],
  );

  const abortAll = useCallback(async () => {
    const ids = activeJobIds(rows).filter((id) => {
      const row = rows.find((r) => r.jobId === id);
      return row && row.phase !== "ABORTING";
    });
    if (ids.length === 0) return;
    setRows((prev) => markAborting(prev, ids));
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
  }, [rows]);

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

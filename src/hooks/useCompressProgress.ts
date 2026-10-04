import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activeJobIds,
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

const STUB_PRESET = "stub";

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

  const startStaged = useCallback(async (files: StagedFile[]) => {
    if (files.length === 0) return;
    setStarting(true);
    setError(null);
    try {
      for (const file of files) {
        const job = await compressStart({
          sourcePath: file.path,
          mediaKind: file.kind,
          presetId: STUB_PRESET,
        });
        setRows((prev) => upsertJob(prev, job));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, []);

  const abortAll = useCallback(async () => {
    const ids = activeJobIds(rows).filter((id) => {
      const row = rows.find((r) => r.jobId === id);
      return row && row.phase !== "ABORTING";
    });
    if (ids.length === 0) return;
    setRows((prev) => markAborting(prev, ids));
    setError(null);
    try {
      await Promise.all(ids.map((id) => compressCancel(id)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [rows]);

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
    clearFinished,
  };
}

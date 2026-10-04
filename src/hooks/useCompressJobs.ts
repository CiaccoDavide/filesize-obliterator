import { useCallback, useState } from "react";
import { compressStart, type JobInfo } from "../ipc/compress";
import type { StagedFile } from "../intake/types";

export type CompressJobsStatus =
  | "idle"
  | "starting"
  | "started"
  | "error";

/**
 * Minimal start path: fire compress_start per staged file with its presetId.
 * Live progress panel lives in a separate PR — keep this thin.
 */
export type StartStagedOptions = {
  stripMetadata?: boolean;
};

export function useCompressJobs() {
  const [status, setStatus] = useState<CompressJobsStatus>("idle");
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const startStaged = useCallback(
    async (files: StagedFile[], options?: StartStagedOptions) => {
      const ready = files.filter((f) => f.presetId);
      if (ready.length === 0) {
        setError("NO PRESET — select an alternative");
        setStatus("error");
        return;
      }
      setStatus("starting");
      setError(null);
      const started: JobInfo[] = [];
      try {
        for (const file of ready) {
          const job = await compressStart({
            sourcePath: file.path,
            mediaKind: file.kind,
            presetId: file.presetId,
            stripMetadata: options?.stripMetadata,
          });
          started.push(job);
        }
        setJobs(started);
        setStatus("started");
      } catch (err: unknown) {
        setJobs(started);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [],
  );

  return {
    status,
    jobs,
    error,
    startStaged,
  };
}

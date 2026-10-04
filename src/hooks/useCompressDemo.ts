import { useEffect, useState } from "react";
import {
  compressStart,
  listenCompressEvents,
  type CompressEvent,
  type JobInfo,
} from "../ipc/compress";

/**
 * Minimal smoke hook: starts one stub job against a path the caller supplies.
 * Live UI polish belongs to the Ice HUD work — this only proves IPC wiring.
 */
export function useCompressDemo(sourcePath: string | null) {
  const [job, setJob] = useState<JobInfo | null>(null);
  const [lastEvent, setLastEvent] = useState<CompressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function run() {
      if (!sourcePath) return;
      try {
        unlisten = await listenCompressEvents((event) => {
          if (!cancelled) setLastEvent(event);
        });
        const started = await compressStart({
          sourcePath,
          mediaKind: "image",
          presetId: "stub",
        });
        if (!cancelled) setJob(started);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sourcePath]);

  return { job, lastEvent, error };
}

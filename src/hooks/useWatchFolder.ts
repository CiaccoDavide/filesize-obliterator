import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  listenWatchEvents,
  watchStart,
  watchStop,
  type WatchEvent,
} from "../ipc/watch";
import { createWatchReadyGate } from "../watch/readyGate";
import { watchHudStatus } from "../watch/status";

export type WatchReadyFile = {
  path: string;
  bytes: number;
};

type Options = {
  /** Called when a size-stable supported file is ready to enqueue. */
  onReady?: (file: WatchReadyFile) => void;
  /** Default false — only new files after enable. */
  includeExisting?: boolean;
};

/**
 * Session-local offline folder watch. Enable opens a directory picker;
 * disable / unmount stops the Rust watcher cleanly.
 */
export function useWatchFolder(options: Options = {}) {
  const { onReady, includeExisting = false } = options;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const includeExistingRef = useRef(includeExisting);
  includeExistingRef.current = includeExisting;
  const readyGateRef = useRef(createWatchReadyGate());

  const [watching, setWatching] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(async () => {
    // Disarm before join so a Ready already queued on the event channel
    // cannot call onReady after the operator disables watch.
    readyGateRef.current.disarm();
    try {
      await watchStop();
    } catch {
      // Best-effort — local state still clears.
    }
    setWatching(false);
    setPath(null);
  }, []);

  const startAt = useCallback(async (dir: string) => {
    setError(null);
    try {
      const status = await watchStart({
        path: dir,
        includeExisting: includeExistingRef.current,
      });
      readyGateRef.current.arm();
      setWatching(status.watching);
      setPath(status.path ?? dir);
    } catch (err: unknown) {
      readyGateRef.current.disarm();
      const message = err instanceof Error ? err.message : String(err);
      setError(`WATCH FAILED — ${message}`);
      setWatching(false);
      setPath(null);
    }
  }, []);

  const toggle = useCallback(async () => {
    if (watching) {
      await stop();
      return;
    }
    try {
      const selection = await open({
        directory: true,
        multiple: false,
      });
      if (selection === null) {
        setError(null);
        return;
      }
      const dir = Array.isArray(selection) ? selection[0] : selection;
      if (!dir) return;
      await startAt(dir);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`WATCH PICK FAILED — ${message}`);
    }
  }, [watching, stop, startAt]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const gate = readyGateRef.current;

    async function bind() {
      try {
        unlisten = await listenWatchEvents((event: WatchEvent) => {
          if (cancelled) return;
          if (event.type === "started") {
            gate.arm();
            setWatching(true);
            setPath(event.path);
            return;
          }
          if (event.type === "stopped") {
            gate.disarm();
            setWatching(false);
            setPath(null);
            return;
          }
          if (event.type === "ready") {
            if (!gate.shouldHandleReady()) return;
            onReadyRef.current?.({ path: event.path, bytes: event.bytes });
          }
        });
      } catch {
        // Vite-only / non-Tauri.
      }
    }

    void bind();
    return () => {
      cancelled = true;
      gate.disarm();
      unlisten?.();
      void watchStop().catch(() => {
        /* quit / unmount */
      });
    };
  }, []);

  const hudStatus = watchHudStatus({ watching, path });

  return {
    watching,
    path,
    error,
    hudStatus,
    toggle,
    stop,
  };
}

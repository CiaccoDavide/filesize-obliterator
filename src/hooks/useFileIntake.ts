import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { MediaKind } from "../ipc/compress";
import { intakeResolve } from "../ipc/intake";
import { stageResolvedPaths } from "../intake/stage";
import type { StagedFile } from "../intake/types";
import {
  applyKindPreset,
  withDefaultPresets,
  type PresetByKind,
} from "../presets/selection";

const DIALOG_FILTERS = [
  {
    name: "Media",
    extensions: [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "avif",
      "bmp",
      "tif",
      "tiff",
      "heic",
      "heif",
      "mp3",
      "aac",
      "m4a",
      "wav",
      "flac",
      "ogg",
      "opus",
      "wma",
      "aiff",
      "aif",
      "mp4",
      "mov",
      "mkv",
      "webm",
      "avi",
      "m4v",
      "mpeg",
      "mpg",
      "pdf",
    ],
  },
];

export function useFileIntake(presetByKind: PresetByKind = {}) {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [status, setStatus] = useState<string>("AWAITING INPUT");
  const [dragActive, setDragActive] = useState(false);

  const ingestPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      try {
        const resolved = await intakeResolve(paths);
        let nextStatus = "NO CHANGE";
        setStaged((prev) => {
          const result = stageResolvedPaths(prev, resolved, {}, { presetByKind });
          nextStatus = result.status;
          return result.staged;
        });
        setStatus(nextStatus);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`INTAKE FAILED — ${message}`);
      }
    },
    [presetByKind],
  );

  const pickFiles = useCallback(async () => {
    try {
      const selection = await open({
        multiple: true,
        directory: false,
        filters: DIALOG_FILTERS,
      });
      if (selection === null) {
        setStatus("PICK CANCELLED");
        return;
      }
      const paths = Array.isArray(selection) ? selection : [selection];
      await ingestPaths(paths);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`PICK FAILED — ${message}`);
    }
  }, [ingestPaths]);

  const clearStaged = useCallback(() => {
    setStaged([]);
    setStatus("CLEARED");
  }, []);

  const setKindPreset = useCallback((kind: MediaKind, presetId: string) => {
    setStaged((prev) => applyKindPreset(prev, kind, presetId));
  }, []);

  /** Fill blank presetIds after the backend catalog arrives. */
  const assignMissingPresets = useCallback((defaults: PresetByKind) => {
    setStaged((prev) => withDefaultPresets(prev, defaults));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function bindDrop() {
      try {
        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent((event) => {
          if (cancelled) return;
          const { type } = event.payload;
          if (type === "enter" || type === "over") {
            setDragActive(true);
            return;
          }
          if (type === "leave") {
            setDragActive(false);
            return;
          }
          if (type === "drop") {
            setDragActive(false);
            void ingestPaths(event.payload.paths);
          }
        });
      } catch {
        // Vite-only / non-Tauri: drop binding unavailable.
      }
    }

    void bindDrop();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ingestPaths]);

  return {
    staged,
    status,
    dragActive,
    pickFiles,
    clearStaged,
    ingestPaths,
    setKindPreset,
    assignMissingPresets,
  };
}

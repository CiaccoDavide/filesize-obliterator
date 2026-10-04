import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { MediaKind } from "../ipc/compress";
import {
  settingsLoad,
  settingsSave,
  settingsSetConcurrency,
} from "../ipc/settings";
import {
  clampConcurrency,
  defaultSettings,
  type AppSettings,
  type UiDensity,
  type WindowSize,
} from "../settings/schema";

const SAVE_DEBOUNCE_MS = 350;

export type LocalSettingsApi = {
  settings: AppSettings;
  loaded: boolean;
  /** Terse HUD status when load/save/concurrency apply fails. */
  status: string | null;
  setConcurrency: (n: number) => void;
  setStripMetadata: (on: boolean) => void;
  setUiDensity: (density: UiDensity) => void;
  setDefaultPreset: (kind: MediaKind, presetId: string) => void;
  patch: (partial: Partial<AppSettings>) => void;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function terseError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  const s = String(err ?? "unknown").trim();
  return s || "unknown";
}

export function useLocalSettings(): LocalSettingsApi {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<AppSettings | null>(null);
  /** Bumped on every local edit; stale saves must not write disk or clobber UI. */
  const saveGeneration = useRef(0);
  /** Serialize disk writes so an older in-flight save cannot finish last. */
  const saveChain = useRef(Promise.resolve());
  const skipNextSave = useRef(true);

  const enqueueSave = useCallback((toSave: AppSettings, generation: number) => {
    saveChain.current = saveChain.current
      .catch(() => {
        // Keep the chain alive after a prior failure.
      })
      .then(async () => {
        if (generation !== saveGeneration.current) return;
        try {
          const saved = await settingsSave(toSave);
          if (generation !== saveGeneration.current) return;
          setSettings(saved);
          setStatus(null);
        } catch (err) {
          if (generation !== saveGeneration.current) return;
          setStatus(`SETTINGS SAVE FAILED — ${terseError(err)}`);
        }
      });
  }, []);

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const toSave = pendingSave.current;
    if (!toSave) return;
    pendingSave.current = null;
    enqueueSave(toSave, saveGeneration.current);
  }, [enqueueSave]);

  const scheduleSave = useCallback(
    (next: AppSettings) => {
      pendingSave.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const generation = saveGeneration.current;
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        const toSave = pendingSave.current;
        if (!toSave) return;
        pendingSave.current = null;
        enqueueSave(toSave, generation);
      }, SAVE_DEBOUNCE_MS);
    },
    [enqueueSave],
  );

  const commit = useCallback(
    (updater: (prev: AppSettings) => AppSettings) => {
      setSettings((prev) => {
        const next = updater(prev);
        if (!skipNextSave.current) {
          saveGeneration.current += 1;
          scheduleSave(next);
        }
        return next;
      });
    },
    [scheduleSave],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loadedSettings = await settingsLoad();
        if (cancelled) return;
        skipNextSave.current = true;
        setSettings(loadedSettings);
        setLoaded(true);
        setStatus(null);
        // Allow saves after the initial hydration paint.
        queueMicrotask(() => {
          skipNextSave.current = false;
        });

        if (loadedSettings.windowSize) {
          try {
            await getCurrentWindow().setSize(
              new LogicalSize(
                loadedSettings.windowSize.width,
                loadedSettings.windowSize.height,
              ),
            );
          } catch (err) {
            // Vite preview has no window host. In Tauri, ACL/runtime failures must surface.
            if (isTauriRuntime()) {
              console.error("Failed to restore window size", err);
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        skipNextSave.current = true;
        setSettings(defaultSettings());
        setLoaded(true);
        setStatus(`SETTINGS LOAD FAILED — ${terseError(err)}`);
        queueMicrotask(() => {
          skipNextSave.current = false;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      try {
        const win = getCurrentWindow();
        unlisten = await win.onResized(({ payload }) => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            void (async () => {
              try {
                const factor = await win.scaleFactor();
                const size: WindowSize = {
                  width: Math.round(payload.width / factor),
                  height: Math.round(payload.height / factor),
                };
                if (size.width < 400 || size.height < 400) return;
                commit((prev) => ({ ...prev, windowSize: size }));
              } catch {
                // ignore
              }
            })();
          }, 500);
        });
      } catch {
        // non-Tauri
      }
    })();

    const onHidden = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flushSave);

    return () => {
      unlisten?.();
      if (resizeTimer) clearTimeout(resizeTimer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flushSave);
      flushSave();
    };
  }, [commit, flushSave]);

  const setConcurrency = useCallback(
    (n: number) => {
      const concurrency = clampConcurrency(n);
      // Apply to JobManager immediately so the next run uses the new cap.
      void settingsSetConcurrency(concurrency)
        .then(() => {
          setStatus((prev) =>
            prev?.startsWith("CONCURRENCY APPLY FAILED") ? null : prev,
          );
        })
        .catch((err) => {
          setStatus(`CONCURRENCY APPLY FAILED — ${terseError(err)}`);
        });
      commit((prev) => ({ ...prev, concurrency }));
    },
    [commit],
  );

  const setStripMetadata = useCallback(
    (on: boolean) => {
      commit((prev) => ({ ...prev, stripMetadata: on }));
    },
    [commit],
  );

  const setUiDensity = useCallback(
    (density: UiDensity) => {
      commit((prev) => ({ ...prev, uiDensity: density }));
    },
    [commit],
  );

  const setDefaultPreset = useCallback(
    (kind: MediaKind, presetId: string) => {
      commit((prev) => ({
        ...prev,
        defaultPresets: { ...prev.defaultPresets, [kind]: presetId },
      }));
    },
    [commit],
  );

  const patch = useCallback(
    (partial: Partial<AppSettings>) => {
      commit((prev) => ({ ...prev, ...partial }));
    },
    [commit],
  );

  return {
    settings,
    loaded,
    status,
    setConcurrency,
    setStripMetadata,
    setUiDensity,
    setDefaultPreset,
    patch,
  };
}

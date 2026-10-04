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
  setPreferHardware: (on: boolean) => void;
  setNotifyOnComplete: (on: boolean) => void;
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
          settingsRef.current = saved;
          setSettings(saved);
          setStatus(null);
        } catch (err) {
          if (generation !== saveGeneration.current) return;
          setStatus(`SETTINGS SAVE FAILED — ${terseError(err)}`);
        }
      });
  }, []);

  const flushSave = useCallback((): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const toSave = pendingSave.current;
    if (toSave) {
      pendingSave.current = null;
      enqueueSave(toSave, saveGeneration.current);
    }
    // Await the serialized chain so quit/hide can wait for disk durability.
    return saveChain.current.then(
      () => undefined,
      () => undefined,
    );
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
      // Compute next + bump generation outside setState: StrictMode may
      // double-invoke updaters, which would double-schedule saves.
      const next = updater(settingsRef.current);
      settingsRef.current = next;
      setSettings(next);
      if (!skipNextSave.current) {
        saveGeneration.current += 1;
        scheduleSave(next);
      }
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
        settingsRef.current = loadedSettings;
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
        const fallback = defaultSettings();
        settingsRef.current = fallback;
        setSettings(fallback);
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
    let unlistenResize: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      try {
        const win = getCurrentWindow();
        unlistenResize = await win.onResized(({ payload }) => {
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
        // Await flush before destroy — Tauri runs destroy after the handler settles
        // unless preventDefault() was called.
        unlistenClose = await win.onCloseRequested(async () => {
          await flushSave();
        });
      } catch {
        // non-Tauri
      }
    })();

    const onHidden = () => {
      if (document.visibilityState === "hidden") void flushSave();
    };
    const onPageHide = () => {
      void flushSave();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      unlistenResize?.();
      unlistenClose?.();
      if (resizeTimer) clearTimeout(resizeTimer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      void flushSave();
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

  const setPreferHardware = useCallback(
    (on: boolean) => {
      commit((prev) => ({ ...prev, preferHardware: on }));
    },
    [commit],
  );

  const setNotifyOnComplete = useCallback(
    (on: boolean) => {
      commit((prev) => ({ ...prev, notifyOnComplete: on }));
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
    setPreferHardware,
    setNotifyOnComplete,
    setUiDensity,
    setDefaultPreset,
    patch,
  };
}

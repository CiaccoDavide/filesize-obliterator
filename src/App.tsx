import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CompressProgressPanel } from "./components/CompressProgressPanel";
import { EstimateSummaryStrip } from "./components/EstimateSummaryStrip";
import { FileDropZone } from "./components/FileDropZone";
import {
  ImageComparePreview,
  type ImageCompareTarget,
} from "./components/ImageComparePreview";
import { IntakeStatus } from "./components/IntakeStatus";
import { KeyboardHelpOverlay } from "./components/KeyboardHelpOverlay";
import { PresetPicker } from "./components/PresetPicker";
import { SettingsPanel } from "./components/SettingsPanel";
import { StagedFileList } from "./components/StagedFileList";
import type { ProgressRow } from "./compress/progressState";
import { useCompressEstimate } from "./hooks/useCompressEstimate";
import { useCompressProgress } from "./hooks/useCompressProgress";
import { useFileIntake } from "./hooks/useFileIntake";
import { useLocalSettings } from "./hooks/useLocalSettings";
import { usePresets } from "./hooks/usePresets";
import type { MediaKind } from "./ipc/compress";
import { revealInFileManager } from "./ipc/reveal";
import { useKeyboardShortcuts } from "./keyboard/useKeyboardShortcuts";
import type { RevealAction } from "./reveal/actions";
import { kindsPresent } from "./presets/selection";
import "./App.css";

type AppInfo = {
  name: string;
  version: string;
};

function statusTone(status: string): "ok" | "warn" | "danger" {
  if (
    status.startsWith("REJECTED") ||
    status.startsWith("INTAKE FAILED") ||
    status.startsWith("PICK FAILED")
  ) {
    return "danger";
  }
  if (
    status.startsWith("PICK CANCELLED") ||
    status.startsWith("ALREADY") ||
    status.startsWith("NO CHANGE") ||
    status === "PATH MISSING" ||
    status.startsWith("REVEAL FAILED")
  ) {
    return "warn";
  }
  return "ok";
}

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<ImageCompareTarget | null>(
    null,
  );
  /** When on, re-encode even if source+preset already has a `_compressed` output. */
  const [forceReencode, setForceReencode] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const local = useLocalSettings();
  const presets = usePresets({
    preferredDefaults: local.settings.defaultPresets,
    settingsReady: local.loaded,
  });
  const {
    staged,
    status,
    setStatus,
    dragActive,
    pickFiles,
    clearStaged,
    setKindPreset,
    assignMissingPresets,
  } = useFileIntake(presets.presetByKind);
  const compress = useCompressProgress();
  const estimate = useCompressEstimate();

  const focusDropZone = useCallback(() => {
    dropZoneRef.current?.focus();
    dropZoneRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const openSettings = useCallback(() => {
    const el = settingsRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.focus();
  }, []);

  const shortcutHandlers = useMemo(
    () => ({
      pickFiles: () => {
        void pickFiles();
      },
      startCompress: () => {
        if (compress.canAbort || compress.starting || staged.length === 0) return;
        void compress.startStaged(staged, {
          stripMetadata: local.settings.stripMetadata,
          force: forceReencode,
        });
      },
      abortAll: () => {
        void compress.abortAll();
      },
      clearFinished: () => {
        compress.clearFinished();
      },
      focusDropZone,
      openSettings,
      toggleHelp: () => setKeysOpen((v) => !v),
    }),
    [
      pickFiles,
      compress,
      staged,
      local.settings.stripMetadata,
      forceReencode,
      focusDropZone,
      openSettings,
    ],
  );

  useKeyboardShortcuts(shortcutHandlers, {
    canAbort: compress.canAbort,
    helpOpen: keysOpen,
  });

  const presentKinds = useMemo(() => kindsPresent(staged), [staged]);

  const estimateInputKey = useMemo(
    () => staged.map((f) => `${f.path}\0${f.presetId}\0${f.bytes}`).join("\n"),
    [staged],
  );

  // Drop stale PREVIEW numbers when staged files or their presets change.
  useEffect(() => {
    estimate.clearEstimates();
  }, [estimateInputKey, estimate.clearEstimates]);

  useEffect(() => {
    if (!presets.loaded) return;
    assignMissingPresets(presets.presetByKind);
  }, [presets.loaded, presets.presetByKind, assignMissingPresets]);

  useEffect(() => {
    let cancelled = false;

    async function loadBackendStatus() {
      try {
        const [appInfo, pong] = await Promise.all([
          invoke<AppInfo>("app_info"),
          invoke<string>("ping"),
        ]);
        if (!cancelled) {
          setInfo(appInfo);
          setPingResult(pong);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void loadBackendStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  function handlePresetSelect(kind: MediaKind, presetId: string) {
    // Clear before paint so summary/rows never briefly show the prior preset.
    estimate.clearEstimates();
    presets.setKindPreset(kind, presetId);
    setKindPreset(kind, presetId);
    local.setDefaultPreset(kind, presetId);
  }

  function handlePreviewImage(row: ProgressRow) {
    if (!row.outputPath) return;
    setImagePreview({
      jobId: row.jobId,
      sourcePath: row.sourcePath,
      outputPath: row.outputPath,
      originalBytes: row.originalBytes,
      resultBytes: row.resultBytes,
    });
  }

  function handleClearStaged() {
    clearStaged();
  }

  const handleReveal = useCallback(
    async (
      action: RevealAction,
      targets: { sourcePath: string; outputPath?: string },
    ) => {
      const result = await revealInFileManager(action, targets);
      setStatus(result.status);
    },
    [setStatus],
  );

  const shellClass =
    local.settings.uiDensity === "regular"
      ? "app-shell density-regular"
      : "app-shell density-compact";

  return (
    <div className={shellClass}>
      <div className="grid-bg" aria-hidden="true" />
      <main className="app-main">
        <section className="setup">
          <header className="hud-frame setup-header">
            <p className="brand-mark">Filesize Obliterator</p>
            <h1 className="brand-tagline">Local media compression.</h1>
            <p className="brand-sub">
              Instrument panel for shrinking files on this machine. No cloud.
            </p>
            <p className="keys-hint mono">
              <button
                type="button"
                className="btn keys-hint-btn"
                onClick={() => setKeysOpen(true)}
              >
                KEYS ?
              </button>
            </p>
          </header>

          <FileDropZone
            ref={dropZoneRef}
            dragActive={dragActive}
            onPick={() => void pickFiles()}
          >
            <IntakeStatus status={status} tone={statusTone(status)} />
            <div className="staged-panel">
              <div className="staged-head">
                <p className="panel-label">Staged</p>
                {staged.length > 0 ? (
                  <button type="button" className="btn" onClick={handleClearStaged}>
                    Clear
                  </button>
                ) : null}
              </div>
              <StagedFileList
                files={staged}
                estimatesByPath={estimate.byPath}
                onReveal={(action, targets) => void handleReveal(action, targets)}
              />
            </div>
          </FileDropZone>

          <EstimateSummaryStrip
            summary={estimate.summary}
            estimating={estimate.estimating}
            error={estimate.error}
          />

          <PresetPicker
            kinds={presentKinds}
            byKind={presets.byKind}
            selected={presets.presetByKind}
            onSelect={handlePresetSelect}
            disabled={!presets.loaded}
          />

          {presets.error ? (
            <p className="compress-status tone-danger" role="alert">
              PRESETS FAILED — {presets.error}
            </p>
          ) : null}

          {local.status ? (
            <p className="compress-status tone-danger" role="alert">
              {local.status}
            </p>
          ) : null}

          <div
            ref={settingsRef}
            tabIndex={-1}
            className="settings-focus-target"
            data-settings-focus
          >
            <SettingsPanel
              settings={local.settings}
              disabled={!local.loaded}
              onConcurrency={local.setConcurrency}
              onStripMetadata={local.setStripMetadata}
              onUiDensity={local.setUiDensity}
            />
          </div>

          <div className="hud-frame setup-surface">
            <p className="panel-label">Session</p>
            <label className="hud-toggle">
              <input
                type="checkbox"
                checked={forceReencode}
                onChange={(e) => setForceReencode(e.target.checked)}
              />
              <span className="hud-toggle-label">Force</span>
              <span className="mono hud-toggle-state">
                {forceReencode ? "ON" : "OFF"}
              </span>
            </label>
            <p className="hud-toggle-hint">
              {forceReencode
                ? "Re-encode even when this source+preset already has output."
                : "Skip when an existing `_compressed` output matches source+preset."}
            </p>
            <p
              className="hud-toggle-hint mono"
              data-testid="force-payload"
            >
              compress_start.force={String(forceReencode)}
            </p>
          </div>

          <CompressProgressPanel
            rows={compress.rows}
            phase={compress.phase}
            batchSummary={compress.batchSummary}
            error={compress.error}
            starting={compress.starting}
            canAbort={compress.canAbort}
            aborting={compress.aborting}
            canRetryFailed={compress.canRetryFailed}
            canDismissFailed={compress.canDismissFailed}
            stagedCount={staged.length}
            estimating={estimate.estimating}
            onPreview={() => void estimate.previewStaged(staged)}
            onStart={() =>
              void compress.startStaged(staged, {
                stripMetadata: local.settings.stripMetadata,
                force: forceReencode,
              })
            }
            onAbort={() => void compress.abortAll()}
            onCancelOne={(jobId) => void compress.cancelOne(jobId)}
            onClearFinished={compress.clearFinished}
            onRetryFailed={() => void compress.retryFailed()}
            onDismissFailed={compress.dismissFailed}
            onPreviewImage={handlePreviewImage}
            onReveal={(action, targets) => void handleReveal(action, targets)}
          />

          <div className="hud-frame setup-surface">
            <p className="panel-label">Bridge</p>
            {error ? (
              <p className="bridge-status error" role="alert">
                <span className="hud-tick" aria-hidden="true" />
                Backend unavailable
                <span className="mono">— {error}</span>
              </p>
            ) : info && pingResult ? (
              <p className="bridge-status">
                <span className="hud-tick" aria-hidden="true" />
                Bridge ok
                <span className="mono">
                  — {info.name} v{info.version} ({pingResult})
                </span>
              </p>
            ) : (
              <p className="bridge-status">
                <span className="hud-tick" aria-hidden="true" />
                Connecting
              </p>
            )}
          </div>
        </section>
      </main>
      {imagePreview ? (
        <ImageComparePreview
          target={imagePreview}
          onClose={() => setImagePreview(null)}
        />
      ) : null}
      <KeyboardHelpOverlay
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
      />
    </div>
  );
}

export default App;

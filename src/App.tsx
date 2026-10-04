import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CompressProgressPanel } from "./components/CompressProgressPanel";
import { DiagnosticsDisclosure } from "./components/DiagnosticsDisclosure";
import { EstimateSummaryStrip } from "./components/EstimateSummaryStrip";
import { FileDropZone } from "./components/FileDropZone";
import {
  ImageComparePreview,
  type ImageCompareTarget,
} from "./components/ImageComparePreview";
import { IntakeStatus } from "./components/IntakeStatus";
import { BriefingOverlay } from "./components/BriefingOverlay";
import { KeyboardHelpOverlay } from "./components/KeyboardHelpOverlay";
import { PresetPicker } from "./components/PresetPicker";
import { SettingsPanel } from "./components/SettingsPanel";
import { StagedFileList } from "./components/StagedFileList";
import { isBriefingOpen } from "./briefing/briefing";
import type { ProgressRow } from "./compress/progressState";
import { useCompressEstimate } from "./hooks/useCompressEstimate";
import { useCompressProgress } from "./hooks/useCompressProgress";
import { useFileIntake } from "./hooks/useFileIntake";
import { useLocalSettings } from "./hooks/useLocalSettings";
import { usePresets } from "./hooks/usePresets";
import { compressHwEncodeStatus, type MediaKind } from "./ipc/compress";
import { revealInFileManager } from "./ipc/reveal";
import { useKeyboardShortcuts } from "./keyboard/useKeyboardShortcuts";
import type { RevealAction } from "./reveal/actions";
import { kindsPresent } from "./presets/selection";
import {
  deriveShellMode,
  shellShowsOps,
  shellShowsProgress,
} from "./shell/mode";
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
  const [hwStatus, setHwStatus] = useState<string | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  /** Operator reopened BRIEFING after ACK (does not clear briefingSeen). */
  const [briefingHelpRequested, setBriefingHelpRequested] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDetailsElement>(null);
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

  const shellMode = useMemo(
    () =>
      deriveShellMode({
        stagedCount: staged.length,
        phase: compress.phase,
      }),
    [staged.length, compress.phase],
  );

  const focusDropZone = useCallback(() => {
    dropZoneRef.current?.focus();
    dropZoneRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const openSettings = useCallback(() => {
    const el = settingsRef.current;
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const focusTarget = el.querySelector<HTMLElement>("[data-settings-focus]");
    focusTarget?.focus();
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
          preferHardware: local.settings.preferHardware,
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
      local.settings.preferHardware,
      forceReencode,
      focusDropZone,
      openSettings,
    ],
  );

  const briefingOpen = isBriefingOpen({
    settingsLoaded: local.loaded,
    briefingSeen: local.settings.briefingSeen,
    helpRequested: briefingHelpRequested,
  });

  const acknowledgeBriefing = useCallback(() => {
    setBriefingHelpRequested(false);
    if (!local.settings.briefingSeen) {
      local.patch({ briefingSeen: true });
    }
  }, [local.patch, local.settings.briefingSeen]);

  useKeyboardShortcuts(shortcutHandlers, {
    canAbort: compress.canAbort,
    helpOpen: keysOpen,
    previewOpen: imagePreview != null,
    briefingOpen,
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
        const [appInfo, pong, hw] = await Promise.all([
          invoke<AppInfo>("app_info"),
          invoke<string>("ping"),
          compressHwEncodeStatus().catch(() => "HW: UNAVAILABLE"),
        ]);
        if (!cancelled) {
          setInfo(appInfo);
          setPingResult(pong);
          setHwStatus(hw);
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

  const densityClass =
    local.settings.uiDensity === "regular"
      ? "density-regular"
      : "density-compact";

  const showOps = shellShowsOps(shellMode);
  const showProgress = shellShowsProgress(shellMode);

  const startDisabled =
    compress.starting || staged.length === 0 || compress.canAbort;

  const opsStrip = showOps ? (
    <div className="ops-strip hud-frame" data-testid="ops-strip">
      <p className="panel-label">Ops</p>
      <div className="ops-toggles">
        <label className="hud-toggle">
          <input
            type="checkbox"
            checked={local.settings.stripMetadata}
            disabled={!local.loaded}
            onChange={(e) => local.setStripMetadata(e.target.checked)}
          />
          <span className="hud-toggle-label">Privacy</span>
          <span className="mono hud-toggle-state">
            {local.settings.stripMetadata ? "ON" : "OFF"}
          </span>
        </label>
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
      </div>
      <p className="hud-toggle-hint">
        Privacy strips EXIF/GPS. Force re-encodes even when output exists.
      </p>

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

      <div className="ops-start" data-testid="ops-start">
        <button
          type="button"
          className="btn"
          disabled={
            estimate.estimating || startDisabled
          }
          onClick={() => void estimate.previewStaged(staged)}
          aria-label="Preview dry-run estimate"
        >
          {estimate.estimating ? "ESTIMATING" : "PREVIEW"}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={startDisabled}
          onClick={() =>
            void compress.startStaged(staged, {
              stripMetadata: local.settings.stripMetadata,
              preferHardware: local.settings.preferHardware,
              force: forceReencode,
            })
          }
          aria-label="Start compress"
        >
          {compress.starting ? "STARTING" : "COMPRESS"}
        </button>
      </div>

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
    </div>
  ) : null;

  return (
    <div className={`app-shell ${densityClass} mode-${shellMode}`}>
      <div className="grid-bg" aria-hidden="true" />
      <main className="app-main">
        <section className="setup" data-mode={shellMode}>
          <header className="hud-frame setup-header">
            <p className="brand-mark">Filesize Obliterator</p>
            {shellMode === "idle" ? (
              <>
                <h1 className="brand-tagline">Local media compression.</h1>
                <p className="brand-sub">
                  Instrument panel for shrinking files on this machine. No cloud.
                </p>
              </>
            ) : (
              <p className="mode-chip mono" aria-live="polite">
                {shellMode.toUpperCase()}
              </p>
            )}
            <p className="keys-hint mono">
              <button
                type="button"
                className="btn keys-hint-btn"
                onClick={() => setBriefingHelpRequested(true)}
              >
                BRIEFING
              </button>
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
                  <button
                    type="button"
                    className="btn"
                    onClick={handleClearStaged}
                    aria-label="Clear staged files"
                  >
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

          {opsStrip}

          {/*
            DOM order keeps keyboard tab flow: drop → presets → start → queue.
            CSS order lifts the queue visually above intake when running/done.
          */}
          {showProgress ? (
            <CompressProgressPanel
              rows={compress.rows}
              phase={compress.phase}
              batchSummary={compress.batchSummary}
              error={compress.error}
              canAbort={compress.canAbort}
              aborting={compress.aborting}
              canRetryFailed={compress.canRetryFailed}
              canDismissFailed={compress.canDismissFailed}
              onAbort={() => void compress.abortAll()}
              onCancelOne={(jobId) => void compress.cancelOne(jobId)}
              onClearFinished={compress.clearFinished}
              onRetryFailed={() => void compress.retryFailed()}
              onDismissFailed={compress.dismissFailed}
              onPreviewImage={handlePreviewImage}
              onReveal={(action, targets) => void handleReveal(action, targets)}
            />
          ) : null}

          <details ref={settingsRef} className="hud-frame secondary-panel">
            <summary className="secondary-summary">
              <span className="panel-label">Settings</span>
            </summary>
            <div
              tabIndex={-1}
              className="settings-focus-target"
              data-settings-focus
            >
              <SettingsPanel
                settings={local.settings}
                disabled={!local.loaded}
                hwStatus={hwStatus}
                onConcurrency={local.setConcurrency}
                onStripMetadata={local.setStripMetadata}
                onPreferHardware={local.setPreferHardware}
                onUiDensity={local.setUiDensity}
              />
            </div>
          </details>

          <DiagnosticsDisclosure
            error={error}
            info={info}
            pingResult={pingResult}
            forceReencode={forceReencode}
            stripMetadata={local.settings.stripMetadata}
            preferHardware={local.settings.preferHardware}
            hwStatus={hwStatus}
          />
        </section>
      </main>
      {imagePreview ? (
        <ImageComparePreview
          target={imagePreview}
          onClose={() => setImagePreview(null)}
        />
      ) : null}
      <BriefingOverlay open={briefingOpen} onAcknowledge={acknowledgeBriefing} />
      <KeyboardHelpOverlay
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
      />
    </div>
  );
}

export default App;

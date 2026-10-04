import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CompressProgressPanel } from "./components/CompressProgressPanel";
import { FileDropZone } from "./components/FileDropZone";
import { IntakeStatus } from "./components/IntakeStatus";
import { PresetPicker } from "./components/PresetPicker";
import { StagedFileList } from "./components/StagedFileList";
import { useCompressProgress } from "./hooks/useCompressProgress";
import { useFileIntake } from "./hooks/useFileIntake";
import { usePresets } from "./hooks/usePresets";
import type { MediaKind } from "./ipc/compress";
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
    status.startsWith("NO CHANGE")
  ) {
    return "warn";
  }
  return "ok";
}

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Session privacy control — bound into compress_start as stripMetadata (default on). */
  const [stripMetadata, setStripMetadata] = useState(true);
  const presets = usePresets();
  const {
    staged,
    status,
    dragActive,
    pickFiles,
    clearStaged,
    setKindPreset,
    assignMissingPresets,
  } = useFileIntake(presets.presetByKind);
  const compress = useCompressProgress();

  const presentKinds = useMemo(() => kindsPresent(staged), [staged]);

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
    presets.setKindPreset(kind, presetId);
    setKindPreset(kind, presetId);
  }

  return (
    <div className="app-shell">
      <div className="grid-bg" aria-hidden="true" />
      <main className="app-main">
        <section className="setup">
          <header className="hud-frame setup-header">
            <p className="brand-mark">Filesize Obliterator</p>
            <h1 className="brand-tagline">Local media compression.</h1>
            <p className="brand-sub">
              Instrument panel for shrinking files on this machine. No cloud.
            </p>
          </header>

          <FileDropZone dragActive={dragActive} onPick={() => void pickFiles()}>
            <IntakeStatus status={status} tone={statusTone(status)} />
            <div className="staged-panel">
              <div className="staged-head">
                <p className="panel-label">Staged</p>
                {staged.length > 0 ? (
                  <button type="button" className="btn" onClick={clearStaged}>
                    Clear
                  </button>
                ) : null}
              </div>
              <StagedFileList files={staged} />
            </div>
          </FileDropZone>

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

          <div className="hud-frame setup-surface">
            <p className="panel-label">Privacy</p>
            <label className="hud-toggle">
              <input
                type="checkbox"
                checked={stripMetadata}
                onChange={(e) => setStripMetadata(e.target.checked)}
              />
              <span className="hud-toggle-label">Strip metadata</span>
              <span className="mono hud-toggle-state">
                {stripMetadata ? "ON" : "OFF"}
              </span>
            </label>
            <p className="hud-toggle-hint">
              {stripMetadata
                ? "EXIF/GPS removed on image/video outputs."
                : "Preserve orientation and tags where the pipeline allows."}
            </p>
            <p
              className="hud-toggle-hint mono"
              data-testid="strip-metadata-payload"
            >
              compress_start.stripMetadata={String(stripMetadata)}
            </p>
          </div>

          <CompressProgressPanel
            rows={compress.rows}
            phase={compress.phase}
            error={compress.error}
            starting={compress.starting}
            canAbort={compress.canAbort}
            aborting={compress.aborting}
            stagedCount={staged.length}
            onStart={() =>
              void compress.startStaged(staged, { stripMetadata })
            }
            onAbort={() => void compress.abortAll()}
            onCancelOne={(jobId) => void compress.cancelOne(jobId)}
            onClearFinished={compress.clearFinished}
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
    </div>
  );
}

export default App;

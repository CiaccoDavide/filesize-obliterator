import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileDropZone } from "./components/FileDropZone";
import { IntakeStatus } from "./components/IntakeStatus";
import { PresetPicker } from "./components/PresetPicker";
import { StagedFileList } from "./components/StagedFileList";
import { useCompressJobs } from "./hooks/useCompressJobs";
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
  if (status.startsWith("REJECTED") || status.startsWith("INTAKE FAILED") || status.startsWith("PICK FAILED")) {
    return "danger";
  }
  if (status.startsWith("PICK CANCELLED") || status.startsWith("ALREADY") || status.startsWith("NO CHANGE")) {
    return "warn";
  }
  return "ok";
}

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const compress = useCompressJobs();

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

  const canStart =
    staged.length > 0 &&
    staged.every((f) => Boolean(f.presetId)) &&
    compress.status !== "starting";

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

          <div className="hud-frame compress-panel">
            <div className="staged-head">
              <p className="panel-label">Compress</p>
              <button
                type="button"
                className="btn primary"
                disabled={!canStart}
                onClick={() => void compress.startStaged(staged)}
              >
                {compress.status === "starting" ? "Starting" : "Start"}
              </button>
            </div>
            {presets.error ? (
              <p className="compress-status tone-danger" role="alert">
                PRESETS FAILED — {presets.error}
              </p>
            ) : null}
            {compress.error ? (
              <p className="compress-status tone-danger" role="alert">
                {compress.error}
              </p>
            ) : null}
            {compress.status === "started" ? (
              <p className="compress-status" role="status">
                STARTED {compress.jobs.length}
              </p>
            ) : (
              <p className="compress-status">
                AWAITING START
              </p>
            )}
          </div>

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

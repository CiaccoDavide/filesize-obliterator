import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CompressProgressPanel } from "./components/CompressProgressPanel";
import { FileDropZone } from "./components/FileDropZone";
import { IntakeStatus } from "./components/IntakeStatus";
import { StagedFileList } from "./components/StagedFileList";
import { useCompressProgress } from "./hooks/useCompressProgress";
import { useFileIntake } from "./hooks/useFileIntake";
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
  const { staged, status, dragActive, pickFiles, clearStaged } = useFileIntake();
  const compress = useCompressProgress();

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

          <CompressProgressPanel
            rows={compress.rows}
            phase={compress.phase}
            error={compress.error}
            starting={compress.starting}
            canAbort={compress.canAbort}
            aborting={compress.aborting}
            stagedCount={staged.length}
            onStart={() => void compress.startStaged(staged)}
            onAbort={() => void compress.abortAll()}
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

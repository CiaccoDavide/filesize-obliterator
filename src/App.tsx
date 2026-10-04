import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type AppInfo = {
  name: string;
  version: string;
};

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

          <div className="hud-frame setup-surface">
            <p className="panel-label">Work surface</p>
            <p className="surface-await">AWAITING INPUT</p>

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

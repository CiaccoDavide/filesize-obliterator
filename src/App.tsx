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
    <main className="container">
      <h1>Filesize Obliterator</h1>
      <p className="tagline">Local media compression desktop shell</p>
      {error ? (
        <p className="status error" role="alert">
          Backend unavailable: {error}
        </p>
      ) : info && pingResult ? (
        <p className="status">
          Rust bridge ok — {info.name} v{info.version} ({pingResult})
        </p>
      ) : (
        <p className="status">Connecting to Rust backend…</p>
      )}
    </main>
  );
}

export default App;

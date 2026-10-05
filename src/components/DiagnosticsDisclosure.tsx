type Props = {
  error: string | null;
  info: { name: string; version: string } | null;
  pingResult: string | null;
  forceReencode: boolean;
  stripMetadata: boolean;
  preferHardware: boolean;
  hwStatus: string | null;
};

/** Collapsed scaffold/debug surface — Bridge + IPC payload lines. */
export function DiagnosticsDisclosure({
  error,
  info,
  pingResult,
  forceReencode,
  stripMetadata,
  preferHardware,
  hwStatus,
}: Props) {
  return (
    <details className="hud-frame diagnostics" data-testid="diagnostics">
      <summary className="diagnostics-summary">
        <span className="panel-label">Diagnostics</span>
        <span className="diagnostics-hint mono">Bridge / IPC</span>
      </summary>
      <div className="diagnostics-body">
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

        <p className="panel-label">IPC payload</p>
        <p className="hud-toggle-hint mono" data-testid="strip-metadata-payload">
          compress_start.stripMetadata={String(stripMetadata)}
        </p>
        <p className="hud-toggle-hint mono" data-testid="prefer-hardware-payload">
          compress_start.preferHardware={String(preferHardware)}
        </p>
        <p className="hud-toggle-hint mono" data-testid="force-payload">
          compress_start.force={String(forceReencode)}
        </p>
        <p
          className="hud-toggle-hint mono"
          data-testid="hw-encode-status"
          role="status"
        >
          {hwStatus ?? "HW: —"}
        </p>
      </div>
    </details>
  );
}

import { formatBytes } from "../intake/formatBytes";
import {
  formatByteMeter,
  sizeDeltaLabel,
  type OpsPhase,
  type ProgressRow,
} from "../compress/progressState";

type Props = {
  rows: ProgressRow[];
  phase: OpsPhase;
  error: string | null;
  starting: boolean;
  canAbort: boolean;
  aborting: boolean;
  stagedCount: number;
  onStart: () => void;
  onAbort: () => void;
  onClearFinished: () => void;
};

function phaseTone(phase: OpsPhase): "ok" | "warn" | "danger" {
  if (phase === "FAILED") return "danger";
  if (phase === "ABORTING") return "warn";
  return "ok";
}

function rowDetail(row: ProgressRow): string {
  if (row.phase === "COMPLETE") {
    const delta = sizeDeltaLabel(
      row.originalBytes,
      row.resultBytes,
      formatBytes,
    );
    const out = row.outputPath ?? "—";
    return delta ? `${out} · ${delta}` : out;
  }
  if (row.phase === "FAILED" && row.error) {
    return row.error;
  }
  return formatByteMeter(row.bytesProcessed, row.bytesTotal, formatBytes);
}

export function CompressProgressPanel({
  rows,
  phase,
  error,
  starting,
  canAbort,
  aborting,
  stagedCount,
  onStart,
  onAbort,
  onClearFinished,
}: Props) {
  const tone = phaseTone(phase);
  const doneCount = rows.filter((r) => r.phase === "COMPLETE").length;
  const failCount = rows.filter((r) => r.phase === "FAILED").length;
  const hasFinished = doneCount + failCount > 0;

  return (
    <section className="hud-frame compress-panel" aria-label="Compress progress">
      <div className="compress-top">
        <div className="compress-status-wrap">
          <p className={`compress-status tone-${tone}`}>
            {(phase === "COMPRESSING" || phase === "ABORTING") && (
              <span className="hud-tick" aria-hidden="true" />
            )}
            {phase}
          </p>
          {error ? (
            <p className="compress-error mono" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="compress-meters">
          <div className="meter">
            <span className="meter-label">Jobs</span>
            <span className="meter-value">
              {doneCount}/{rows.length || 0}
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Fail</span>
            <span className="meter-value">{failCount}</span>
          </div>
        </div>

        <div className="compress-actions">
          <button
            type="button"
            className="btn primary"
            disabled={starting || stagedCount === 0 || canAbort}
            onClick={onStart}
          >
            {starting ? "Starting" : "Compress"}
          </button>
          <button
            type="button"
            className={`btn danger${aborting ? " aborting" : ""}`}
            disabled={!canAbort || aborting}
            onClick={onAbort}
          >
            {aborting ? (
              <>
                <span className="abort-spinner" aria-hidden="true" />
                Aborting
              </>
            ) : (
              "Abort"
            )}
          </button>
          {hasFinished ? (
            <button type="button" className="btn" onClick={onClearFinished}>
              Clear done
            </button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="compress-empty mono">Awaiting compress jobs…</p>
      ) : (
        <ul className="compress-list">
          {rows.map((row) => (
            <li key={row.jobId} className="compress-row">
              <span className="compress-row-phase">{row.phase}</span>
              <div className="compress-row-main">
                <span className="compress-path mono" title={row.sourcePath}>
                  {row.sourcePath}
                </span>
                <span className="compress-detail mono">{rowDetail(row)}</span>
              </div>
              <div
                className="compress-bar"
                role="progressbar"
                aria-valuenow={Math.round(row.percent)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span
                  className="compress-bar-fill"
                  style={{ width: `${Math.min(100, Math.max(0, row.percent))}%` }}
                />
              </div>
              <span className="compress-pct mono">
                {Math.round(row.percent)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

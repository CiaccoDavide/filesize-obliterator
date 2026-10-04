import { formatBytes } from "../intake/formatBytes";
import {
  formatByteMeter,
  sizeDeltaLabel,
  type OpsPhase,
  type ProgressRow,
} from "../compress/progressState";
import {
  aggregateSessionStats,
  formatSavePercent,
  formatSignedBytes,
} from "../compress/sessionStats";
import type { RevealAction } from "../reveal/actions";
import { RevealRowActions } from "./RevealRowActions";

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
  onCancelOne: (jobId: string) => void;
  onClearFinished: () => void;
  onReveal?: (
    action: RevealAction,
    targets: { sourcePath: string; outputPath?: string },
  ) => void;
};

function rowCancellable(row: ProgressRow): boolean {
  return (
    row.phase === "AWAITING" ||
    row.phase === "COMPRESSING"
  );
}

function phaseTone(phase: OpsPhase): "ok" | "warn" | "danger" {
  if (phase === "FAILED") return "danger";
  if (phase === "ABORTING" || phase === "SKIPPED") return "warn";
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
  if (row.phase === "SKIPPED") {
    const reason = row.error ?? "already compressed for this preset";
    const out = row.outputPath ? ` · ${row.outputPath}` : "";
    return `${reason}${out}`;
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
  onCancelOne,
  onClearFinished,
  onReveal,
}: Props) {
  const tone = phaseTone(phase);
  const stats = aggregateSessionStats(rows);
  const hasFinished =
    stats.filesDone + stats.filesFailed + stats.filesSkipped > 0;

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

        <div
          className="compress-meters"
          aria-label="Session savings"
          data-testid="session-meters"
        >
          <div className="meter">
            <span className="meter-label">Done</span>
            <span className="meter-value mono">{stats.filesDone}</span>
          </div>
          <div className="meter">
            <span className="meter-label">Fail</span>
            <span className="meter-value mono">{stats.filesFailed}</span>
          </div>
          <div className="meter">
            <span className="meter-label">Skip</span>
            <span className="meter-value mono">{stats.filesSkipped}</span>
          </div>
          <div className="meter">
            <span className="meter-label">In</span>
            <span className="meter-value mono">{formatBytes(stats.bytesIn)}</span>
          </div>
          <div className="meter">
            <span className="meter-label">Out</span>
            <span className="meter-value mono">{formatBytes(stats.bytesOut)}</span>
          </div>
          <div className="meter">
            <span className="meter-label">Saved</span>
            <span className="meter-value mono">
              {formatSignedBytes(stats.bytesSaved)}
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Save</span>
            <span className="meter-value mono">
              {formatSavePercent(stats.savePercent)}
            </span>
          </div>
        </div>

        <div className="compress-actions">
          <button
            type="button"
            className="btn primary"
            disabled={starting || stagedCount === 0 || canAbort}
            onClick={onStart}
          >
            {starting ? "STARTING" : "COMPRESS"}
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
                ABORTING
              </>
            ) : (
              "ABORT"
            )}
          </button>
          {hasFinished ? (
            <button type="button" className="btn" onClick={onClearFinished}>
              CLEAR DONE
            </button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="compress-empty mono">AWAITING JOBS</p>
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
              <div className="compress-row-side">
                {onReveal ? (
                  <RevealRowActions
                    targets={{
                      sourcePath: row.sourcePath,
                      outputPath: row.outputPath,
                    }}
                    onReveal={(action) =>
                      onReveal(action, {
                        sourcePath: row.sourcePath,
                        outputPath: row.outputPath,
                      })
                    }
                  />
                ) : null}
                {rowCancellable(row) ? (
                  <button
                    type="button"
                    className="btn danger compress-row-cancel"
                    onClick={() => onCancelOne(row.jobId)}
                    aria-label={`Cancel ${row.sourcePath}`}
                  >
                    CANCEL
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

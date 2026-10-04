import { formatBytes } from "../intake/formatBytes";
import {
  formatEstimateDeltaPercent,
  type EstimateAggregate,
} from "../compress/estimateAggregate";
import { formatSignedBytes } from "../compress/sessionStats";

type Props = {
  summary: EstimateAggregate;
  estimating: boolean;
  error: string | null;
};

/**
 * PREVIEW strip: staged bytes → estimated bytes → Δ%.
 * Estimates are labeled approximate when confidence is not exact.
 */
export function EstimateSummaryStrip({ summary, estimating, error }: Props) {
  const showMeters = summary.count > 0 || estimating;

  return (
    <div
      className="estimate-strip"
      aria-label="Dry-run size estimate"
      data-testid="estimate-summary"
    >
      <div className="estimate-strip-head">
        <p className="panel-label">Preview</p>
        {summary.approximate && summary.count > 0 ? (
          <span className="estimate-approx mono">ESTIMATE · APPROX</span>
        ) : null}
        {estimating ? (
          <span className="estimate-approx mono">
            <span className="hud-tick" aria-hidden="true" />
            ESTIMATING
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="compress-error mono" role="alert">
          {error}
        </p>
      ) : null}
      {showMeters ? (
        <div className="compress-meters estimate-meters">
          <div className="meter">
            <span className="meter-label">Staged</span>
            <span className="meter-value mono">
              {formatBytes(summary.stagedBytes)}
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Est</span>
            <span className="meter-value mono">
              {summary.approximate && summary.count > 0 ? "~" : ""}
              {formatBytes(summary.estimatedBytes)}
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Δ</span>
            <span className="meter-value mono">
              {formatSignedBytes(summary.deltaBytes)}
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Δ%</span>
            <span className="meter-value mono">
              {formatEstimateDeltaPercent(
                summary.deltaPercent,
                summary.approximate,
              )}
            </span>
          </div>
        </div>
      ) : (
        <p className="estimate-empty mono">AWAITING PREVIEW</p>
      )}
    </div>
  );
}

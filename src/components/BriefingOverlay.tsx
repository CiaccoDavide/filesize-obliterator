import { useEffect, useId } from "react";
import { BRIEFING_STEPS } from "../briefing/briefing";

type Props = {
  open: boolean;
  onAcknowledge: () => void;
};

/**
 * Ice HUD first-run / HELP briefing. Offline copy only — no remote content.
 * Pattern matches ImageComparePreview / KEYS overlays (scrim + hud-frame).
 */
export function BriefingOverlay({ open, onAcknowledge }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onAcknowledge();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onAcknowledge]);

  if (!open) return null;

  return (
    <div
      className="preview-overlay briefing-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="briefing-overlay"
    >
      <div
        className="preview-scrim"
        onClick={onAcknowledge}
        aria-hidden="true"
      />
      <div className="hud-frame preview-panel briefing-panel">
        <div className="preview-head">
          <p className="panel-label" id={titleId}>
            Briefing
          </p>
          <button type="button" className="btn" onClick={onAcknowledge}>
            ACKNOWLEDGE
          </button>
        </div>
        <ol className="briefing-steps mono">
          {BRIEFING_STEPS.map((step, i) => (
            <li key={step} className="briefing-step">
              <span className="briefing-index">{i + 1}</span>
              <span className="briefing-copy">{step}</span>
            </li>
          ))}
        </ol>
        <p className="keys-foot mono">Local instrument — no network</p>
      </div>
    </div>
  );
}

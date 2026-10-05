import { forwardRef, type ReactNode } from "react";

type Props = {
  dragActive: boolean;
  onPick: () => void;
  /** Offline folder watch toggle (session-local). */
  watching?: boolean;
  onToggleWatch?: () => void;
  children?: ReactNode;
};

/**
 * Intake surface. Activation is the Browse button (not the region itself) so
 * SR users get a real control and tab order is not polluted by a faux widget.
 */
export const FileDropZone = forwardRef<HTMLDivElement, Props>(
  function FileDropZone(
    { dragActive, onPick, watching = false, onToggleWatch, children },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={`drop-zone hud-frame${dragActive ? " drop-zone-active" : ""}`}
        data-active={dragActive ? "true" : "false"}
        role="region"
        aria-label="File intake drop zone"
        data-testid="drop-zone"
      >
        <p className="panel-label">Intake</p>
        <p className="drop-copy">
          Drop image / audio / video / PDF.
          <br />
          Folders expand one level.
        </p>
        <div className="drop-actions">
          <button
            type="button"
            className="btn primary"
            onClick={onPick}
            aria-label="Browse files to stage"
            data-drop-browse
          >
            Browse
          </button>
          {onToggleWatch ? (
            <button
              type="button"
              className={`btn${watching ? " primary" : ""}`}
              onClick={onToggleWatch}
              aria-label={watching ? "Stop folder watch" : "Watch folder"}
              aria-pressed={watching}
              data-testid="watch-toggle"
            >
              {watching ? "WATCHING" : "WATCH"}
            </button>
          ) : null}
        </div>
        {children}
      </div>
    );
  },
);

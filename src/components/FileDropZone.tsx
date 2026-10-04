import { forwardRef, type ReactNode } from "react";

type Props = {
  dragActive: boolean;
  onPick: () => void;
  children?: ReactNode;
};

export const FileDropZone = forwardRef<HTMLDivElement, Props>(
  function FileDropZone({ dragActive, onPick, children }, ref) {
    return (
      <div
        ref={ref}
        className={`drop-zone hud-frame${dragActive ? " drop-zone-active" : ""}`}
        data-active={dragActive ? "true" : "false"}
        tabIndex={-1}
        data-testid="drop-zone"
      >
        <p className="panel-label">Intake</p>
        <p className="drop-copy">
          Drop image / audio / video / PDF.
          <br />
          Folders expand one level.
        </p>
        <div className="drop-actions">
          <button type="button" className="btn primary" onClick={onPick}>
            Browse
          </button>
        </div>
        {children}
      </div>
    );
  },
);

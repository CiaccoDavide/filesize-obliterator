import { forwardRef, type KeyboardEvent, type ReactNode } from "react";

type Props = {
  dragActive: boolean;
  onPick: () => void;
  children?: ReactNode;
};

export const FileDropZone = forwardRef<HTMLDivElement, Props>(
  function FileDropZone({ dragActive, onPick, children }, ref) {
    function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPick();
      }
    }

    return (
      <div
        ref={ref}
        className={`drop-zone hud-frame${dragActive ? " drop-zone-active" : ""}`}
        data-active={dragActive ? "true" : "false"}
        tabIndex={0}
        role="region"
        aria-label="File intake drop zone"
        data-testid="drop-zone"
        onKeyDown={handleKeyDown}
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
          >
            Browse
          </button>
        </div>
        {children}
      </div>
    );
  },
);

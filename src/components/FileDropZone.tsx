import type { ReactNode } from "react";

type Props = {
  dragActive: boolean;
  onPick: () => void;
  children?: ReactNode;
};

export function FileDropZone({ dragActive, onPick, children }: Props) {
  return (
    <div
      className={`drop-zone hud-frame${dragActive ? " drop-zone-active" : ""}`}
      data-active={dragActive ? "true" : "false"}
    >
      <p className="panel-label">Intake</p>
      <p className="drop-copy">
        Drop image / audio / video / PDF here.
        <br />
        Folders expand one level of supported files.
      </p>
      <div className="drop-actions">
        <button type="button" className="btn primary" onClick={onPick}>
          Browse files
        </button>
      </div>
      {children}
    </div>
  );
}

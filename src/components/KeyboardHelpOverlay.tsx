import { useId, useMemo } from "react";
import {
  SHORTCUTS,
  detectPlatform,
  formatChord,
  type Platform,
} from "../keyboard/shortcuts";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Override for tests; defaults to navigator.platform. */
  platform?: Platform;
};

export function KeyboardHelpOverlay({ open, onClose, platform }: Props) {
  const titleId = useId();
  const resolved = useMemo(
    () =>
      platform ??
      detectPlatform(
        typeof navigator !== "undefined" ? navigator.platform : "Win32",
      ),
    [platform],
  );

  if (!open) return null;

  return (
    <div
      className="keys-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="keys-scrim"
        aria-label="Close KEYS"
        onClick={onClose}
      />
      <div className="keys-panel hud-frame">
        <div className="keys-head">
          <p className="panel-label" id={titleId}>
            KEYS
          </p>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <ul className="keys-list mono">
          {SHORTCUTS.map((s) => (
            <li key={s.id} className="keys-row">
              <span className="keys-chord">{formatChord(s, resolved)}</span>
              <span className="keys-label">
                {s.label}
                {s.note ? (
                  <span className="keys-note"> — {s.note}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <p className="keys-foot mono">Press ? to toggle · Esc to close</p>
      </div>
    </div>
  );
}

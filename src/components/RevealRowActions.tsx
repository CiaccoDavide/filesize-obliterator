import {
  revealActionEnabled,
  type RevealAction,
  type RevealTargets,
} from "../reveal/actions";

type Props = {
  targets: RevealTargets;
  /** When false, hide REVEAL OUTPUT (e.g. staged list). Default true. */
  showOutput?: boolean;
  onReveal: (action: RevealAction) => void;
};

const ACTIONS: { action: RevealAction; label: string; outputOnly?: boolean }[] =
  [
    { action: "source", label: "REVEAL SOURCE" },
    { action: "output", label: "REVEAL OUTPUT", outputOnly: true },
    { action: "compressed", label: "OPEN _COMPRESSED" },
  ];

export function RevealRowActions({
  targets,
  showOutput = true,
  onReveal,
}: Props) {
  return (
    <div className="reveal-actions" role="group" aria-label="Reveal in file manager">
      {ACTIONS.filter((a) => showOutput || !a.outputOnly).map(
        ({ action, label }) => {
          const enabled = revealActionEnabled(action, targets);
          return (
            <button
              key={action}
              type="button"
              className="btn reveal-btn"
              disabled={!enabled}
              onClick={() => onReveal(action)}
              aria-label={label}
            >
              {label}
            </button>
          );
        },
      )}
    </div>
  );
}

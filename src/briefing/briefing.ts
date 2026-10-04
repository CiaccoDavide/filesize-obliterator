/** Terse first-run / HELP briefing steps (operational voice). */
export const BRIEFING_STEPS = [
  "Drop files onto the intake zone — or pick via the control.",
  "Select an alternative (preset) for each media kind present.",
  "Outputs land beside the source under `_compressed/`.",
  "Offline only — no cloud, no remote calls.",
] as const;

export type BriefingVisibility = {
  settingsLoaded: boolean;
  briefingSeen: boolean;
  /** True when the operator reopened HELP / BRIEFING. */
  helpRequested: boolean;
};

/** First launch waits for settings; then show until ACK, or when HELP reopens it. */
export function isBriefingOpen(v: BriefingVisibility): boolean {
  if (!v.settingsLoaded) return false;
  if (v.helpRequested) return true;
  return !v.briefingSeen;
}

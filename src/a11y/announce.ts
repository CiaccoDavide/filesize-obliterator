import type { BatchSummary } from "../compress/batchSummary";
import type { OpsPhase } from "../compress/progressState";

/** Live-region line for batch completion — counts as text, not color. */
export function batchCompletionAnnouncement(summary: BatchSummary): string {
  return `${summary.status} — OK ${summary.succeeded} · FAIL ${summary.failed}`;
}

/** Explicit textual status for ops phase (screen readers + non-color cue). */
export function opsPhaseStatusText(phase: OpsPhase): string {
  return phase;
}

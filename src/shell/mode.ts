import type { OpsPhase } from "../compress/progressState";

/** Product shell composition mode for the main window. */
export type ShellMode = "idle" | "armed" | "running" | "done";

/**
 * Derive HUD composition mode from staged intake + compress phase.
 * Idle / armed share AWAITING; running and done override when jobs are live or terminal.
 */
export function deriveShellMode(input: {
  stagedCount: number;
  phase: OpsPhase;
}): ShellMode {
  if (input.phase === "COMPRESSING" || input.phase === "ABORTING") {
    return "running";
  }
  if (
    input.phase === "COMPLETE" ||
    input.phase === "FAILED" ||
    input.phase === "PARTIAL" ||
    input.phase === "SKIPPED"
  ) {
    return "done";
  }
  return input.stagedCount > 0 ? "armed" : "idle";
}

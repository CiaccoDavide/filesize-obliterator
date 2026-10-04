import { compressedDirForSource } from "./paths";

export type RevealAction = "source" | "output" | "compressed";

export type RevealTargets = {
  sourcePath?: string | null;
  outputPath?: string | null;
};

/** Resolve the filesystem path for a reveal/open action, or null if unavailable. */
export function resolveRevealPath(
  action: RevealAction,
  targets: RevealTargets,
): string | null {
  switch (action) {
    case "source": {
      const path = targets.sourcePath?.trim();
      if (!path || path === "—") return null;
      return path;
    }
    case "output": {
      const path = targets.outputPath?.trim();
      if (!path) return null;
      return path;
    }
    case "compressed":
      return compressedDirForSource(targets.sourcePath ?? "");
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** Whether the action control should be enabled (path known in UI state). */
export function revealActionEnabled(
  action: RevealAction,
  targets: RevealTargets,
): boolean {
  return resolveRevealPath(action, targets) !== null;
}

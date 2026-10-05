import { describe, expect, it } from "vitest";
import type { OpsPhase } from "../compress/progressState";
import {
  deriveShellMode,
  shellShowsOps,
  shellShowsProgress,
  type ShellMode,
} from "./mode";

function mode(stagedCount: number, phase: OpsPhase) {
  return deriveShellMode({ stagedCount, phase });
}

describe("deriveShellMode", () => {
  it("is idle when nothing is staged and phase is awaiting", () => {
    expect(mode(0, "AWAITING")).toBe("idle");
  });

  it("is armed when files are staged and phase is awaiting", () => {
    expect(mode(2, "AWAITING")).toBe("armed");
  });

  it("is running while compressing or aborting regardless of staged count", () => {
    expect(mode(0, "COMPRESSING")).toBe("running");
    expect(mode(3, "COMPRESSING")).toBe("running");
    expect(mode(1, "ABORTING")).toBe("running");
  });

  it("is done for terminal phases", () => {
    expect(mode(0, "COMPLETE")).toBe("done");
    expect(mode(2, "FAILED")).toBe("done");
    expect(mode(1, "PARTIAL")).toBe("done");
    expect(mode(1, "SKIPPED")).toBe("done");
  });
});

describe("shell composition visibility", () => {
  const modes: ShellMode[] = ["idle", "armed", "running", "done"];

  it("shows ops strip for armed/running/done so start stays with presets", () => {
    expect(modes.map(shellShowsOps)).toEqual([false, true, true, true]);
  });

  it("hides full progress while armed — start lives in ops strip", () => {
    expect(modes.map(shellShowsProgress)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

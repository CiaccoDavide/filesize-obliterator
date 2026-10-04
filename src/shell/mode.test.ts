import { describe, expect, it } from "vitest";
import type { OpsPhase } from "../compress/progressState";
import { deriveShellMode } from "./mode";

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

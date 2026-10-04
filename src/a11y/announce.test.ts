import { describe, expect, it } from "vitest";
import {
  batchCompletionAnnouncement,
  opsPhaseStatusText,
} from "./announce";
import type { BatchSummary } from "../compress/batchSummary";

describe("batchCompletionAnnouncement", () => {
  it("announces a successful batch with OK/FAIL counts as text", () => {
    const summary: BatchSummary = {
      status: "COMPLETE",
      succeeded: 2,
      failed: 0,
      failures: [],
    };
    expect(batchCompletionAnnouncement(summary)).toBe(
      "COMPLETE — OK 2 · FAIL 0",
    );
  });

  it("announces a failed batch without relying on color alone", () => {
    const summary: BatchSummary = {
      status: "FAILED",
      succeeded: 0,
      failed: 1,
      failures: [{ path: "/tmp/a.png", reason: "encode failed" }],
    };
    expect(batchCompletionAnnouncement(summary)).toBe(
      "FAILED — OK 0 · FAIL 1",
    );
  });

  it("announces a partial batch", () => {
    const summary: BatchSummary = {
      status: "PARTIAL",
      succeeded: 1,
      failed: 1,
      failures: [{ path: "/tmp/b.png", reason: "encode failed" }],
    };
    expect(batchCompletionAnnouncement(summary)).toBe(
      "PARTIAL — OK 1 · FAIL 1",
    );
  });
});

describe("opsPhaseStatusText", () => {
  it("returns explicit textual status for terminal phases", () => {
    expect(opsPhaseStatusText("COMPLETE")).toBe("COMPLETE");
    expect(opsPhaseStatusText("FAILED")).toBe("FAILED");
    expect(opsPhaseStatusText("PARTIAL")).toBe("PARTIAL");
  });
});

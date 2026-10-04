import { describe, expect, it } from "vitest";
import type { JobInfo } from "../ipc/compress";
import {
  activeJobIds,
  applyCompressEvent,
  deriveOpsPhase,
  formatByteMeter,
  jobStatusToPhase,
  markAborting,
  sizeDeltaLabel,
  upsertJob,
  type ProgressRow,
} from "./progressState";

const baseJob = (over: Partial<JobInfo> = {}): JobInfo => ({
  id: "job-1",
  sourcePath: "/tmp/a.png",
  mediaKind: "image",
  presetId: "stub",
  status: "queued",
  percent: 0,
  originalBytes: 1000,
  ...over,
});

const row = (over: Partial<ProgressRow> = {}): ProgressRow => ({
  jobId: "job-1",
  sourcePath: "/tmp/a.png",
  mediaKind: "image",
  presetId: "stub",
  phase: "AWAITING",
  percent: 0,
  bytesTotal: 1000,
  originalBytes: 1000,
  ...over,
});

describe("jobStatusToPhase", () => {
  it("maps IPC statuses to Ice HUD ops phases", () => {
    expect(jobStatusToPhase("queued")).toBe("AWAITING");
    expect(jobStatusToPhase("running")).toBe("COMPRESSING");
    expect(jobStatusToPhase("completed")).toBe("COMPLETE");
    expect(jobStatusToPhase("failed")).toBe("FAILED");
    expect(jobStatusToPhase("cancelled")).toBe("FAILED");
  });
});

describe("upsertJob", () => {
  it("appends a new job row from JobInfo", () => {
    const rows = upsertJob([], baseJob());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId: "job-1",
      sourcePath: "/tmp/a.png",
      phase: "AWAITING",
      bytesTotal: 1000,
    });
  });

  it("replaces an existing job by id", () => {
    const first = upsertJob([], baseJob());
    const next = upsertJob(
      first,
      baseJob({ status: "running", percent: 40 }),
    );
    expect(next).toHaveLength(1);
    expect(next[0].phase).toBe("COMPRESSING");
    expect(next[0].percent).toBe(40);
  });
});

describe("applyCompressEvent", () => {
  it("updates percent and bytes on progress without refresh", () => {
    const rows = applyCompressEvent([row({ phase: "COMPRESSING" })], {
      type: "progress",
      jobId: "job-1",
      percent: 40,
      bytesProcessed: 400,
      bytesTotal: 1000,
    });
    expect(rows[0]).toMatchObject({
      phase: "COMPRESSING",
      percent: 40,
      bytesProcessed: 400,
      bytesTotal: 1000,
    });
  });

  it("keeps ABORTING phase when progress arrives during cancel", () => {
    const rows = applyCompressEvent([row({ phase: "ABORTING" })], {
      type: "progress",
      jobId: "job-1",
      percent: 20,
      bytesProcessed: 200,
      bytesTotal: 1000,
    });
    expect(rows[0].phase).toBe("ABORTING");
    expect(rows[0].percent).toBe(20);
  });

  it("records output path and size delta fields on complete", () => {
    const rows = applyCompressEvent([row({ phase: "COMPRESSING" })], {
      type: "complete",
      jobId: "job-1",
      outputPath: "/tmp/a_compressed.stub",
      originalBytes: 1000,
      resultBytes: 120,
      durationMs: 80,
    });
    expect(rows[0]).toMatchObject({
      phase: "COMPLETE",
      percent: 100,
      outputPath: "/tmp/a_compressed.stub",
      originalBytes: 1000,
      resultBytes: 120,
      durationMs: 80,
    });
  });

  it("records terse error on failed", () => {
    const rows = applyCompressEvent([row({ phase: "COMPRESSING" })], {
      type: "failed",
      jobId: "job-1",
      error: "encoder crashed",
    });
    expect(rows[0].phase).toBe("FAILED");
    expect(rows[0].error).toBe("encoder crashed");
  });

  it("ignores events for unknown jobs", () => {
    const start = [row()];
    const rows = applyCompressEvent(start, {
      type: "progress",
      jobId: "missing",
      percent: 50,
    });
    expect(rows).toBe(start);
  });
});

describe("markAborting + deriveOpsPhase", () => {
  it("transitions active rows to ABORTING then FAILED after cancel event", () => {
    const active = [
      row({ jobId: "job-1", phase: "COMPRESSING" }),
      row({ jobId: "job-2", phase: "AWAITING", sourcePath: "/tmp/b.png" }),
    ];
    const aborting = markAborting(active, ["job-1", "job-2"]);
    expect(aborting.every((r) => r.phase === "ABORTING")).toBe(true);
    expect(deriveOpsPhase(aborting)).toBe("ABORTING");

    const terminal = applyCompressEvent(aborting, {
      type: "failed",
      jobId: "job-1",
      error: "cancelled",
    });
    const both = applyCompressEvent(terminal, {
      type: "failed",
      jobId: "job-2",
      error: "cancelled",
    });
    expect(both.every((r) => r.phase === "FAILED")).toBe(true);
    expect(deriveOpsPhase(both)).toBe("FAILED");
  });

  it("derives COMPRESSING while any row is active", () => {
    expect(
      deriveOpsPhase([
        row({ phase: "COMPLETE" }),
        row({ jobId: "job-2", phase: "COMPRESSING" }),
      ]),
    ).toBe("COMPRESSING");
  });

  it("derives COMPLETE when all rows complete", () => {
    expect(deriveOpsPhase([row({ phase: "COMPLETE" })])).toBe("COMPLETE");
  });

  it("derives AWAITING with no rows", () => {
    expect(deriveOpsPhase([])).toBe("AWAITING");
  });
});

describe("activeJobIds", () => {
  it("returns only non-terminal job ids", () => {
    expect(
      activeJobIds([
        row({ jobId: "a", phase: "COMPRESSING" }),
        row({ jobId: "b", phase: "COMPLETE" }),
        row({ jobId: "c", phase: "ABORTING" }),
      ]),
    ).toEqual(["a", "c"]);
  });
});

describe("formatByteMeter / sizeDeltaLabel", () => {
  const fmt = (n: number) => `${n} B`;

  it("formats processed / total meter text", () => {
    expect(formatByteMeter(400, 1000, fmt)).toBe("400 B / 1000 B");
    expect(formatByteMeter(undefined, undefined, fmt)).toBe("—");
  });

  it("formats savings delta when both sizes exist", () => {
    expect(sizeDeltaLabel(1000, 120, fmt)).toBe("−880 B");
    expect(sizeDeltaLabel(100, 120, fmt)).toBe("+20 B");
    expect(sizeDeltaLabel(100, undefined, fmt)).toBeNull();
  });
});

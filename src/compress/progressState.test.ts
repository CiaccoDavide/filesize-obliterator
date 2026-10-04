import { describe, expect, it } from "vitest";
import type { JobInfo } from "../ipc/compress";
import {
  abortSurfaceErrorFromCancelResults,
  activeJobIds,
  applyCancelResults,
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
    expect(jobStatusToPhase("skipped")).toBe("SKIPPED");
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

  it("upserts a placeholder when progress arrives before start await", () => {
    const rows = applyCompressEvent([], {
      type: "progress",
      jobId: "early-1",
      percent: 50,
      bytesProcessed: 500,
      bytesTotal: 1000,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId: "early-1",
      phase: "COMPRESSING",
      percent: 50,
      bytesProcessed: 500,
      sourcePath: "—",
    });
  });

  it("keeps early progress when upsertJob arrives after the event", () => {
    const early = applyCompressEvent([], {
      type: "progress",
      jobId: "job-1",
      percent: 40,
      bytesProcessed: 400,
      bytesTotal: 1000,
    });
    const merged = upsertJob(
      early,
      baseJob({ status: "queued", percent: 0 }),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      jobId: "job-1",
      sourcePath: "/tmp/a.png",
      phase: "COMPRESSING",
      percent: 40,
      bytesProcessed: 400,
    });
  });

  it("applies complete before start await without dropping the event", () => {
    const rows = applyCompressEvent([], {
      type: "complete",
      jobId: "early-done",
      outputPath: "/tmp/out.stub",
      originalBytes: 1000,
      resultBytes: 100,
      durationMs: 12,
    });
    expect(rows[0]).toMatchObject({
      jobId: "early-done",
      phase: "COMPLETE",
      outputPath: "/tmp/out.stub",
      resultBytes: 100,
    });
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

  it("derives SKIPPED when finished rows are only skips", () => {
    expect(deriveOpsPhase([row({ phase: "SKIPPED" })])).toBe("SKIPPED");
    expect(
      deriveOpsPhase([
        row({ phase: "SKIPPED" }),
        row({ jobId: "job-2", phase: "COMPLETE" }),
      ]),
    ).toBe("COMPLETE");
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

describe("applyCancelResults", () => {
  it("upserts compressCancel JobInfo so rows leave ABORTING", () => {
    const aborting = markAborting(
      [row({ phase: "COMPRESSING" })],
      ["job-1"],
    );
    expect(aborting[0].phase).toBe("ABORTING");

    const next = applyCancelResults(aborting, ["job-1"], [
      {
        status: "fulfilled",
        value: baseJob({
          status: "cancelled",
          percent: 20,
          error: "cancelled",
        }),
      },
    ]);
    expect(next[0].phase).toBe("FAILED");
    expect(next[0].error).toBe("cancelled");
    expect(deriveOpsPhase(next)).toBe("FAILED");
  });

  it("marks FAILED on cancel rejection so rows never stick in ABORTING", () => {
    const aborting = markAborting(
      [
        row({ jobId: "job-1", phase: "COMPRESSING" }),
        row({ jobId: "job-2", phase: "AWAITING", sourcePath: "/tmp/b.png" }),
      ],
      ["job-1", "job-2"],
    );

    const next = applyCancelResults(aborting, ["job-1", "job-2"], [
      {
        status: "fulfilled",
        value: baseJob({ status: "cancelled", error: "cancelled" }),
      },
      { status: "rejected", reason: new Error("ipc down") },
    ]);

    expect(next.find((r) => r.jobId === "job-1")?.phase).toBe("FAILED");
    expect(next.find((r) => r.jobId === "job-2")).toMatchObject({
      phase: "FAILED",
      error: "ipc down",
    });
    expect(next.every((r) => r.phase !== "ABORTING")).toBe(true);
    expect(deriveOpsPhase(next)).toBe("FAILED");
  });

  it("keeps COMPLETE when cancel rejects after the job already finished", () => {
    const completed = applyCompressEvent(
      [row({ phase: "ABORTING", percent: 90 })],
      {
        type: "complete",
        jobId: "job-1",
        outputPath: "/tmp/a_compressed.stub",
        originalBytes: 1000,
        resultBytes: 120,
        durationMs: 40,
      },
    );
    expect(completed[0].phase).toBe("COMPLETE");

    const next = applyCancelResults(completed, ["job-1"], [
      {
        status: "rejected",
        reason: new Error("job already finished"),
      },
    ]);

    expect(next[0]).toMatchObject({
      phase: "COMPLETE",
      outputPath: "/tmp/a_compressed.stub",
      resultBytes: 120,
      error: undefined,
    });
    expect(deriveOpsPhase(next)).toBe("COMPLETE");
  });

  it("keeps FAILED when cancel rejects after an already-failed terminal row", () => {
    const failed = [
      row({
        phase: "FAILED",
        error: "encoder crashed",
      }),
    ];
    const next = applyCancelResults(failed, ["job-1"], [
      {
        status: "rejected",
        reason: new Error("job already finished"),
      },
    ]);
    expect(next[0]).toMatchObject({
      phase: "FAILED",
      error: "encoder crashed",
    });
  });
});

describe("abortSurfaceErrorFromCancelResults", () => {
  it("ignores job-already-finished reject when row is already COMPLETE", () => {
    const completed = [row({ phase: "COMPLETE", outputPath: "/tmp/out.stub" })];
    const error = abortSurfaceErrorFromCancelResults(completed, ["job-1"], [
      { status: "rejected", reason: new Error("job already finished") },
    ]);
    expect(error).toBeNull();
  });

  it("ignores job-already-finished reject when row is already FAILED", () => {
    const failed = [row({ phase: "FAILED", error: "encoder crashed" })];
    const error = abortSurfaceErrorFromCancelResults(failed, ["job-1"], [
      { status: "rejected", reason: new Error("job already finished") },
    ]);
    expect(error).toBeNull();
  });

  it("surfaces cancel reject for still-ABORTING rows", () => {
    const aborting = [row({ phase: "ABORTING" })];
    const error = abortSurfaceErrorFromCancelResults(aborting, ["job-1"], [
      { status: "rejected", reason: new Error("ipc down") },
    ]);
    expect(error).toBe("ipc down");
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

import { describe, expect, it } from "vitest";
import {
  buildBatchSummary,
  dismissFailedRows,
  failedRowsForRetry,
  normalizeOpsError,
  rowsAfterStallTimeout,
  type BatchSummary,
} from "./batchSummary";
import type { ProgressRow } from "./progressState";

const row = (over: Partial<ProgressRow> = {}): ProgressRow => ({
  jobId: "job-1",
  sourcePath: "/tmp/a.png",
  mediaKind: "image",
  presetId: "stub",
  phase: "AWAITING",
  percent: 0,
  ...over,
});

describe("normalizeOpsError", () => {
  it("maps permission failures to a terse ops line", () => {
    expect(normalizeOpsError("cannot read source: Permission denied (os error 13)")).toBe(
      "permission denied — cannot read source",
    );
    expect(normalizeOpsError("cannot write output: Operation not permitted")).toBe(
      "permission denied — cannot write output",
    );
    expect(normalizeOpsError("cannot create _compressed directory: Permission denied")).toBe(
      "permission denied — cannot write output",
    );
  });

  it("maps missing codec / tool to a distinct ops line", () => {
    expect(normalizeOpsError("missing codec: MP3 encoder rejected bitrate")).toBe(
      "missing codec — encoder unavailable",
    );
    expect(
      normalizeOpsError(
        "missing tool: ffmpeg (not found on PATH, beside the app, or via FFMPEG_PATH)",
      ),
    ).toBe("missing tool — ffmpeg unavailable");
    expect(normalizeOpsError("missing tool: ghostscript (failed to spawn binary)")).toBe(
      "missing tool — ghostscript unavailable",
    );
  });

  it("maps unsupported / corrupt types without burying the kind", () => {
    expect(normalizeOpsError("unsupported image format '.avif' (no offline decoder)")).toBe(
      "unsupported type — image",
    );
    expect(normalizeOpsError("unsupported or corrupt video: invalid data")).toBe(
      "unsupported or corrupt — video",
    );
    expect(normalizeOpsError("unsupported pdf format '.txt' (expected pdf)")).toBe(
      "unsupported type — pdf",
    );
  });

  it("keeps already-terse cancelled / unknown messages", () => {
    expect(normalizeOpsError("cancelled")).toBe("cancelled");
    expect(normalizeOpsError("encoder crashed")).toBe("encoder crashed");
  });
});

describe("buildBatchSummary", () => {
  it("returns null while any row is still active", () => {
    expect(
      buildBatchSummary([
        row({ phase: "COMPLETE" }),
        row({ jobId: "job-2", phase: "COMPRESSING", sourcePath: "/tmp/b.png" }),
      ]),
    ).toBeNull();
  });

  it("reports partial success with per-item path + reason", () => {
    const summary = buildBatchSummary([
      row({
        jobId: "job-1",
        phase: "COMPLETE",
        sourcePath: "/tmp/a.png",
        outputPath: "/tmp/_compressed/a.webp",
      }),
      row({
        jobId: "job-2",
        phase: "FAILED",
        sourcePath: "/tmp/b.png",
        error: "permission denied — cannot read source",
      }),
    ]);
    expect(summary).toEqual<BatchSummary>({
      status: "PARTIAL",
      succeeded: 1,
      failed: 1,
      failures: [
        {
          path: "/tmp/b.png",
          reason: "permission denied — cannot read source",
        },
      ],
    });
  });

  it("reports COMPLETE when every row succeeded", () => {
    expect(
      buildBatchSummary([
        row({ phase: "COMPLETE" }),
        row({ jobId: "j2", phase: "COMPLETE", sourcePath: "/tmp/b.png" }),
      ]),
    ).toMatchObject({ status: "COMPLETE", succeeded: 2, failed: 0, failures: [] });
  });

  it("reports FAILED when every terminal row failed", () => {
    expect(
      buildBatchSummary([
        row({ phase: "FAILED", error: "missing codec — encoder unavailable" }),
      ]),
    ).toMatchObject({
      status: "FAILED",
      succeeded: 0,
      failed: 1,
      failures: [
        {
          path: "/tmp/a.png",
          reason: "missing codec — encoder unavailable",
        },
      ],
    });
  });
});

describe("failedRowsForRetry / dismissFailedRows", () => {
  it("selects only FAILED rows as retry candidates", () => {
    const rows = [
      row({ jobId: "ok", phase: "COMPLETE", sourcePath: "/tmp/a.png" }),
      row({
        jobId: "bad",
        phase: "FAILED",
        sourcePath: "/tmp/b.png",
        mediaKind: "video",
        presetId: "video-balanced",
        error: "unsupported or corrupt — video",
      }),
    ];
    expect(failedRowsForRetry(rows)).toEqual([
      {
        sourcePath: "/tmp/b.png",
        mediaKind: "video",
        presetId: "video-balanced",
      },
    ]);
  });

  it("dismisses failed rows without removing successes", () => {
    const rows = [
      row({ jobId: "ok", phase: "COMPLETE" }),
      row({ jobId: "bad", phase: "FAILED", error: "encoder crashed" }),
    ];
    expect(dismissFailedRows(rows).map((r) => r.jobId)).toEqual(["ok"]);
  });
});

describe("rowsAfterStallTimeout", () => {
  it("fails COMPRESSING rows with no progress past the stall window", () => {
    const now = 10_000;
    const stallMs = 5_000;
    const lastActivity = new Map<string, number>([
      ["job-stuck", 4_000],
      ["job-fresh", 8_000],
    ]);
    const next = rowsAfterStallTimeout(
      [
        row({ jobId: "job-stuck", phase: "COMPRESSING", percent: 12 }),
        row({ jobId: "job-fresh", phase: "COMPRESSING", percent: 40 }),
        row({ jobId: "job-done", phase: "COMPLETE", percent: 100 }),
      ],
      lastActivity,
      now,
      stallMs,
    );
    expect(next.find((r) => r.jobId === "job-stuck")).toMatchObject({
      phase: "FAILED",
      error: "encoder stalled — no progress",
      outputPath: undefined,
    });
    expect(next.find((r) => r.jobId === "job-fresh")?.phase).toBe("COMPRESSING");
    expect(next.find((r) => r.jobId === "job-done")?.phase).toBe("COMPLETE");
  });

  it("does not stall AWAITING or ABORTING rows", () => {
    const now = 10_000;
    const lastActivity = new Map<string, number>([["job-wait", 0]]);
    const next = rowsAfterStallTimeout(
      [row({ jobId: "job-wait", phase: "AWAITING" })],
      lastActivity,
      now,
      1,
    );
    expect(next[0].phase).toBe("AWAITING");
  });
});

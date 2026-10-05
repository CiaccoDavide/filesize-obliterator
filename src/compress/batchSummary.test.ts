import { describe, expect, it } from "vitest";
import {
  buildBatchSummary,
  dismissFailedRows,
  failedRowsForRetry,
  normalizeOpsError,
  stalledJobIds,
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

  it("ignores older-generation FAILED after a later successful batch", () => {
    expect(
      buildBatchSummary([
        row({
          jobId: "old-fail",
          phase: "FAILED",
          sourcePath: "/tmp/old.png",
          error: "encoder crashed",
          batchGeneration: 1,
        }),
        row({
          jobId: "new-ok",
          phase: "COMPLETE",
          sourcePath: "/tmp/new.png",
          outputPath: "/tmp/_compressed/new.webp",
          batchGeneration: 2,
        }),
      ]),
    ).toMatchObject({
      status: "COMPLETE",
      succeeded: 1,
      failed: 0,
      failures: [],
    });
  });

  it("scopes summary to the latest advanced admission generation", () => {
    // begin() now advances from 0 → 1 → 2, so untagged/gen-0 rows must not pollute.
    expect(
      buildBatchSummary([
        row({
          jobId: "untagged-fail",
          phase: "FAILED",
          sourcePath: "/tmp/old.png",
          error: "encoder crashed",
        }),
        row({
          jobId: "gen2-ok",
          phase: "COMPLETE",
          sourcePath: "/tmp/new.png",
          outputPath: "/tmp/_compressed/new.webp",
          batchGeneration: 2,
        }),
      ]),
    ).toMatchObject({
      status: "COMPLETE",
      succeeded: 1,
      failed: 0,
      failures: [],
    });
  });

  it("includes watch rows stamped with the current admission generation", () => {
    // After a manual COMPRESS (gen ≥ 1), watch enqueue must stamp the same
    // generation or COMPLETE/FAILED watch rows are filtered out of the summary.
    expect(
      buildBatchSummary([
        row({
          jobId: "manual-ok",
          phase: "COMPLETE",
          sourcePath: "/tmp/manual.png",
          outputPath: "/tmp/_compressed/manual.webp",
          batchGeneration: 1,
        }),
        row({
          jobId: "watch-ok",
          phase: "COMPLETE",
          sourcePath: "/tmp/watch.png",
          outputPath: "/tmp/_compressed/watch.webp",
          batchGeneration: 1,
        }),
        row({
          jobId: "watch-fail",
          phase: "FAILED",
          sourcePath: "/tmp/watch-bad.png",
          error: "encoder crashed",
          batchGeneration: 1,
        }),
      ]),
    ).toMatchObject({
      status: "PARTIAL",
      succeeded: 2,
      failed: 1,
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


  it("excludes FAILED rows without a presetId", () => {
    const rows = [
      row({
        jobId: "no-preset",
        phase: "FAILED",
        sourcePath: "/tmp/pending.png",
        mediaKind: "video",
        presetId: "",
        error: "cancelled",
      }),
      row({
        jobId: "ready",
        phase: "FAILED",
        sourcePath: "/tmp/ready.png",
        mediaKind: "image",
        presetId: "stub",
        error: "encoder crashed",
      }),
    ];
    expect(failedRowsForRetry(rows)).toEqual([
      {
        sourcePath: "/tmp/ready.png",
        mediaKind: "image",
        presetId: "stub",
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

describe("stalledJobIds", () => {
  it("returns COMPRESSING video jobs silent past the stall window", () => {
    const now = 10_000;
    const stallMs = 5_000;
    const lastActivity = new Map<string, number>([
      ["job-stuck", 4_000],
      ["job-fresh", 8_000],
    ]);
    expect(
      stalledJobIds(
        [
          row({
            jobId: "job-stuck",
            phase: "COMPRESSING",
            mediaKind: "video",
            percent: 12,
          }),
          row({
            jobId: "job-fresh",
            phase: "COMPRESSING",
            mediaKind: "video",
            percent: 40,
          }),
          row({
            jobId: "job-done",
            phase: "COMPLETE",
            mediaKind: "video",
            percent: 100,
          }),
        ],
        lastActivity,
        now,
        stallMs,
      ),
    ).toEqual(["job-stuck"]);
  });

  it("does not stall AWAITING or ABORTING video rows", () => {
    const now = 10_000;
    const lastActivity = new Map<string, number>([
      ["job-wait", 0],
      ["job-abort", 0],
    ]);
    expect(
      stalledJobIds(
        [
          row({
            jobId: "job-wait",
            phase: "AWAITING",
            mediaKind: "video",
          }),
          row({
            jobId: "job-abort",
            phase: "ABORTING",
            mediaKind: "video",
          }),
        ],
        lastActivity,
        now,
        1,
      ),
    ).toEqual([]);
  });

  it("does not treat sparse image/audio/pdf silence as a stall", () => {
    const now = 60_000;
    const stallMs = 5_000;
    // Explicit sparse window well above the 59s silence — short video window still fires.
    const sparseStallMs = 10 * 60_000;
    const lastActivity = new Map<string, number>([
      ["img", 1_000],
      ["aud", 1_000],
      ["pdf", 1_000],
      ["vid", 1_000],
    ]);
    expect(
      stalledJobIds(
        [
          row({
            jobId: "img",
            phase: "COMPRESSING",
            mediaKind: "image",
            percent: 20,
          }),
          row({
            jobId: "aud",
            phase: "COMPRESSING",
            mediaKind: "audio",
            percent: 20,
          }),
          row({
            jobId: "pdf",
            phase: "COMPRESSING",
            mediaKind: "pdf",
            percent: 20,
          }),
          row({
            jobId: "vid",
            phase: "COMPRESSING",
            mediaKind: "video",
            percent: 20,
          }),
        ],
        lastActivity,
        now,
        stallMs,
        sparseStallMs,
      ),
    ).toEqual(["vid"]);
  });

  it("stalls hung image/audio/pdf after the sparse window", () => {
    const now = 700_000;
    const lastActivity = new Map<string, number>([
      ["img", 1_000],
      ["aud", 1_000],
      ["pdf", 1_000],
      ["fresh-img", 650_000],
    ]);
    expect(
      stalledJobIds(
        [
          row({
            jobId: "img",
            phase: "COMPRESSING",
            mediaKind: "image",
            percent: 20,
          }),
          row({
            jobId: "aud",
            phase: "COMPRESSING",
            mediaKind: "audio",
            percent: 20,
          }),
          row({
            jobId: "pdf",
            phase: "COMPRESSING",
            mediaKind: "pdf",
            percent: 20,
          }),
          row({
            jobId: "fresh-img",
            phase: "COMPRESSING",
            mediaKind: "image",
            percent: 20,
          }),
        ],
        lastActivity,
        now,
        45_000,
        10 * 60_000,
      ),
    ).toEqual(["img", "aud", "pdf"]);
  });
});

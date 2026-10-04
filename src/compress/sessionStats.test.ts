import { describe, expect, it } from "vitest";
import type { ProgressRow } from "./progressState";
import {
  aggregateSessionStats,
  formatSavePercent,
  formatSignedBytes,
} from "./sessionStats";

function row(partial: Partial<ProgressRow> & Pick<ProgressRow, "jobId" | "phase">): ProgressRow {
  return {
    sourcePath: partial.sourcePath ?? "/a",
    mediaKind: partial.mediaKind ?? "image",
    presetId: partial.presetId ?? "img-balanced",
    percent: partial.percent ?? (partial.phase === "COMPLETE" ? 100 : 0),
    ...partial,
  };
}

describe("aggregateSessionStats", () => {
  it("starts empty for no rows", () => {
    expect(aggregateSessionStats([])).toEqual({
      filesDone: 0,
      filesFailed: 0,
      bytesIn: 0,
      bytesOut: 0,
      bytesSaved: 0,
      savePercent: null,
    });
  });

  it("aggregates true byte totals after a successful batch", () => {
    const stats = aggregateSessionStats([
      row({
        jobId: "1",
        phase: "COMPLETE",
        originalBytes: 2048,
        resultBytes: 512,
      }),
      row({
        jobId: "2",
        phase: "COMPLETE",
        originalBytes: 4096,
        resultBytes: 1024,
      }),
    ]);
    expect(stats).toEqual({
      filesDone: 2,
      filesFailed: 0,
      bytesIn: 6144,
      bytesOut: 1536,
      bytesSaved: 4608,
      savePercent: 75,
    });
  });

  it("does not count failed jobs toward savings", () => {
    const stats = aggregateSessionStats([
      row({
        jobId: "ok",
        phase: "COMPLETE",
        originalBytes: 1000,
        resultBytes: 400,
      }),
      row({
        jobId: "bad",
        phase: "FAILED",
        originalBytes: 99999,
        resultBytes: 1,
        error: "boom",
      }),
    ]);
    expect(stats.filesDone).toBe(1);
    expect(stats.filesFailed).toBe(1);
    expect(stats.bytesIn).toBe(1000);
    expect(stats.bytesOut).toBe(400);
    expect(stats.bytesSaved).toBe(600);
    expect(stats.savePercent).toBe(60);
  });

  it("ignores in-flight rows for byte meters", () => {
    const stats = aggregateSessionStats([
      row({
        jobId: "run",
        phase: "COMPRESSING",
        originalBytes: 8000,
        bytesTotal: 8000,
        percent: 40,
      }),
      row({
        jobId: "done",
        phase: "COMPLETE",
        originalBytes: 2000,
        resultBytes: 500,
      }),
    ]);
    expect(stats.filesDone).toBe(1);
    expect(stats.filesFailed).toBe(0);
    expect(stats.bytesIn).toBe(2000);
    expect(stats.bytesOut).toBe(500);
    expect(stats.bytesSaved).toBe(1500);
  });

  it("resets to empty when finished rows are cleared", () => {
    const before = [
      row({
        jobId: "1",
        phase: "COMPLETE",
        originalBytes: 1000,
        resultBytes: 250,
      }),
      row({ jobId: "2", phase: "FAILED", error: "x" }),
    ];
    expect(aggregateSessionStats(before).filesDone).toBe(1);
    const afterClear = before.filter(
      (r) => r.phase !== "COMPLETE" && r.phase !== "FAILED",
    );
    expect(aggregateSessionStats(afterClear)).toEqual({
      filesDone: 0,
      filesFailed: 0,
      bytesIn: 0,
      bytesOut: 0,
      bytesSaved: 0,
      savePercent: null,
    });
  });

  it("skips complete rows missing size fields", () => {
    const stats = aggregateSessionStats([
      row({ jobId: "1", phase: "COMPLETE" }),
      row({
        jobId: "2",
        phase: "COMPLETE",
        originalBytes: 1000,
        resultBytes: 250,
      }),
    ]);
    expect(stats.filesDone).toBe(2);
    expect(stats.bytesIn).toBe(1000);
    expect(stats.bytesOut).toBe(250);
    expect(stats.savePercent).toBe(75);
  });

  it("keeps signed savings when output exceeds input", () => {
    const stats = aggregateSessionStats([
      row({
        jobId: "grow",
        phase: "COMPLETE",
        originalBytes: 1000,
        resultBytes: 1500,
      }),
    ]);
    expect(stats.bytesSaved).toBe(-500);
    expect(stats.savePercent).toBe(-50);
  });
});

describe("formatSignedBytes", () => {
  it("formats positive and negative aggregates", () => {
    expect(formatSignedBytes(512)).toBe("512 B");
    expect(formatSignedBytes(-512)).toBe("-512 B");
    expect(formatSignedBytes(0)).toBe("0 B");
  });
});

describe("formatSavePercent", () => {
  it("renders dash when unknown", () => {
    expect(formatSavePercent(null)).toBe("—");
  });

  it("formats compact percentages", () => {
    expect(formatSavePercent(75)).toBe("75%");
    expect(formatSavePercent(12.34)).toBe("12.3%");
    expect(formatSavePercent(9.4)).toBe("9.4%");
    expect(formatSavePercent(100)).toBe("100%");
  });

  it("keeps one decimal under 100 for signed values", () => {
    expect(formatSavePercent(-12.34)).toBe("-12.3%");
    expect(formatSavePercent(-9.4)).toBe("-9.4%");
    expect(formatSavePercent(-100)).toBe("-100%");
  });
});

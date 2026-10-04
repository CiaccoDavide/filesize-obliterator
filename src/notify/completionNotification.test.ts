import { describe, expect, it, vi } from "vitest";
import type { BatchSummary } from "../compress/batchSummary";
import type { ProgressRow } from "../compress/progressState";
import {
  bytesSavedForCurrentBatch,
  formatCompletionNotification,
  runCompletionNotification,
  shouldNotifyBatchComplete,
  type NotificationHost,
} from "./completionNotification";

const completeSummary: BatchSummary = {
  status: "COMPLETE",
  succeeded: 3,
  failed: 0,
  failures: [],
};

const partialSummary: BatchSummary = {
  status: "PARTIAL",
  succeeded: 2,
  failed: 1,
  failures: [{ path: "/a.png", reason: "encode failed" }],
};

function row(
  partial: Partial<ProgressRow> & Pick<ProgressRow, "jobId" | "phase">,
): ProgressRow {
  return {
    sourcePath: "/x.bin",
    mediaKind: "image",
    presetId: "image-small",
    percent: 100,
    ...partial,
  };
}

describe("formatCompletionNotification", () => {
  it("builds a terse COMPLETE body with OK/FAIL counts", () => {
    expect(formatCompletionNotification(completeSummary)).toEqual({
      title: "COMPLETE",
      body: "OK 3 · FAIL 0",
    });
  });

  it("appends saved bytes when available", () => {
    expect(
      formatCompletionNotification(completeSummary, { bytesSaved: 1_572_864 }),
    ).toEqual({
      title: "COMPLETE",
      body: "OK 3 · FAIL 0 · saved 1.5 MiB",
    });
  });

  it("omits saved when bytes are unavailable", () => {
    expect(
      formatCompletionNotification(partialSummary, { bytesSaved: null }),
    ).toEqual({
      title: "PARTIAL",
      body: "OK 2 · FAIL 1",
    });
  });
});

describe("shouldNotifyBatchComplete", () => {
  it("notifies only when enabled, unfocused, and summary present", () => {
    expect(
      shouldNotifyBatchComplete({
        enabled: true,
        focused: false,
        summary: completeSummary,
      }),
    ).toBe(true);
    expect(
      shouldNotifyBatchComplete({
        enabled: false,
        focused: false,
        summary: completeSummary,
      }),
    ).toBe(false);
    expect(
      shouldNotifyBatchComplete({
        enabled: true,
        focused: true,
        summary: completeSummary,
      }),
    ).toBe(false);
    expect(
      shouldNotifyBatchComplete({
        enabled: true,
        focused: false,
        summary: null,
      }),
    ).toBe(false);
  });
});

describe("bytesSavedForCurrentBatch", () => {
  it("sums savings for COMPLETE rows in the current generation", () => {
    const rows: ProgressRow[] = [
      row({
        jobId: "old",
        phase: "COMPLETE",
        batchGeneration: 1,
        originalBytes: 10_000,
        resultBytes: 1_000,
      }),
      row({
        jobId: "a",
        phase: "COMPLETE",
        batchGeneration: 2,
        originalBytes: 4096,
        resultBytes: 1024,
      }),
      row({
        jobId: "b",
        phase: "FAILED",
        batchGeneration: 2,
        error: "encode failed",
      }),
    ];
    expect(bytesSavedForCurrentBatch(rows)).toBe(3072);
  });

  it("returns null when no COMPLETE row has byte totals", () => {
    expect(
      bytesSavedForCurrentBatch([
        row({ jobId: "a", phase: "COMPLETE", batchGeneration: 1 }),
        row({
          jobId: "b",
          phase: "FAILED",
          batchGeneration: 1,
          error: "x",
        }),
      ]),
    ).toBeNull();
  });
});

describe("runCompletionNotification", () => {
  function host(overrides: Partial<NotificationHost> = {}): NotificationHost {
    return {
      isPermissionGranted: vi.fn().mockResolvedValue(true),
      requestPermission: vi.fn().mockResolvedValue("granted"),
      sendNotification: vi.fn(),
      ...overrides,
    };
  }

  it("does nothing when the gate fails", async () => {
    const h = host();
    await runCompletionNotification({
      enabled: false,
      focused: false,
      summary: completeSummary,
      host: h,
    });
    expect(h.sendNotification).not.toHaveBeenCalled();
  });

  it("requests permission when not granted, then sends", async () => {
    const h = host({
      isPermissionGranted: vi.fn().mockResolvedValue(false),
    });
    await runCompletionNotification({
      enabled: true,
      focused: false,
      summary: completeSummary,
      bytesSaved: 2048,
      host: h,
    });
    expect(h.requestPermission).toHaveBeenCalled();
    expect(h.sendNotification).toHaveBeenCalledWith({
      title: "COMPLETE",
      body: "OK 3 · FAIL 0 · saved 2 KiB",
    });
  });

  it("skips send when permission is denied", async () => {
    const h = host({
      isPermissionGranted: vi.fn().mockResolvedValue(false),
      requestPermission: vi.fn().mockResolvedValue("denied"),
    });
    await runCompletionNotification({
      enabled: true,
      focused: false,
      summary: completeSummary,
      host: h,
    });
    expect(h.sendNotification).not.toHaveBeenCalled();
  });
});

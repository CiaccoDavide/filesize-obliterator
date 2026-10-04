import { describe, expect, it, vi } from "vitest";
import {
  createBatchAdmissionController,
} from "./batchAdmission";
import { runEstimatePreview } from "./estimatePreview";
import type { EstimateItem } from "./estimateAggregate";

function item(path: string, presetId: string): EstimateItem {
  return {
    path,
    presetId,
    estimatedBytes: 100,
    confidence: "approximate",
    originalBytes: 1000,
  };
}

describe("runEstimatePreview", () => {
  it("drops in-flight results after the gate is aborted (stale presets)", async () => {
    const gate = createBatchAdmissionController();
    const token = gate.begin();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const estimateOne = vi.fn(async (file: { path: string; presetId: string }) => {
      await blocked;
      return item(file.path, file.presetId);
    });

    const pending = runEstimatePreview(
      [{ path: "/a.jpg", mediaKind: "image", presetId: "image-balanced" }],
      estimateOne,
      () => gate.isCurrent(token),
    );

    // Inputs/presets changed: clearEstimates aborts the gate.
    gate.abort();
    release();

    await expect(pending).resolves.toBeNull();
  });

  it("returns items when the generation stays current", async () => {
    const gate = createBatchAdmissionController();
    const token = gate.begin();
    const result = await runEstimatePreview(
      [{ path: "/a.jpg", mediaKind: "image", presetId: "image-balanced" }],
      async (file) => item(file.path, file.presetId),
      () => gate.isCurrent(token),
    );
    expect(result).toEqual([item("/a.jpg", "image-balanced")]);
  });
});

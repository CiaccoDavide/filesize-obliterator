import { describe, expect, it } from "vitest";
import {
  aggregateEstimates,
  estimateForStagedFile,
  formatEstimateDeltaPercent,
  formatEstimatedBytes,
  type EstimateItem,
} from "./estimateAggregate";

function item(partial: Partial<EstimateItem> & Pick<EstimateItem, "path">): EstimateItem {
  return {
    presetId: partial.presetId ?? "image-balanced",
    estimatedBytes: partial.estimatedBytes ?? 400,
    confidence: partial.confidence ?? "approximate",
    originalBytes: partial.originalBytes ?? 1000,
    ...partial,
  };
}

describe("estimateForStagedFile", () => {
  it("requires matching path and presetId", () => {
    const byPath = new Map<string, EstimateItem>([
      ["/a.jpg", item({ path: "/a.jpg", presetId: "image-balanced", estimatedBytes: 100 })],
    ]);
    expect(
      estimateForStagedFile(byPath, { path: "/a.jpg", presetId: "image-balanced" })
        ?.estimatedBytes,
    ).toBe(100);
    expect(
      estimateForStagedFile(byPath, { path: "/a.jpg", presetId: "image-small" }),
    ).toBeUndefined();
    expect(
      estimateForStagedFile(byPath, { path: "/b.jpg", presetId: "image-balanced" }),
    ).toBeUndefined();
    expect(
      estimateForStagedFile(undefined, { path: "/a.jpg", presetId: "image-balanced" }),
    ).toBeUndefined();
  });
});

describe("aggregateEstimates", () => {
  it("starts empty", () => {
    expect(aggregateEstimates([])).toEqual({
      stagedBytes: 0,
      estimatedBytes: 0,
      deltaBytes: 0,
      deltaPercent: null,
      approximate: false,
      count: 0,
    });
  });

  it("sums staged and estimated bytes with signed delta percent", () => {
    const agg = aggregateEstimates([
      item({ path: "/a", originalBytes: 2000, estimatedBytes: 800 }),
      item({ path: "/b", originalBytes: 2000, estimatedBytes: 400 }),
    ]);
    expect(agg).toEqual({
      stagedBytes: 4000,
      estimatedBytes: 1200,
      deltaBytes: 2800,
      deltaPercent: 70,
      approximate: true,
      count: 2,
    });
  });

  it("marks aggregate exact only when every item is exact", () => {
    expect(
      aggregateEstimates([
        item({ path: "/a", confidence: "exact" }),
        item({ path: "/b", confidence: "exact" }),
      ]).approximate,
    ).toBe(false);
    expect(
      aggregateEstimates([
        item({ path: "/a", confidence: "exact" }),
        item({ path: "/b", confidence: "approximate" }),
      ]).approximate,
    ).toBe(true);
  });
});

describe("formatEstimateDeltaPercent", () => {
  it("prefixes tilde when approximate", () => {
    expect(formatEstimateDeltaPercent(70, true)).toBe("~70%");
    expect(formatEstimateDeltaPercent(70, false)).toBe("70%");
    expect(formatEstimateDeltaPercent(null, true)).toBe("—");
  });
});

describe("formatEstimatedBytes", () => {
  it("labels missing and approximate estimates", () => {
    expect(formatEstimatedBytes(undefined, undefined)).toBe("EST —");
    expect(formatEstimatedBytes(512, "approximate")).toBe("~512 B");
    expect(formatEstimatedBytes(512, "exact")).toBe("512 B");
  });
});

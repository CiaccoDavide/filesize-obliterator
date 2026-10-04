import { formatBytes } from "../intake/formatBytes";
import { formatSavePercent } from "./sessionStats";
import type { EstimateConfidence } from "../ipc/compress";

/** One dry-run row from `compress_estimate` (or local join of path + staged bytes). */
export type EstimateItem = {
  path: string;
  presetId: string;
  estimatedBytes: number;
  confidence: EstimateConfidence;
  originalBytes: number;
};

export type EstimateAggregate = {
  stagedBytes: number;
  estimatedBytes: number;
  /** Signed: staged − estimated. */
  deltaBytes: number;
  /** Null when stagedBytes is 0. */
  deltaPercent: number | null;
  /** True when any item is not exact. */
  approximate: boolean;
  count: number;
};

/** Aggregate staged → estimated → Δ% for the PREVIEW summary strip. */
export function aggregateEstimates(items: EstimateItem[]): EstimateAggregate {
  let stagedBytes = 0;
  let estimatedBytes = 0;
  let approximate = false;

  for (const item of items) {
    stagedBytes += item.originalBytes;
    estimatedBytes += item.estimatedBytes;
    if (item.confidence !== "exact") approximate = true;
  }

  const deltaBytes = stagedBytes - estimatedBytes;
  const deltaPercent =
    stagedBytes > 0 ? (deltaBytes / stagedBytes) * 100 : null;

  return {
    stagedBytes,
    estimatedBytes,
    deltaBytes,
    deltaPercent,
    approximate: items.length > 0 ? approximate : false,
    count: items.length,
  };
}

/** Compact Δ% label for the preview strip (`~12.3%` when approximate). */
export function formatEstimateDeltaPercent(
  deltaPercent: number | null,
  approximate: boolean,
): string {
  const base = formatSavePercent(deltaPercent);
  if (base === "—") return base;
  return approximate ? `~${base}` : base;
}

/** Per-row estimate label (`~1.2 MiB` / `EST —`). */
export function formatEstimatedBytes(
  estimatedBytes: number | undefined,
  confidence: EstimateConfidence | undefined,
): string {
  if (typeof estimatedBytes !== "number" || !Number.isFinite(estimatedBytes)) {
    return "EST —";
  }
  const body = formatBytes(estimatedBytes);
  return confidence === "exact" ? body : `~${body}`;
}

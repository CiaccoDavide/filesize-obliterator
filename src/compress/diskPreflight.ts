import type { DiskPreflightItem as IpcDiskPreflightItem } from "../ipc/compress";
import { formatBytes } from "../intake/formatBytes";
import { estimateForStagedFile, type EstimateItem } from "./estimateAggregate";

/**
 * Disk preflight constants (also documented in README / PR).
 *
 * - Block when freeBytes < neededBytes
 * - Warn when freeBytes < neededBytes * DISK_WARN_RATIO (override allowed)
 * - neededBytes = sum(estimate or source×DISK_MISSING_ESTIMATE_MULTIPLIER) + DISK_HEADROOM_BYTES
 */
export const DISK_WARN_RATIO = 1.25;
/** Modest per-batch headroom for temp files / filesystem slack. */
export const DISK_HEADROOM_BYTES = 64 * 1024 * 1024;
/** When dry-run estimate is missing, assume write ≈ 110% of source. */
export const DISK_MISSING_ESTIMATE_MULTIPLIER = 1.1;

export type DiskPreflightMode = "block" | "warn" | "ok";

export type DiskPreflightItem = {
  originalBytes: number;
  estimatedBytes?: number;
};

export type DiskPreflightResult = {
  /** False only in block mode (start must not proceed). */
  ok: boolean;
  freeBytes: number;
  neededBytes: number;
  mode: DiskPreflightMode;
};

/** Worst-case write budget for a batch before comparing to free space. */
export function computeNeededBytes(items: DiskPreflightItem[]): number {
  let sum = 0;
  for (const item of items) {
    const estimate = item.estimatedBytes;
    if (typeof estimate === "number" && Number.isFinite(estimate) && estimate >= 0) {
      sum += Math.ceil(estimate);
    } else {
      const source = Number.isFinite(item.originalBytes) && item.originalBytes > 0
        ? item.originalBytes
        : 0;
      sum += Math.ceil(source * DISK_MISSING_ESTIMATE_MULTIPLIER);
    }
  }
  return sum + DISK_HEADROOM_BYTES;
}

/** Classify free vs needed using the project defaults. */
export function classifyDiskPreflight(
  freeBytes: number,
  neededBytes: number,
): DiskPreflightResult {
  const free = Math.max(0, Math.floor(freeBytes));
  const needed = Math.max(0, Math.ceil(neededBytes));
  if (free < needed) {
    return { ok: false, freeBytes: free, neededBytes: needed, mode: "block" };
  }
  if (free < needed * DISK_WARN_RATIO) {
    return { ok: true, freeBytes: free, neededBytes: needed, mode: "warn" };
  }
  return { ok: true, freeBytes: free, neededBytes: needed, mode: "ok" };
}

/** Terse HUD line: `DISK LOW — free X / need Y`. */
export function formatDiskPreflightMessage(
  result: Pick<DiskPreflightResult, "freeBytes" | "neededBytes" | "mode">,
): string {
  const free = formatBytes(result.freeBytes);
  const need = formatBytes(result.neededBytes);
  if (result.mode === "warn") {
    return `DISK LOW — free ${free} / need ${need} (tight — override to continue)`;
  }
  return `DISK LOW — free ${free} / need ${need}`;
}

type StagedForPreflight = {
  path: string;
  bytes: number;
  presetId: string;
};

/**
 * Build IPC items from staged files, joining PREVIEW estimates only when
 * path+preset match (same rule as the estimate strip).
 */
export function buildDiskPreflightItems(
  files: StagedForPreflight[],
  estimatesByPath?: Map<string, EstimateItem>,
): IpcDiskPreflightItem[] {
  return files
    .filter((f) => f.presetId)
    .map((f) => {
      const est = estimateForStagedFile(estimatesByPath, f);
      const item: IpcDiskPreflightItem = {
        sourcePath: f.path,
        originalBytes: f.bytes,
      };
      if (est && Number.isFinite(est.estimatedBytes) && est.estimatedBytes >= 0) {
        item.estimatedBytes = est.estimatedBytes;
      }
      return item;
    });
}

import type { EstimateItem } from "./estimateAggregate";
import type { MediaKind } from "../ipc/compress";

/** One staged file ready for dry-run estimate (has a preset). */
export type EstimateTarget = {
  path: string;
  mediaKind: MediaKind;
  presetId: string;
};

/**
 * Collect dry-run estimates sequentially. Returns `null` when `isCurrent`
 * flips false mid-flight so callers can drop stale PREVIEW results.
 */
export async function runEstimatePreview(
  files: EstimateTarget[],
  estimateOne: (file: EstimateTarget) => Promise<EstimateItem>,
  isCurrent: () => boolean,
): Promise<EstimateItem[] | null> {
  const next: EstimateItem[] = [];
  for (const file of files) {
    if (!isCurrent()) return null;
    const item = await estimateOne(file);
    if (!isCurrent()) return null;
    next.push(item);
  }
  return isCurrent() ? next : null;
}

import { useCallback, useMemo, useState } from "react";
import {
  aggregateEstimates,
  type EstimateItem,
} from "../compress/estimateAggregate";
import { compressEstimate } from "../ipc/compress";
import type { StagedFile } from "../intake/types";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Dry-run PREVIEW path: call compress_estimate per staged file with its current preset.
 * Never starts encode jobs; never writes `_compressed`.
 */
export function useCompressEstimate() {
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => aggregateEstimates(items), [items]);

  const byPath = useMemo(() => {
    const map = new Map<string, EstimateItem>();
    for (const item of items) map.set(item.path, item);
    return map;
  }, [items]);

  const clearEstimates = useCallback(() => {
    setItems([]);
    setError(null);
  }, []);

  const previewStaged = useCallback(async (files: StagedFile[]) => {
    const ready = files.filter((f) => f.presetId);
    if (ready.length === 0) {
      setError("NO PRESET — select an alternative");
      setItems([]);
      return;
    }
    setEstimating(true);
    setError(null);
    const next: EstimateItem[] = [];
    try {
      for (const file of ready) {
        const result = await compressEstimate({
          sourcePath: file.path,
          mediaKind: file.kind,
          presetId: file.presetId,
        });
        next.push({
          path: result.path,
          presetId: result.presetId,
          estimatedBytes: result.estimatedBytes,
          confidence: result.confidence,
          originalBytes: result.originalBytes,
        });
      }
      setItems(next);
    } catch (err: unknown) {
      setItems(next);
      setError(errorMessage(err));
    } finally {
      setEstimating(false);
    }
  }, []);

  return {
    items,
    byPath,
    summary,
    estimating,
    error,
    previewStaged,
    clearEstimates,
  };
}

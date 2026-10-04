import { useCallback, useMemo, useRef, useState } from "react";
import { createBatchAdmissionController } from "../compress/batchAdmission";
import {
  aggregateEstimates,
  type EstimateItem,
} from "../compress/estimateAggregate";
import { runEstimatePreview } from "../compress/estimatePreview";
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
  const gateRef = useRef(createBatchAdmissionController());

  const summary = useMemo(() => aggregateEstimates(items), [items]);

  const byPath = useMemo(() => {
    const map = new Map<string, EstimateItem>();
    for (const item of items) map.set(item.path, item);
    return map;
  }, [items]);

  const clearEstimates = useCallback(() => {
    // Invalidate any in-flight previewStaged so a late setItems cannot land.
    gateRef.current.abort();
    setItems([]);
    setError(null);
    setEstimating(false);
  }, []);

  const previewStaged = useCallback(async (files: StagedFile[]) => {
    const ready = files.filter((f) => f.presetId);
    if (ready.length === 0) {
      gateRef.current.abort();
      setError("NO PRESET — select an alternative");
      setItems([]);
      setEstimating(false);
      return;
    }

    // New PREVIEW supersedes any prior in-flight call.
    gateRef.current.abort();
    const token = gateRef.current.begin();
    const isCurrent = () => gateRef.current.isCurrent(token);

    setEstimating(true);
    setError(null);
    // Drop any prior PREVIEW so a mid-batch failure cannot leave a partial
    // selection that misrepresents aggregate staged → estimated totals.
    setItems([]);
    try {
      const next = await runEstimatePreview(
        ready.map((f) => ({
          path: f.path,
          mediaKind: f.kind,
          presetId: f.presetId,
        })),
        async (file) => {
          const result = await compressEstimate({
            sourcePath: file.path,
            mediaKind: file.mediaKind,
            presetId: file.presetId,
          });
          return {
            path: result.path,
            presetId: result.presetId,
            estimatedBytes: result.estimatedBytes,
            confidence: result.confidence,
            originalBytes: result.originalBytes,
          };
        },
        isCurrent,
      );
      if (next === null || !isCurrent()) return;
      setItems(next);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      setItems([]);
      setError(errorMessage(err));
    } finally {
      if (isCurrent()) setEstimating(false);
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

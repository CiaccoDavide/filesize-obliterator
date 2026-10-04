import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compressListPresets,
  type MediaKind,
  type PresetInfo,
} from "../ipc/compress";
import { pickDefaultPresetId } from "../presets/defaults";
import type { PresetByKind } from "../presets/selection";

const KINDS: MediaKind[] = ["image", "audio", "video", "pdf"];

function groupByKind(all: PresetInfo[]): Record<MediaKind, PresetInfo[]> {
  const out: Record<MediaKind, PresetInfo[]> = {
    image: [],
    audio: [],
    video: [],
    pdf: [],
  };
  for (const p of all) {
    out[p.kind].push(p);
  }
  return out;
}

function defaultsFromCatalog(
  byKind: Record<MediaKind, PresetInfo[]>,
): PresetByKind {
  const next: PresetByKind = {};
  for (const kind of KINDS) {
    const id = pickDefaultPresetId(byKind[kind]);
    if (id) next[kind] = id;
  }
  return next;
}

/**
 * Loads the backend preset registry once and tracks global-per-kind selection.
 * Defaults to balanced (ebook for PDF) from the returned list — never hard-coded duplicates.
 */
export function usePresets() {
  const [catalog, setCatalog] = useState<PresetInfo[]>([]);
  const [presetByKind, setPresetByKind] = useState<PresetByKind>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const all = await compressListPresets();
        if (cancelled) return;
        setCatalog(all);
        setPresetByKind(defaultsFromCatalog(groupByKind(all)));
        setLoaded(true);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoaded(true);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const byKind = useMemo(() => groupByKind(catalog), [catalog]);

  const setKindPreset = useCallback((kind: MediaKind, presetId: string) => {
    const allowed = byKind[kind]?.some((p) => p.id === presetId);
    if (!allowed) return;
    setPresetByKind((prev) => ({ ...prev, [kind]: presetId }));
  }, [byKind]);

  return {
    catalog,
    byKind,
    presetByKind,
    setKindPreset,
    loaded,
    error,
  };
}

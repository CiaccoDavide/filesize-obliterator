import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  preferred: PresetByKind = {},
): PresetByKind {
  const next: PresetByKind = {};
  for (const kind of KINDS) {
    const preferredId = preferred[kind];
    if (preferredId && byKind[kind]?.some((p) => p.id === preferredId)) {
      next[kind] = preferredId;
      continue;
    }
    const id = pickDefaultPresetId(byKind[kind]);
    if (id) next[kind] = id;
  }
  return next;
}

type Options = {
  /** Persisted per-kind defaults; applied once the catalog loads. */
  preferredDefaults?: PresetByKind;
  /** True once local settings have been read (so we do not overwrite with catalog defaults). */
  settingsReady?: boolean;
};

/**
 * Loads the backend preset registry once and tracks global-per-kind selection.
 * Prefers persisted defaults when valid; else balanced (ebook for PDF).
 */
export function usePresets(options: Options = {}) {
  const { preferredDefaults = {}, settingsReady = true } = options;
  const preferredRef = useRef(preferredDefaults);
  preferredRef.current = preferredDefaults;
  const [catalog, setCatalog] = useState<PresetInfo[]>([]);
  const [presetByKind, setPresetByKind] = useState<PresetByKind>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load catalog once settings are ready so persisted defaults win over catalog picks.
  // Do not re-fetch when the user later changes a preset (that only updates local settings).
  useEffect(() => {
    if (!settingsReady) return;
    let cancelled = false;

    async function load() {
      try {
        const all = await compressListPresets();
        if (cancelled) return;
        const grouped = groupByKind(all);
        setCatalog(all);
        setPresetByKind(defaultsFromCatalog(grouped, preferredRef.current));
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
  }, [settingsReady]);

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

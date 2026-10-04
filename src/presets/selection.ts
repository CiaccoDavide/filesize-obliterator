import type { MediaKind } from "../ipc/compress";
import type { StagedFile } from "../intake/types";

const KIND_ORDER: MediaKind[] = ["image", "audio", "video", "pdf"];

export type PresetByKind = Partial<Record<MediaKind, string>>;

/** Unique kinds present in staging, ordered image → audio → video → pdf. */
export function kindsPresent(files: StagedFile[]): MediaKind[] {
  const seen = new Set(files.map((f) => f.kind));
  return KIND_ORDER.filter((k) => seen.has(k));
}

/** Apply one preset to every staged file of `kind`. */
export function applyKindPreset(
  files: StagedFile[],
  kind: MediaKind,
  presetId: string,
): StagedFile[] {
  return files.map((f) => (f.kind === kind ? { ...f, presetId } : f));
}

/** Fill missing `presetId` from per-kind defaults (does not overwrite set ids). */
export function withDefaultPresets(
  files: StagedFile[],
  defaults: PresetByKind,
): StagedFile[] {
  return files.map((f) => {
    if (f.presetId) return f;
    const presetId = defaults[f.kind];
    return presetId ? { ...f, presetId } : f;
  });
}

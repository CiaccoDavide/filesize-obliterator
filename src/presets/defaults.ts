import type { PresetInfo } from "../ipc/compress";

/**
 * Sensible default from a backend-provided kind list.
 * Prefer `*-balanced`, then PDF ebook, else the first entry.
 */
export function pickDefaultPresetId(presets: PresetInfo[]): string | null {
  if (presets.length === 0) return null;
  const balanced = presets.find((p) => p.id.endsWith("-balanced"));
  if (balanced) return balanced.id;
  const ebook = presets.find((p) => p.id === "pdf-ebook");
  if (ebook) return ebook.id;
  return presets[0].id;
}

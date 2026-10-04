import type { ProgressRow } from "../compress/progressState";

/** True when a completed image job has both paths for offline compare. */
export function isImagePreviewable(row: ProgressRow): boolean {
  return (
    row.mediaKind === "image" &&
    row.phase === "COMPLETE" &&
    Boolean(row.sourcePath) &&
    Boolean(row.outputPath)
  );
}

/** Stable key for a preview panel instance. */
export function previewKey(sourcePath: string, outputPath: string): string {
  return `${sourcePath}\0${outputPath}`;
}

/**
 * Convert a local filesystem path to a webview-safe asset URL.
 * Inject `convert` (normally Tauri `convertFileSrc`) so unit tests stay offline.
 */
export function localAssetUrl(
  filePath: string,
  convert: (path: string) => string,
): string {
  if (!filePath) {
    throw new Error("local asset path is required");
  }
  return convert(filePath);
}

/** Dimension + byte meter line under each compare pane. */
export function formatImageMeta(
  width: number | null,
  height: number | null,
  bytes: number | undefined,
  formatBytes: (n: number) => string,
): string {
  const size = bytes === undefined ? null : formatBytes(bytes);
  if (width != null && height != null && size) {
    return `${width}×${height} · ${size}`;
  }
  if (width != null && height != null) {
    return `${width}×${height}`;
  }
  return size ?? "—";
}

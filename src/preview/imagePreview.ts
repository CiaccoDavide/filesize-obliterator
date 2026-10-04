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

/** Windows drive / UNC absolute path (not a URI scheme). */
function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/** Reject odd URI schemes while still accepting Windows `C:\...` paths. */
function hasUriScheme(path: string): boolean {
  if (isWindowsAbsolutePath(path)) return false;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path);
}

function isAbsoluteFilesystemPath(path: string): boolean {
  return path.startsWith("/") || isWindowsAbsolutePath(path);
}

function hasParentTraversal(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => segment === "..");
}

/**
 * Convert a local filesystem path to a webview-safe asset URL.
 * Inject `convert` (normally Tauri `convertFileSrc`) so unit tests stay offline.
 */
export function localAssetUrl(
  filePath: string,
  convert: (path: string) => string,
): string {
  const path = filePath.trim();
  if (!path) {
    throw new Error("local asset path is required");
  }
  if (hasUriScheme(path)) {
    throw new Error("local asset path must not use a URI scheme");
  }
  if (!isAbsoluteFilesystemPath(path)) {
    throw new Error("local asset path must be absolute");
  }
  if (hasParentTraversal(path)) {
    throw new Error("local asset path must not contain parent traversal");
  }
  return convert(path);
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

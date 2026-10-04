/** Directory name beside the source file's parent (mirrors Rust `COMPRESSED_DIR_NAME`). */
export const COMPRESSED_DIR_NAME = "_compressed";

/**
 * Resolve `<parent>/_compressed` for a source file path.
 * Returns null when the source path is empty / placeholder / has no parent segment.
 */
export function compressedDirForSource(sourcePath: string): string | null {
  const trimmed = sourcePath.trim();
  if (!trimmed || trimmed === "—") return null;

  const normalized = trimmed.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return null;

  const parent = normalized.slice(0, lastSlash);
  if (!parent) return null;

  // Preserve original separator style when the input used backslashes.
  if (trimmed.includes("\\") && !trimmed.includes("/")) {
    return `${trimmed.slice(0, trimmed.lastIndexOf("\\"))}\\${COMPRESSED_DIR_NAME}`;
  }
  return `${parent}/${COMPRESSED_DIR_NAME}`;
}

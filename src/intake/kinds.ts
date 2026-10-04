import type { IntakeKind } from "./types";

const IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
]);

const AUDIO_EXT = new Set([
  "mp3",
  "aac",
  "m4a",
  "wav",
  "flac",
  "ogg",
  "opus",
  "wma",
  "aiff",
  "aif",
]);

const VIDEO_EXT = new Set([
  "mp4",
  "mov",
  "mkv",
  "webm",
  "avi",
  "m4v",
  "mpeg",
  "mpg",
]);

function extensionOf(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

function kindFromMime(mime: string): IntakeKind | null {
  const normalized = mime.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "application/pdf") return "pdf";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  return "unsupported";
}

function kindFromExtension(path: string): IntakeKind {
  const ext = extensionOf(path);
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (VIDEO_EXT.has(ext)) return "video";
  return "unsupported";
}

/**
 * Detect media kind from filesystem path extension, with optional MIME override.
 * MIME wins when provided; extension fills gaps (empty MIME / unknown).
 */
export function detectKind(path: string, mime?: string | null): IntakeKind {
  if (mime != null && mime.trim() !== "") {
    const fromMime = kindFromMime(mime);
    if (fromMime === "unsupported") return "unsupported";
    if (fromMime) return fromMime;
  }
  return kindFromExtension(path);
}

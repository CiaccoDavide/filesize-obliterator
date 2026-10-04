import type { MediaKind } from "../ipc/compress";

/** Bump when the on-disk shape changes incompatibly. */
export const SETTINGS_VERSION = 1;

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 4;
export const DEFAULT_CONCURRENCY = 2;

export type UiDensity = "compact" | "regular";

export type WindowSize = {
  width: number;
  height: number;
};

export type AppSettings = {
  version: number;
  /** Default preset id per media kind (only kinds the user has chosen). */
  defaultPresets: Partial<Record<MediaKind, string>>;
  /** Queue worker cap applied to JobManager on load / change. */
  concurrency: number;
  stripMetadata: boolean;
  /** Prefer platform HW video encode when available (falls back to software). */
  preferHardware: boolean;
  uiDensity: UiDensity;
  /** Last logical window size; null when never captured. */
  windowSize: WindowSize | null;
  /** True after the operator ACKs the first-run briefing overlay. */
  briefingSeen: boolean;
  /** Show a local OS notification when a batch finishes while unfocused. */
  notifyOnComplete: boolean;
};

const KIND_SET = new Set<MediaKind>(["image", "audio", "video", "pdf"]);

const MIN_WINDOW = 400;

export function defaultSettings(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    defaultPresets: {},
    concurrency: DEFAULT_CONCURRENCY,
    stripMetadata: true,
    preferHardware: true,
    uiDensity: "compact",
    windowSize: null,
    briefingSeen: false,
    notifyOnComplete: true,
  };
}

export function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONCURRENCY;
  const n = Math.round(value);
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, n));
}

function parseDefaultPresets(raw: unknown): Partial<Record<MediaKind, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<MediaKind, string>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KIND_SET.has(key as MediaKind)) continue;
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (!id) continue;
    out[key as MediaKind] = id;
  }
  return out;
}

function parseWindowSize(raw: unknown): WindowSize | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const width = obj.width;
  const height = obj.height;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const w = Math.round(width);
  const h = Math.round(height);
  if (w < MIN_WINDOW || h < MIN_WINDOW) return null;
  return { width: w, height: h };
}

function parseUiDensity(raw: unknown): UiDensity {
  return raw === "regular" ? "regular" : "compact";
}

/**
 * Parse persisted settings from a JSON string or object.
 * Corrupt / invalid input returns defaults — never throws.
 */
export function parseSettings(raw: unknown): AppSettings {
  const defaults = defaultSettings();
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const obj = value as Record<string, unknown>;
  return {
    version:
      typeof obj.version === "number" && Number.isFinite(obj.version)
        ? Math.trunc(obj.version)
        : SETTINGS_VERSION,
    defaultPresets: parseDefaultPresets(obj.defaultPresets),
    concurrency:
      obj.concurrency === undefined
        ? defaults.concurrency
        : clampConcurrency(Number(obj.concurrency)),
    stripMetadata:
      typeof obj.stripMetadata === "boolean"
        ? obj.stripMetadata
        : defaults.stripMetadata,
    preferHardware:
      typeof obj.preferHardware === "boolean"
        ? obj.preferHardware
        : defaults.preferHardware,
    uiDensity: parseUiDensity(obj.uiDensity),
    windowSize:
      obj.windowSize === undefined
        ? defaults.windowSize
        : parseWindowSize(obj.windowSize),
    briefingSeen:
      typeof obj.briefingSeen === "boolean"
        ? obj.briefingSeen
        : defaults.briefingSeen,
    notifyOnComplete:
      typeof obj.notifyOnComplete === "boolean"
        ? obj.notifyOnComplete
        : defaults.notifyOnComplete,
  };
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(settings);
}

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirrored from Rust `compress::types` — keep fields/tags in sync. */
export type MediaKind = "image" | "audio" | "video" | "pdf";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type CompressStartRequest = {
  sourcePath: string;
  mediaKind: MediaKind;
  presetId: string;
  /** Default true when omitted by older callers — strip EXIF/GPS / container tags. */
  stripMetadata?: boolean;
  /** Default false — skip when an output already exists for this source+preset. */
  force?: boolean;
};

/** Mirrored from Rust `compress::estimate::EstimateConfidence`. */
export type EstimateConfidence = "exact" | "approximate";

/** Mirrored from Rust `compress::estimate::CompressEstimateRequest`. */
export type CompressEstimateRequest = {
  sourcePath: string;
  mediaKind: MediaKind;
  presetId: string;
};

/** Mirrored from Rust `compress::estimate::CompressEstimateResult`. */
export type CompressEstimateResult = {
  path: string;
  presetId: string;
  estimatedBytes: number;
  confidence: EstimateConfidence;
  originalBytes: number;
};

/** Mirrored from Rust `compress::presets::PresetInfo`. */
export type PresetInfo = {
  id: string;
  label: string;
  kind: MediaKind;
  description: string;
};

export type JobInfo = {
  id: string;
  sourcePath: string;
  mediaKind: MediaKind;
  presetId: string;
  status: JobStatus;
  percent: number;
  error?: string;
  outputPath?: string;
  originalBytes?: number;
  resultBytes?: number;
  durationMs?: number;
};

export type CompressEvent =
  | {
      type: "progress";
      jobId: string;
      percent: number;
      bytesProcessed?: number;
      bytesTotal?: number;
    }
  | {
      type: "log";
      jobId: string;
      message: string;
    }
  | {
      type: "complete";
      jobId: string;
      outputPath: string;
      originalBytes: number;
      resultBytes: number;
      durationMs: number;
    }
  | {
      type: "failed";
      jobId: string;
      error: string;
    };

export const COMPRESS_EVENT = "compress-event";

export function compressStart(
  request: CompressStartRequest,
): Promise<JobInfo> {
  return invoke<JobInfo>("compress_start", { request });
}

/** List built-in presets from the Rust registry (optional kind filter). */
export function compressListPresets(
  kind?: MediaKind,
): Promise<PresetInfo[]> {
  return invoke<PresetInfo[]>("compress_list_presets", {
    kind: kind ?? null,
  });
}

export function compressCancel(jobId: string): Promise<JobInfo> {
  return invoke<JobInfo>("compress_cancel", { jobId });
}

export function compressList(): Promise<JobInfo[]> {
  return invoke<JobInfo[]>("compress_list");
}

/** Dry-run size estimate — never writes `_compressed` outputs. */
export function compressEstimate(
  request: CompressEstimateRequest,
): Promise<CompressEstimateResult> {
  return invoke<CompressEstimateResult>("compress_estimate", { request });
}

export function listenCompressEvents(
  onEvent: (event: CompressEvent) => void,
): Promise<UnlistenFn> {
  return listen<CompressEvent>(COMPRESS_EVENT, (event) => {
    onEvent(event.payload);
  });
}

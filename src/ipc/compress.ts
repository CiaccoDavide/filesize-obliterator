import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirrored from Rust `compress::types` — keep fields/tags in sync. */
export type MediaKind = "image" | "audio" | "video" | "pdf";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type CompressStartRequest = {
  sourcePath: string;
  mediaKind: MediaKind;
  presetId: string;
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

export function compressCancel(jobId: string): Promise<JobInfo> {
  return invoke<JobInfo>("compress_cancel", { jobId });
}

export function compressList(): Promise<JobInfo[]> {
  return invoke<JobInfo[]>("compress_list");
}

export function listenCompressEvents(
  onEvent: (event: CompressEvent) => void,
): Promise<UnlistenFn> {
  return listen<CompressEvent>(COMPRESS_EVENT, (event) => {
    onEvent(event.payload);
  });
}

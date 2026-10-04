import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirrored from Rust `watch::WatchStartRequest`. */
export type WatchStartRequest = {
  path: string;
  /** Default false — only files that appear after start. */
  includeExisting?: boolean;
};

/** Mirrored from Rust `watch::WatchStatus`. */
export type WatchStatus = {
  watching: boolean;
  path?: string;
};

/** Mirrored from Rust `watch::WatchEvent`. */
export type WatchEvent =
  | { type: "started"; path: string }
  | { type: "ready"; path: string; bytes: number }
  | { type: "stopped" };

export const WATCH_EVENT = "watch-event";

export function watchStart(
  request: WatchStartRequest,
): Promise<WatchStatus> {
  return invoke<WatchStatus>("watch_start", { request });
}

export function watchStop(): Promise<WatchStatus> {
  return invoke<WatchStatus>("watch_stop");
}

export function watchStatus(): Promise<WatchStatus> {
  return invoke<WatchStatus>("watch_status");
}

export function listenWatchEvents(
  onEvent: (event: WatchEvent) => void,
): Promise<UnlistenFn> {
  return listen<WatchEvent>(WATCH_EVENT, (event) => {
    onEvent(event.payload);
  });
}

import { invoke } from "@tauri-apps/api/core";

export type PreviewAssets = {
  sourcePath: string;
  outputPath: string;
};

/**
 * Grant asset-protocol access for a completed image job.
 * Returns webview-decodable temp preview paths (TIFF/HEIC rasterized).
 */
export function previewAllowAssets(jobId: string): Promise<PreviewAssets> {
  return invoke<PreviewAssets>("preview_allow_assets", { jobId });
}

/** Revoke the active preview grants (call when the overlay closes). */
export function previewRevokeAssets(): Promise<void> {
  return invoke<void>("preview_revoke_assets");
}

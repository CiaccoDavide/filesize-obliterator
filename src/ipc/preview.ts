import { invoke } from "@tauri-apps/api/core";

export type PreviewAssets = {
  sourcePath: string;
  outputPath: string;
  /** Token for this grant; only revoke with this generation. */
  grantGeneration: number;
};

/**
 * Grant asset-protocol access for a completed image job.
 * Returns webview-decodable temp preview paths (TIFF/HEIC rasterized).
 */
export function previewAllowAssets(jobId: string): Promise<PreviewAssets> {
  return invoke<PreviewAssets>("preview_allow_assets", { jobId });
}

/**
 * Revoke preview grants for `grantGeneration` only.
 * Stale tokens (cancelled overlay / superseded allow) are ignored by the backend.
 */
export function previewRevokeAssets(grantGeneration: number): Promise<void> {
  return invoke<void>("preview_revoke_assets", { grantGeneration });
}

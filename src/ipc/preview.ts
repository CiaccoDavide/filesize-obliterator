import { invoke } from "@tauri-apps/api/core";

/** Grant asset-protocol access for the exact source/output files used by preview. */
export function previewAllowAssets(
  sourcePath: string,
  outputPath: string,
): Promise<void> {
  return invoke<void>("preview_allow_assets", { sourcePath, outputPath });
}

mod audio_encode;
mod estimate;
mod format_support;
mod image_encode;
mod manager;
mod output;
mod pdf_encode;
mod presets;
mod skip;
mod state;
mod types;
mod video_encode;

pub use estimate::{CompressEstimateRequest, CompressEstimateResult};
pub use format_support::{image_format_capabilities, FormatAvailability, FormatCapability};

pub use image_encode::prepare_preview_raster;
#[cfg(test)]
pub use image_encode::needs_webview_raster;
pub use manager::JobManager;
pub use presets::{all_presets, presets_for_kind, PresetInfo};
pub use types::{CompressStartRequest, JobInfo, MediaKind};
pub use video_encode::hw_encode_status;

use tauri::AppHandle;

#[tauri::command]
pub fn compress_start(
    app: AppHandle,
    manager: tauri::State<'_, JobManager>,
    request: CompressStartRequest,
) -> Result<JobInfo, String> {
    manager.start(app, request)
}

#[tauri::command]
pub fn compress_cancel(
    manager: tauri::State<'_, JobManager>,
    job_id: String,
) -> Result<JobInfo, String> {
    manager.cancel(&job_id)
}

#[tauri::command]
pub fn compress_list(manager: tauri::State<'_, JobManager>) -> Result<Vec<JobInfo>, String> {
    manager.list()
}

#[tauri::command]
pub fn compress_list_presets(kind: Option<MediaKind>) -> Vec<PresetInfo> {
    match kind {
        Some(k) => presets_for_kind(&k),
        None => all_presets(),
    }
}

/// Dry-run size estimate for one source+preset. Offline; never writes `_compressed`.
#[tauri::command]
pub fn compress_estimate(
    request: CompressEstimateRequest,
) -> Result<CompressEstimateResult, String> {
    estimate::estimate_request(request)
}

/// Offline HW encode capability probe for the settings HUD (`HW: READY` / `HW: UNAVAILABLE`).
#[tauri::command]
pub fn compress_hw_encode_status() -> &'static str {
    hw_encode_status()
}

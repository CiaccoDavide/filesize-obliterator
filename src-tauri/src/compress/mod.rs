mod audio_encode;
mod image_encode;
mod manager;
mod output;
mod pdf_encode;
mod presets;
mod state;
mod types;
mod video_encode;

pub use manager::JobManager;
pub use presets::{all_presets, presets_for_kind, PresetInfo};
pub use types::{CompressStartRequest, JobInfo, MediaKind};

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

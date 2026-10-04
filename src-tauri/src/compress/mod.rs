mod manager;
mod state;
mod types;

pub use manager::JobManager;
pub use types::{
    CompressEvent, CompressStartRequest, JobInfo, JobStatus, MediaKind, COMPRESS_EVENT,
};

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

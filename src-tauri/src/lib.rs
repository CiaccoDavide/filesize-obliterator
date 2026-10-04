mod compress;
mod intake;
mod preview;
mod settings;
mod watch;

use compress::{
    compress_cancel, compress_estimate, compress_hw_encode_status, compress_list,
    compress_list_presets, compress_start, JobManager,
};
use intake::intake_resolve;
use preview::{preview_allow_assets, preview_revoke_assets, PreviewGrantState};
use serde::Serialize;
use settings::{settings_load, settings_save, settings_set_concurrency};
use watch::{watch_start, watch_status, watch_stop, WatchState};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
}

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Filesize Obliterator",
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(JobManager::default())
        .manage(PreviewGrantState::default())
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![
            ping,
            app_info,
            compress_start,
            compress_cancel,
            compress_list,
            compress_list_presets,
            compress_estimate,
            compress_hw_encode_status,
            intake_resolve,
            preview_allow_assets,
            preview_revoke_assets,
            settings_load,
            settings_save,
            settings_set_concurrency,
            watch_start,
            watch_stop,
            watch_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_pong() {
        assert_eq!(ping(), "pong");
    }

    #[test]
    fn app_info_returns_product_metadata() {
        let info = app_info();
        assert_eq!(info.name, "Filesize Obliterator");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }
}

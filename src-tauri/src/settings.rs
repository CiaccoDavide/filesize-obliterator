//! Local app settings — JSON in the OS app config dir. Never networked.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::compress::JobManager;

pub const SETTINGS_VERSION: u32 = 1;
pub const SETTINGS_FILE_NAME: &str = "settings.json";
pub const MIN_CONCURRENCY: usize = 1;
pub const MAX_CONCURRENCY: usize = 4;
pub const DEFAULT_CONCURRENCY: usize = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DefaultPresets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf: Option<String>,
}

fn default_strip_metadata() -> bool {
    true
}

fn default_ui_density() -> String {
    "compact".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_settings_version")]
    pub version: u32,
    #[serde(default)]
    pub default_presets: DefaultPresets,
    #[serde(default = "default_concurrency_field")]
    pub concurrency: usize,
    #[serde(default = "default_strip_metadata")]
    pub strip_metadata: bool,
    #[serde(default = "default_ui_density")]
    pub ui_density: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_size: Option<WindowSize>,
}

fn default_settings_version() -> u32 {
    SETTINGS_VERSION
}

fn default_concurrency_field() -> usize {
    DEFAULT_CONCURRENCY
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            default_presets: DefaultPresets::default(),
            concurrency: DEFAULT_CONCURRENCY,
            strip_metadata: true,
            ui_density: "compact".into(),
            window_size: None,
        }
    }
}

pub fn clamp_concurrency(value: usize) -> usize {
    value.clamp(MIN_CONCURRENCY, MAX_CONCURRENCY)
}

/// Parse settings from disk bytes. Corrupt / invalid → defaults (never panics).
pub fn parse_settings_bytes(bytes: &[u8]) -> AppSettings {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return AppSettings::default();
    };
    parse_settings_str(text)
}

pub fn parse_settings_str(text: &str) -> AppSettings {
    let Ok(mut settings) = serde_json::from_str::<AppSettings>(text) else {
        return AppSettings::default();
    };
    settings.concurrency = clamp_concurrency(settings.concurrency);
    if settings.ui_density != "regular" && settings.ui_density != "compact" {
        settings.ui_density = "compact".into();
    }
    if let Some(size) = &settings.window_size {
        if size.width < 400 || size.height < 400 {
            settings.window_size = None;
        }
    }
    sanitize_presets(&mut settings.default_presets);
    settings
}

fn sanitize_presets(presets: &mut DefaultPresets) {
    for slot in [
        &mut presets.image,
        &mut presets.audio,
        &mut presets.video,
        &mut presets.pdf,
    ] {
        if let Some(id) = slot {
            let trimmed = id.trim().to_string();
            if trimmed.is_empty() {
                *slot = None;
            } else {
                *slot = Some(trimmed);
            }
        }
    }
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app config dir: {e}"))?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

fn read_settings_file(path: &PathBuf) -> AppSettings {
    match fs::read(path) {
        Ok(bytes) => parse_settings_bytes(&bytes),
        Err(_) => AppSettings::default(),
    }
}

fn write_settings_file(path: &PathBuf, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create config dir: {e}"))?;
    }
    let json =
        serde_json::to_string_pretty(settings).map_err(|e| format!("serialize settings: {e}"))?;
    fs::write(path, json).map_err(|e| format!("write settings: {e}"))
}

#[tauri::command]
pub fn settings_load(app: AppHandle, manager: tauri::State<'_, JobManager>) -> AppSettings {
    let path = match settings_path(&app) {
        Ok(p) => p,
        Err(_) => {
            let defaults = AppSettings::default();
            let _ = manager.set_max_concurrent(defaults.concurrency);
            return defaults;
        }
    };
    let settings = read_settings_file(&path);
    let _ = manager.set_max_concurrent(settings.concurrency);
    settings
}

#[tauri::command]
pub fn settings_save(
    app: AppHandle,
    manager: tauri::State<'_, JobManager>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let mut normalized = settings;
    normalized.version = SETTINGS_VERSION;
    normalized.concurrency = clamp_concurrency(normalized.concurrency);
    if normalized.ui_density != "regular" && normalized.ui_density != "compact" {
        normalized.ui_density = "compact".into();
    }
    sanitize_presets(&mut normalized.default_presets);
    if let Some(size) = &normalized.window_size {
        if size.width < 400 || size.height < 400 {
            normalized.window_size = None;
        }
    }

    let path = settings_path(&app)?;
    write_settings_file(&path, &normalized)?;
    manager.set_max_concurrent(normalized.concurrency)?;
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_bytes_recover_to_defaults() {
        assert_eq!(parse_settings_bytes(b"not json {{{"), AppSettings::default());
        assert_eq!(parse_settings_bytes(b"\xff\xfe"), AppSettings::default());
    }

    #[test]
    fn valid_settings_round_trip_fields() {
        let raw = r#"{
            "version": 1,
            "defaultPresets": { "image": "image-small", "pdf": "pdf-screen" },
            "concurrency": 1,
            "stripMetadata": false,
            "uiDensity": "regular",
            "windowSize": { "width": 960, "height": 720 }
        }"#;
        let parsed = parse_settings_str(raw);
        assert_eq!(parsed.concurrency, 1);
        assert!(!parsed.strip_metadata);
        assert_eq!(parsed.ui_density, "regular");
        assert_eq!(parsed.default_presets.image.as_deref(), Some("image-small"));
        assert_eq!(parsed.default_presets.pdf.as_deref(), Some("pdf-screen"));
        assert_eq!(
            parsed.window_size,
            Some(WindowSize {
                width: 960,
                height: 720
            })
        );
    }

    #[test]
    fn concurrency_is_clamped() {
        let high = parse_settings_str(
            r#"{"version":1,"concurrency":99,"stripMetadata":true,"uiDensity":"compact"}"#,
        );
        assert_eq!(high.concurrency, MAX_CONCURRENCY);
        let low = parse_settings_str(
            r#"{"version":1,"concurrency":0,"stripMetadata":true,"uiDensity":"compact"}"#,
        );
        assert_eq!(low.concurrency, MIN_CONCURRENCY);
    }

    #[test]
    fn tiny_window_dropped() {
        let parsed = parse_settings_str(
            r#"{"version":1,"concurrency":2,"stripMetadata":true,"uiDensity":"compact","windowSize":{"width":10,"height":10}}"#,
        );
        assert_eq!(parsed.window_size, None);
    }

    #[test]
    fn defaults_are_local_safe() {
        let d = AppSettings::default();
        assert_eq!(d.version, SETTINGS_VERSION);
        assert_eq!(d.concurrency, DEFAULT_CONCURRENCY);
        assert!(d.strip_metadata);
        assert!(d.window_size.is_none());
    }
}

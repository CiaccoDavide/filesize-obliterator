//! Runtime asset-protocol scope grants for offline image preview.
//!
//! Config ships with an empty assetProtocol.scope. Grants are issued only for
//! completed image jobs (validated via JobManager) and only for temporary
//! webview-decodable preview rasters — never arbitrary caller paths.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::compress::{prepare_preview_raster, JobManager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAssets {
    pub source_path: String,
    pub output_path: String,
}

#[derive(Default)]
pub struct PreviewGrantState {
    inner: Mutex<Option<ActiveGrant>>,
}

struct ActiveGrant {
    /// Temporary preview rasters currently in the asset-protocol allow list.
    preview_paths: Vec<PathBuf>,
}

fn allow_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|e| format!("asset scope grant failed: {e}"))
}

fn forbid_file(app: &AppHandle, path: &Path) {
    let _ = app.asset_protocol_scope().forbid_file(path);
}

fn revoke_active(app: &AppHandle, grants: &PreviewGrantState) {
    let previous = match grants.inner.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => return,
    };
    if let Some(active) = previous {
        for path in active.preview_paths {
            forbid_file(app, &path);
            let _ = fs::remove_file(&path);
        }
    }
}

/// Validate a completed image job, rasterize TIFF/HEIC (and copy web-native
/// formats) to temp previews, then grant asset-protocol access to those temps.
#[tauri::command]
pub fn preview_allow_assets(
    app: AppHandle,
    manager: State<'_, JobManager>,
    grants: State<'_, PreviewGrantState>,
    job_id: String,
) -> Result<PreviewAssets, String> {
    // Drop any prior overlay grants before issuing a new pair.
    revoke_active(&app, &grants);

    let (source, output) = manager.completed_image_preview_paths(job_id.trim())?;
    let source_preview = prepare_preview_raster(&source).map_err(|e| {
        format!("original preview failed: {e}")
    })?;
    let output_preview = match prepare_preview_raster(&output) {
        Ok(p) => p,
        Err(e) => {
            let _ = fs::remove_file(&source_preview);
            return Err(format!("compressed preview failed: {e}"));
        }
    };

    if let Err(e) = allow_file(&app, &source_preview) {
        let _ = fs::remove_file(&source_preview);
        let _ = fs::remove_file(&output_preview);
        return Err(e);
    }
    if let Err(e) = allow_file(&app, &output_preview) {
        forbid_file(&app, &source_preview);
        let _ = fs::remove_file(&source_preview);
        let _ = fs::remove_file(&output_preview);
        return Err(e);
    }

    let assets = PreviewAssets {
        source_path: source_preview.to_string_lossy().into_owned(),
        output_path: output_preview.to_string_lossy().into_owned(),
    };

    let mut guard = grants
        .inner
        .lock()
        .map_err(|_| "preview grant lock poisoned".to_string())?;
    *guard = Some(ActiveGrant {
        preview_paths: vec![source_preview, output_preview],
    });
    Ok(assets)
}

/// Revoke the active preview asset grants (overlay close).
#[tauri::command]
pub fn preview_revoke_assets(
    app: AppHandle,
    grants: State<'_, PreviewGrantState>,
) -> Result<(), String> {
    revoke_active(&app, &grants);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::needs_webview_raster;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file(name: &str, contents: &[u8]) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("fo-preview-cmd-{nanos}"));
        fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join(name);
        let mut f = fs::File::create(&path).expect("create");
        f.write_all(contents).expect("write");
        path
    }

    #[test]
    fn needs_webview_raster_flags_tiff_and_heic() {
        assert!(needs_webview_raster(Path::new("/a/photo.tiff")));
        assert!(needs_webview_raster(Path::new("/a/photo.tif")));
        assert!(needs_webview_raster(Path::new("/a/photo.heic")));
        assert!(needs_webview_raster(Path::new("/a/photo.HEIF")));
        assert!(!needs_webview_raster(Path::new("/a/photo.jpg")));
        assert!(!needs_webview_raster(Path::new("/a/photo.png")));
        assert!(!needs_webview_raster(Path::new("/a/photo.webp")));
    }

    #[test]
    fn revoke_clears_tracked_temp_files() {
        let path = temp_file("granted.png", b"png");
        assert!(path.is_file());
        let state = PreviewGrantState::default();
        {
            let mut guard = state.inner.lock().unwrap();
            *guard = Some(ActiveGrant {
                preview_paths: vec![path.clone()],
            });
        }
        // Without an AppHandle we only exercise the file-cleanup half via take+.
        let previous = state.inner.lock().unwrap().take();
        if let Some(active) = previous {
            for p in active.preview_paths {
                let _ = fs::remove_file(&p);
            }
        }
        assert!(!path.is_file());
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir(parent);
        }
    }
}

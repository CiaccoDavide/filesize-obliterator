//! Runtime asset-protocol scope grants for offline image preview.
//!
//! Config ships with an empty assetProtocol.scope. Grants are issued only for
//! completed image jobs (validated via JobManager) and only for temporary
//! webview-decodable preview rasters — never arbitrary caller paths.
//!
//! Active grants carry a generation token so stale allow/revoke calls (from a
//! cancelled overlay effect) cannot wipe the currently open overlay's temps.

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
    /// Token for this grant; pass to `preview_revoke_assets` so stale revokes no-op.
    pub grant_generation: u64,
}

struct ActiveGrant {
    generation: u64,
    /// Temporary preview rasters currently in the asset-protocol allow list.
    preview_paths: Vec<PathBuf>,
}

struct GrantInner {
    next_generation: u64,
    active: Option<ActiveGrant>,
}

impl Default for GrantInner {
    fn default() -> Self {
        Self {
            next_generation: 1,
            active: None,
        }
    }
}

#[derive(Default)]
pub struct PreviewGrantState {
    /// Serializes allow end-to-end (including raster prepare) and revoke.
    inner: Mutex<GrantInner>,
}

fn allow_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|e| format!("asset scope grant failed: {e}"))
}

fn forbid_file(app: &AppHandle, path: &Path) {
    let _ = app.asset_protocol_scope().forbid_file(path);
}

fn cleanup_paths(app: Option<&AppHandle>, paths: &[PathBuf]) {
    for path in paths {
        if let Some(app) = app {
            forbid_file(app, path);
        }
        let _ = fs::remove_file(path);
    }
}

/// Take the active grant only when its generation matches `generation`.
fn take_active_if_generation(inner: &mut GrantInner, generation: u64) -> Option<ActiveGrant> {
    match &inner.active {
        Some(active) if active.generation == generation => inner.active.take(),
        _ => None,
    }
}

/// Replace any active grant with a new generation + paths. Returns the previous
/// grant (if any) so the caller can forbid/delete its temps.
fn install_grant(inner: &mut GrantInner, preview_paths: Vec<PathBuf>) -> (u64, Option<ActiveGrant>) {
    let previous = inner.active.take();
    let generation = inner.next_generation;
    inner.next_generation = inner.next_generation.wrapping_add(1);
    inner.active = Some(ActiveGrant {
        generation,
        preview_paths,
    });
    (generation, previous)
}

/// Validate a completed image job, rasterize TIFF/HEIC (and copy web-native
/// formats) to temp previews, then grant asset-protocol access to those temps.
///
/// Holds the grant lock across prepare + scope updates so overlapping allows
/// cannot race tracked temps.
#[tauri::command]
pub fn preview_allow_assets(
    app: AppHandle,
    manager: State<'_, JobManager>,
    grants: State<'_, PreviewGrantState>,
    job_id: String,
) -> Result<PreviewAssets, String> {
    let mut guard = grants
        .inner
        .lock()
        .map_err(|_| "preview grant lock poisoned".to_string())?;

    // Drop any prior overlay grants before issuing a new pair (still locked).
    if let Some(previous) = guard.active.take() {
        cleanup_paths(Some(&app), &previous.preview_paths);
    }

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

    let (generation, _) = install_grant(
        &mut guard,
        vec![source_preview.clone(), output_preview.clone()],
    );

    Ok(PreviewAssets {
        source_path: source_preview.to_string_lossy().into_owned(),
        output_path: output_preview.to_string_lossy().into_owned(),
        grant_generation: generation,
    })
}

/// Revoke the active preview asset grants when `grant_generation` still matches.
/// Stale tokens (cancelled overlay / superseded allow) are ignored.
#[tauri::command]
pub fn preview_revoke_assets(
    app: AppHandle,
    grants: State<'_, PreviewGrantState>,
    grant_generation: u64,
) -> Result<(), String> {
    let mut guard = grants
        .inner
        .lock()
        .map_err(|_| "preview grant lock poisoned".to_string())?;
    if let Some(previous) = take_active_if_generation(&mut guard, grant_generation) {
        cleanup_paths(Some(&app), &previous.preview_paths);
    }
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
    fn matching_generation_revoke_clears_tracked_temp_files() {
        let path = temp_file("granted.png", b"png");
        assert!(path.is_file());
        let mut inner = GrantInner::default();
        let (generation, previous) = install_grant(&mut inner, vec![path.clone()]);
        assert!(previous.is_none());
        assert_eq!(generation, 1);

        let taken = take_active_if_generation(&mut inner, generation).expect("active");
        cleanup_paths(None, &taken.preview_paths);
        assert!(inner.active.is_none());
        assert!(!path.is_file());
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir(parent);
        }
    }

    #[test]
    fn stale_generation_revoke_leaves_active_grant() {
        let path = temp_file("still-granted.png", b"png");
        let mut inner = GrantInner::default();
        let (generation, _) = install_grant(&mut inner, vec![path.clone()]);

        assert!(take_active_if_generation(&mut inner, generation.wrapping_sub(1)).is_none());
        assert!(take_active_if_generation(&mut inner, generation + 99).is_none());
        assert!(inner.active.is_some());
        assert!(path.is_file());

        let taken = take_active_if_generation(&mut inner, generation).expect("active");
        cleanup_paths(None, &taken.preview_paths);
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir(parent);
        }
    }

    #[test]
    fn install_grant_replaces_previous_and_bumps_generation() {
        let first = temp_file("first.png", b"a");
        let second = temp_file("second.png", b"b");
        let mut inner = GrantInner::default();

        let (gen1, prev1) = install_grant(&mut inner, vec![first.clone()]);
        assert!(prev1.is_none());
        assert_eq!(gen1, 1);

        let (gen2, prev2) = install_grant(&mut inner, vec![second.clone()]);
        assert_eq!(gen2, 2);
        let prev2 = prev2.expect("replaced");
        assert_eq!(prev2.generation, gen1);
        assert_eq!(prev2.preview_paths, vec![first.clone()]);
        assert_eq!(
            inner.active.as_ref().map(|a| a.generation),
            Some(gen2)
        );

        // Stale revoke for gen1 must not clear gen2.
        assert!(take_active_if_generation(&mut inner, gen1).is_none());
        assert!(inner.active.is_some());

        cleanup_paths(None, &prev2.preview_paths);
        let taken = take_active_if_generation(&mut inner, gen2).expect("gen2");
        cleanup_paths(None, &taken.preview_paths);
        for p in [first, second] {
            if let Some(parent) = p.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
    }
}

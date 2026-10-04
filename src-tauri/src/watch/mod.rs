//! Session-local offline folder watch — non-recursive, ignores `_compressed`.
//!
//! Polls the watched directory, size-stable-debounces new files, and emits
//! `watch-event` ready notifications for the UI to enqueue with default presets.

mod debounce;
mod kinds;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use debounce::{
    is_watchable_file, list_immediate_files, SizeStableTracker, DEFAULT_STABLE_MS,
};
use kinds::detect_media_kind;

pub const WATCH_EVENT: &str = "watch-event";
const POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchStartRequest {
    pub path: String,
    /// When true, files already in the folder on enable are enqueued after debounce.
    /// Default false — only files that appear after start.
    #[serde(default)]
    pub include_existing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    pub watching: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WatchEvent {
    #[serde(rename_all = "camelCase")]
    Started { path: String },
    #[serde(rename_all = "camelCase")]
    Ready { path: String, bytes: u64 },
    Stopped,
}

struct ActiveWatch {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct WatchState {
    inner: Mutex<Option<ActiveWatch>>,
}

impl Drop for WatchState {
    fn drop(&mut self) {
        let _ = self.stop_internal();
    }
}

impl WatchState {
    fn status(&self) -> WatchStatus {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(w) => WatchStatus {
                watching: true,
                path: Some(w.path.to_string_lossy().into_owned()),
            },
            None => WatchStatus {
                watching: false,
                path: None,
            },
        }
    }

    fn stop_internal(&self) -> Result<WatchStatus, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "watch lock poisoned".to_string())?;
        if let Some(mut active) = guard.take() {
            active.stop.store(true, Ordering::SeqCst);
            if let Some(join) = active.join.take() {
                let _ = join.join();
            }
        }
        Ok(WatchStatus {
            watching: false,
            path: None,
        })
    }

    fn start(
        &self,
        app: AppHandle,
        request: WatchStartRequest,
    ) -> Result<WatchStatus, String> {
        let root = PathBuf::from(&request.path);
        let meta = std::fs::metadata(&root).map_err(|e| format!("{}: {e}", root.display()))?;
        if !meta.is_dir() {
            return Err(format!("{}: not a directory", root.display()));
        }
        let root_str = root
            .to_str()
            .ok_or_else(|| format!("{}: non-utf8 path", root.display()))?
            .to_string();

        // Replace any prior watch.
        let _ = self.stop_internal();

        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = Arc::clone(&stop);
        let root_thread = root.clone();
        let include_existing = request.include_existing;

        let join = thread::spawn(move || {
            run_watch_loop(app, root_thread, include_existing, stop_thread);
        });

        {
            let mut guard = self
                .inner
                .lock()
                .map_err(|_| "watch lock poisoned".to_string())?;
            *guard = Some(ActiveWatch {
                path: root,
                stop,
                join: Some(join),
            });
        }

        Ok(WatchStatus {
            watching: true,
            path: Some(root_str),
        })
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn emit(app: &AppHandle, event: WatchEvent) {
    let _ = app.emit(WATCH_EVENT, event);
}

fn run_watch_loop(
    app: AppHandle,
    root: PathBuf,
    include_existing: bool,
    stop: Arc<AtomicBool>,
) {
    let root_display = root.to_string_lossy().into_owned();
    emit(
        &app,
        WatchEvent::Started {
            path: root_display.clone(),
        },
    );

    let mut tracker = SizeStableTracker::new(Duration::from_millis(DEFAULT_STABLE_MS));
    if !include_existing {
        if let Ok(files) = list_immediate_files(&root) {
            let existing: Vec<String> = files
                .into_iter()
                .filter_map(|p| p.to_str().map(|s| s.to_string()))
                .collect();
            tracker.ignore_existing(existing);
        }
    }

    while !stop.load(Ordering::SeqCst) {
        poll_once(&app, &root, &mut tracker);
        // Short sleeps so stop is responsive.
        let deadline = Instant::now() + POLL_INTERVAL;
        while Instant::now() < deadline {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    emit(&app, WatchEvent::Stopped);
}

fn poll_once(app: &AppHandle, root: &Path, tracker: &mut SizeStableTracker) {
    // Listing errors must not look like an empty directory — retain_only([])
    // would clear include-existing ignores and pending debounce state.
    let Ok(files) = list_immediate_files(root) else {
        return;
    };
    let mut seen = std::collections::HashSet::new();
    let t = now_ms();
    for path in files {
        if detect_media_kind(&path).is_none() {
            continue;
        }
        if !is_watchable_file(root, &path) {
            continue;
        }
        let Some(path_str) = path.to_str().map(|s| s.to_string()) else {
            continue;
        };
        seen.insert(path_str.clone());
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let bytes = meta.len();
        if let Some(ready) = tracker.observe(path_str, bytes, t) {
            emit(
                app,
                WatchEvent::Ready {
                    path: ready,
                    bytes,
                },
            );
        }
    }
    // Forget removed paths so a re-drop of the same name can enqueue again.
    tracker.retain_only(&seen);
}

#[tauri::command]
pub fn watch_start(
    app: AppHandle,
    state: State<'_, WatchState>,
    request: WatchStartRequest,
) -> Result<WatchStatus, String> {
    state.start(app, request)
}

#[tauri::command]
pub fn watch_stop(state: State<'_, WatchState>) -> Result<WatchStatus, String> {
    let status = state.stop_internal()?;
    Ok(status)
}

#[tauri::command]
pub fn watch_status(state: State<'_, WatchState>) -> WatchStatus {
    state.status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fo-watch-mod-{}-{}-{}",
            label,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn watch_start_request_defaults_include_existing_off() {
        let raw = r#"{"path":"/tmp/inbox"}"#;
        let req: WatchStartRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.path, "/tmp/inbox");
        assert!(!req.include_existing);
    }

    #[test]
    fn stop_without_start_is_clean() {
        let state = WatchState::default();
        let status = state.stop_internal().unwrap();
        assert!(!status.watching);
        assert!(status.path.is_none());
    }

    #[test]
    fn list_skips_unsupported_extensions_in_kinds() {
        let dir = temp_dir("kinds");
        fs::File::create(dir.join("a.png"))
            .unwrap()
            .write_all(b"x")
            .unwrap();
        fs::File::create(dir.join("readme.txt"))
            .unwrap()
            .write_all(b"x")
            .unwrap();
        let files = list_immediate_files(&dir).expect("list ok");
        assert_eq!(files.len(), 2);
        assert!(detect_media_kind(&dir.join("a.png")).is_some());
        assert!(detect_media_kind(&dir.join("readme.txt")).is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}

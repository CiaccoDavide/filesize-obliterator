//! Size-stable debounce for watch-folder intake.
//!
//! Incomplete copies change size while writing; only emit a path after its size
//! has been unchanged for `stable_ms`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Default window: size must hold this long before enqueue.
pub const DEFAULT_STABLE_MS: u64 = 750;

#[derive(Debug, Clone)]
struct Pending {
    size: u64,
    last_change_ms: u64,
    emitted: bool,
}

/// Tracks file sizes and yields paths once they are size-stable.
#[derive(Debug, Default)]
pub struct SizeStableTracker {
    stable_ms: u64,
    pending: HashMap<String, Pending>,
    /// Paths present at watch start when `include_existing` is false.
    ignored: HashSet<String>,
}

impl SizeStableTracker {
    pub fn new(stable: Duration) -> Self {
        Self {
            stable_ms: stable.as_millis() as u64,
            pending: HashMap::new(),
            ignored: HashSet::new(),
        }
    }

    pub fn ignore_existing(&mut self, paths: impl IntoIterator<Item = String>) {
        self.ignored.extend(paths);
    }

    /// Observe a file at `now_ms`. Returns the path when it first becomes stable.
    pub fn observe(&mut self, path: String, size: u64, now_ms: u64) -> Option<String> {
        if self.ignored.contains(&path) {
            return None;
        }
        match self.pending.get_mut(&path) {
            None => {
                self.pending.insert(
                    path,
                    Pending {
                        size,
                        last_change_ms: now_ms,
                        emitted: false,
                    },
                );
                None
            }
            Some(p) => {
                if p.size != size {
                    p.size = size;
                    p.last_change_ms = now_ms;
                    p.emitted = false;
                    return None;
                }
                if p.emitted {
                    return None;
                }
                if now_ms.saturating_sub(p.last_change_ms) >= self.stable_ms {
                    p.emitted = true;
                    return Some(path);
                }
                None
            }
        }
    }

    pub fn forget(&mut self, path: &str) {
        self.pending.remove(path);
        self.ignored.remove(path);
    }

    /// Drop pending/ignored entries whose paths are no longer present on disk
    /// so a same-name re-drop after delete can enqueue again.
    pub fn retain_only(&mut self, alive: &HashSet<String>) {
        self.pending.retain(|k, _| alive.contains(k));
        self.ignored.retain(|k| alive.contains(k));
    }
}

/// True when `path` is the watched folder's `_compressed` dir or a child of it.
pub fn is_compressed_sidecar(watch_root: &Path, path: &Path) -> bool {
    let compressed = watch_root.join("_compressed");
    if path == compressed {
        return true;
    }
    path.starts_with(&compressed)
}

/// True when the path is an immediate child file of `watch_root` (non-recursive).
pub fn is_watchable_file(watch_root: &Path, path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if is_compressed_sidecar(watch_root, path) {
        return false;
    }
    match path.parent() {
        Some(parent) => parent == watch_root,
        None => false,
    }
}

/// List immediate supported files under `watch_root` (skips `_compressed`).
pub fn list_immediate_files(watch_root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(watch_root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if is_watchable_file(watch_root, &path) {
            out.push(path);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fo-watch-{}-{}-{}",
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
    fn does_not_emit_until_size_stable_window_elapsed() {
        let mut t = SizeStableTracker::new(Duration::from_millis(500));
        assert_eq!(t.observe("/a.png".into(), 10, 0), None);
        assert_eq!(t.observe("/a.png".into(), 10, 400), None);
        assert_eq!(t.observe("/a.png".into(), 10, 500), Some("/a.png".into()));
        // Once emitted, stay quiet unless size changes again.
        assert_eq!(t.observe("/a.png".into(), 10, 900), None);
    }

    #[test]
    fn growing_file_resets_stable_window() {
        let mut t = SizeStableTracker::new(Duration::from_millis(300));
        assert_eq!(t.observe("/a.bin".into(), 1, 0), None);
        assert_eq!(t.observe("/a.bin".into(), 2, 200), None);
        assert_eq!(t.observe("/a.bin".into(), 2, 400), None);
        assert_eq!(t.observe("/a.bin".into(), 2, 500), Some("/a.bin".into()));
    }

    #[test]
    fn ignored_existing_paths_never_emit() {
        let mut t = SizeStableTracker::new(Duration::from_millis(100));
        t.ignore_existing(vec!["/old.jpg".into()]);
        assert_eq!(t.observe("/old.jpg".into(), 9, 0), None);
        assert_eq!(t.observe("/old.jpg".into(), 9, 500), None);
        assert_eq!(t.observe("/new.jpg".into(), 9, 0), None);
        assert_eq!(t.observe("/new.jpg".into(), 9, 100), Some("/new.jpg".into()));
    }

    #[test]
    fn retain_only_allows_same_name_redrop_after_delete() {
        let mut t = SizeStableTracker::new(Duration::from_millis(100));
        t.ignore_existing(vec!["/old.jpg".into()]);
        let mut alive = HashSet::new();
        t.retain_only(&alive); // deleted from disk
        alive.insert("/old.jpg".into());
        assert_eq!(t.observe("/old.jpg".into(), 4, 0), None);
        assert_eq!(t.observe("/old.jpg".into(), 4, 100), Some("/old.jpg".into()));
    }

    #[test]
    fn compressed_sidecar_paths_are_ignored() {
        let root = PathBuf::from("/photos");
        assert!(is_compressed_sidecar(
            &root,
            &PathBuf::from("/photos/_compressed")
        ));
        assert!(is_compressed_sidecar(
            &root,
            &PathBuf::from("/photos/_compressed/a.webp")
        ));
        assert!(!is_compressed_sidecar(
            &root,
            &PathBuf::from("/photos/a.jpg")
        ));
        assert!(!is_compressed_sidecar(
            &root,
            &PathBuf::from("/photos/_compressed_backup")
        ));
    }

    #[test]
    fn list_immediate_files_skips_compressed_and_nested() {
        let dir = temp_dir("list");
        let nested = dir.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let compressed = dir.join("_compressed");
        fs::create_dir_all(&compressed).unwrap();

        let keep = dir.join("keep.png");
        fs::File::create(&keep).unwrap().write_all(b"x").unwrap();
        fs::File::create(nested.join("deep.jpg")).unwrap();
        fs::File::create(compressed.join("out.webp")).unwrap();

        let listed = list_immediate_files(&dir);
        let names: Vec<_> = listed
            .iter()
            .filter_map(|p| p.file_name().and_then(|s| s.to_str()))
            .collect();
        assert_eq!(names, vec!["keep.png"]);
        let _ = fs::remove_dir_all(&dir);
    }
}

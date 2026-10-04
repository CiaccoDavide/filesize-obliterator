//! Disk space preflight before admitting a compress batch.
//!
//! Offline syscalls only (`statvfs` / `GetDiskFreeSpaceExW`). Never writes.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Warn when free < needed × this ratio (override allowed).
pub const DISK_WARN_RATIO: f64 = 1.25;
/// Modest per-volume headroom for temp files / filesystem slack.
pub const DISK_HEADROOM_BYTES: u64 = 64 * 1024 * 1024;
/// When dry-run estimate is missing, assume write ≈ 110% of source.
pub const DISK_MISSING_ESTIMATE_MULTIPLIER: f64 = 1.1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiskPreflightMode {
    Block,
    Warn,
    Ok,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiskPreflightItem {
    pub source_path: String,
    pub original_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiskPreflightRequest {
    pub items: Vec<DiskPreflightItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiskPreflightResult {
    /// False only in block mode (start must not proceed).
    pub ok: bool,
    pub free_bytes: u64,
    pub needed_bytes: u64,
    pub mode: DiskPreflightMode,
}

/// Bytes one item is expected to write (estimate or conservative source multiple).
pub fn item_write_bytes(original_bytes: u64, estimated_bytes: Option<u64>) -> u64 {
    match estimated_bytes {
        Some(est) => est,
        None => ((original_bytes as f64) * DISK_MISSING_ESTIMATE_MULTIPLIER).ceil() as u64,
    }
}

/// Classify free vs needed using project defaults.
pub fn classify_disk_preflight(free_bytes: u64, needed_bytes: u64) -> DiskPreflightResult {
    if free_bytes < needed_bytes {
        return DiskPreflightResult {
            ok: false,
            free_bytes,
            needed_bytes,
            mode: DiskPreflightMode::Block,
        };
    }
    let warn_ceiling = ((needed_bytes as f64) * DISK_WARN_RATIO).ceil() as u64;
    if free_bytes < warn_ceiling {
        return DiskPreflightResult {
            ok: true,
            free_bytes,
            needed_bytes,
            mode: DiskPreflightMode::Warn,
        };
    }
    DiskPreflightResult {
        ok: true,
        free_bytes,
        needed_bytes,
        mode: DiskPreflightMode::Ok,
    }
}

fn mode_rank(mode: DiskPreflightMode) -> u8 {
    match mode {
        DiskPreflightMode::Ok => 0,
        DiskPreflightMode::Warn => 1,
        DiskPreflightMode::Block => 2,
    }
}

/// Destination volume probe path: source parent (where `_compressed/` will be created).
pub fn destination_probe_path(source_path: &Path) -> PathBuf {
    source_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Free bytes on the volume that contains `path` (offline OS query).
pub fn free_bytes_for_path(path: &Path) -> Result<u64, String> {
    let probe = if path.exists() {
        path.to_path_buf()
    } else if let Some(parent) = path.parent().filter(|p| p.exists()) {
        parent.to_path_buf()
    } else {
        PathBuf::from(".")
    };

    #[cfg(unix)]
    {
        free_bytes_unix(&probe)
    }
    #[cfg(windows)]
    {
        free_bytes_windows(&probe)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = probe;
        Err("disk free-space query unsupported on this platform".into())
    }
}

#[cfg(unix)]
fn free_bytes_unix(path: &Path) -> Result<u64, String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| "path contains interior NUL".to_string())?;
    // SAFETY: path is a valid C string; statvfs writes into a stack struct we own.
    unsafe {
        let mut stat: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(c_path.as_ptr(), &mut stat) != 0 {
            return Err(format!(
                "statvfs failed for {}: {}",
                path.display(),
                std::io::Error::last_os_error()
            ));
        }
        let bsize = stat.f_frsize as u64;
        Ok(bsize.saturating_mul(stat.f_bavail as u64))
    }
}

/// FNV-1a 64-bit hash for stable volume identity strings (no extra crate).
#[cfg(windows)]
fn fnv1a64_lower(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in s.to_ascii_lowercase().bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(windows)]
fn free_bytes_windows(path: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free_bytes_available: u64 = 0;
    let mut total_number_of_bytes: u64 = 0;
    let mut total_number_of_free_bytes: u64 = 0;
    // SAFETY: wide is NUL-terminated; out-params point at stack locals.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_bytes_available,
            &mut total_number_of_bytes,
            &mut total_number_of_free_bytes,
        )
    };
    if ok == 0 {
        return Err(format!(
            "GetDiskFreeSpaceExW failed for {}: {}",
            path.display(),
            std::io::Error::last_os_error()
        ));
    }
    Ok(free_bytes_available)
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetDiskFreeSpaceExW(
        directory_name: *const u16,
        free_bytes_available: *mut u64,
        total_number_of_bytes: *mut u64,
        total_number_of_free_bytes: *mut u64,
    ) -> i32;
    fn GetVolumePathNameW(
        lpsz_file_name: *const u16,
        lpsz_volume_path_name: *mut u16,
        cch_buffer_length: u32,
    ) -> i32;
}

#[cfg(unix)]
fn volume_key(path: &Path) -> Result<u64, String> {
    use std::os::unix::fs::MetadataExt;
    let meta = fs::metadata(path).map_err(|e| format!("cannot stat {}: {e}", path.display()))?;
    Ok(meta.dev())
}

#[cfg(windows)]
fn volume_root_for_path(path: &Path) -> Result<PathBuf, String> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    let mut probe = path.to_path_buf();
    if !probe.exists() {
        probe = path
            .parent()
            .filter(|p| p.exists())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
    }

    let wide: Vec<u16> = probe
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    let mut capacity = 260usize;
    loop {
        let mut buf = vec![0u16; capacity];
        // SAFETY: `wide` is NUL-terminated; `buf` is writable with given length.
        let ok = unsafe {
            GetVolumePathNameW(wide.as_ptr(), buf.as_mut_ptr(), capacity as u32)
        };
        if ok != 0 {
            let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            let root = PathBuf::from(std::ffi::OsString::from_wide(&buf[..end]));
            return Ok(root);
        }
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(ERROR_INSUFFICIENT_BUFFER as i32) && capacity < 32_768 {
            capacity = capacity.saturating_mul(2);
            continue;
        }
        return Err(format!(
            "GetVolumePathNameW failed for {}: {err}",
            probe.display()
        ));
    }
}

#[cfg(windows)]
fn volume_key(path: &Path) -> Result<u64, String> {
    let root = volume_root_for_path(path)?;
    Ok(fnv1a64_lower(&root.to_string_lossy()))
}

#[cfg(not(any(unix, windows)))]
fn volume_key(_path: &Path) -> Result<u64, String> {
    Ok(0)
}

/// Run preflight for a batch: per-volume needed vs free; return the worst mode.
pub fn preflight_request(request: DiskPreflightRequest) -> Result<DiskPreflightResult, String> {
    if request.items.is_empty() {
        // Nothing to write — still report local free space for HUD consistency.
        let free = free_bytes_for_path(Path::new(".")).unwrap_or(0);
        return Ok(classify_disk_preflight(free, DISK_HEADROOM_BYTES));
    }

    struct VolumeAcc {
        probe: PathBuf,
        needed: u64,
    }

    let mut by_volume: HashMap<u64, VolumeAcc> = HashMap::new();

    for item in &request.items {
        let source = PathBuf::from(&item.source_path);
        let probe = destination_probe_path(&source);
        let key = volume_key(&probe)?;
        let write = item_write_bytes(item.original_bytes, item.estimated_bytes);
        by_volume
            .entry(key)
            .and_modify(|acc| acc.needed = acc.needed.saturating_add(write))
            .or_insert(VolumeAcc {
                probe,
                needed: write,
            });
    }

    let mut worst: Option<DiskPreflightResult> = None;
    for acc in by_volume.values() {
        let needed = acc.needed.saturating_add(DISK_HEADROOM_BYTES);
        let free = free_bytes_for_path(&acc.probe)?;
        let result = classify_disk_preflight(free, needed);
        worst = Some(match worst {
            None => result,
            Some(prev) if mode_rank(result.mode) > mode_rank(prev.mode) => result,
            Some(prev)
                if mode_rank(result.mode) == mode_rank(prev.mode)
                    && result.needed_bytes.saturating_sub(result.free_bytes)
                        > prev.needed_bytes.saturating_sub(prev.free_bytes) =>
            {
                result
            }
            Some(prev) => prev,
        });
    }

    Ok(worst.unwrap_or(DiskPreflightResult {
        ok: true,
        free_bytes: 0,
        needed_bytes: 0,
        mode: DiskPreflightMode::Ok,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn item_write_uses_estimate_when_present() {
        assert_eq!(item_write_bytes(10_000, Some(4_000)), 4_000);
    }

    #[test]
    fn item_write_falls_back_to_source_multiple() {
        assert_eq!(item_write_bytes(1_000, None), 1_100);
    }

    #[test]
    fn classify_block_warn_ok_thresholds() {
        assert_eq!(
            classify_disk_preflight(99, 100).mode,
            DiskPreflightMode::Block
        );
        assert_eq!(
            classify_disk_preflight(100, 100).mode,
            DiskPreflightMode::Warn
        );
        assert_eq!(
            classify_disk_preflight(124, 100).mode,
            DiskPreflightMode::Warn
        );
        assert_eq!(
            classify_disk_preflight(125, 100).mode,
            DiskPreflightMode::Ok
        );
        assert!(!classify_disk_preflight(50, 100).ok);
        assert!(classify_disk_preflight(100, 100).ok);
    }

    #[test]
    fn free_bytes_for_temp_dir_is_positive() {
        let dir = std::env::temp_dir().join(format!(
            "fo-disk-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let free = free_bytes_for_path(&dir).expect("free bytes");
        assert!(free > 0, "expected positive free space, got {free}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn preflight_ok_on_temp_volume_for_tiny_batch() {
        let dir = std::env::temp_dir().join(format!(
            "fo-disk-preflight-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("tiny.bin");
        fs::write(&source, vec![0u8; 64]).unwrap();

        let result = preflight_request(DiskPreflightRequest {
            items: vec![DiskPreflightItem {
                source_path: source.to_string_lossy().into_owned(),
                original_bytes: 64,
                estimated_bytes: Some(32),
            }],
        })
        .expect("preflight");

        assert_eq!(result.mode, DiskPreflightMode::Ok);
        assert!(result.ok);
        assert_eq!(result.needed_bytes, 32 + DISK_HEADROOM_BYTES);
        assert!(result.free_bytes >= result.needed_bytes);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn preflight_aggregates_write_bytes_on_same_volume() {
        let dir = std::env::temp_dir().join(format!(
            "fo-disk-aggregate-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join("trip")).unwrap();
        let source_a = dir.join("a.bin");
        let source_b = dir.join("trip").join("b.bin");
        fs::write(&source_a, vec![0u8; 8]).unwrap();
        fs::write(&source_b, vec![0u8; 8]).unwrap();

        let result = preflight_request(DiskPreflightRequest {
            items: vec![
                DiskPreflightItem {
                    source_path: source_a.to_string_lossy().into_owned(),
                    original_bytes: 1_000,
                    estimated_bytes: Some(500),
                },
                DiskPreflightItem {
                    source_path: source_b.to_string_lossy().into_owned(),
                    original_bytes: 2_000,
                    estimated_bytes: Some(800),
                },
            ],
        })
        .expect("preflight");

        assert_eq!(
            result.needed_bytes,
            500 + 800 + DISK_HEADROOM_BYTES,
            "sibling dirs on one volume must sum write estimates once"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn result_serde_camel_case() {
        let result = DiskPreflightResult {
            ok: false,
            free_bytes: 1,
            needed_bytes: 2,
            mode: DiskPreflightMode::Block,
        };
        let json = serde_json::to_string(&result).expect("ser");
        assert!(json.contains("\"ok\":false"));
        assert!(json.contains("\"freeBytes\":1"));
        assert!(json.contains("\"neededBytes\":2"));
        assert!(json.contains("\"mode\":\"block\""));
    }
}

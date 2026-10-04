//! Detect re-compressions of the same source+preset via an offline sidecar.
//!
//! Lookup: `(source_path, preset_id) -> existing output | none`
//! Sidecar lives under `<parent>/_compressed/.fo-already/<key>.json` and stores
//! the output path plus a content hash of the source at encode time.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::output::COMPRESSED_DIR_NAME;

const SIDECAR_DIR: &str = ".fo-already";
pub const SKIP_REASON_ALREADY: &str = "already compressed for this preset";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AlreadyRecord {
    source_path: String,
    preset_id: String,
    output_path: String,
    content_hash: String,
}

/// FNV-1a 64-bit content hash (hex). Offline local fingerprint — no crypto crate.
pub fn content_hash(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("cannot read source: {e}"))?;
    let mut hasher: u64 = 0xcbf29ce484222325;
    let mut buf = [0u8; 8192];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("cannot read source: {e}"))?;
        if n == 0 {
            break;
        }
        for &b in &buf[..n] {
            hasher ^= u64::from(b);
            hasher = hasher.wrapping_mul(0x100000001b3);
        }
    }
    Ok(format!("{hasher:016x}"))
}

fn sidecar_dir(source_path: &Path) -> PathBuf {
    let parent = source_path.parent().unwrap_or_else(|| Path::new("."));
    parent.join(COMPRESSED_DIR_NAME).join(SIDECAR_DIR)
}

fn sidecar_key(source_path: &Path, preset_id: &str) -> String {
    let canonical = source_path.to_string_lossy();
    let mut hasher: u64 = 0xcbf29ce484222325;
    for b in canonical.as_bytes() {
        hasher ^= u64::from(*b);
        hasher = hasher.wrapping_mul(0x100000001b3);
    }
    hasher ^= 0;
    hasher = hasher.wrapping_mul(0x100000001b3);
    for b in preset_id.as_bytes() {
        hasher ^= u64::from(*b);
        hasher = hasher.wrapping_mul(0x100000001b3);
    }
    format!("{hasher:016x}")
}

fn sidecar_path(source_path: &Path, preset_id: &str) -> PathBuf {
    sidecar_dir(source_path).join(format!("{}.json", sidecar_key(source_path, preset_id)))
}

/// `(source, presetId) -> existingOutput | none` when sidecar + file + content match.
pub fn lookup_existing_output(source_path: &Path, preset_id: &str) -> Option<PathBuf> {
    let path = sidecar_path(source_path, preset_id);
    let raw = fs::read_to_string(&path).ok()?;
    let record: AlreadyRecord = serde_json::from_str(&raw).ok()?;
    if record.preset_id != preset_id {
        return None;
    }
    let output = PathBuf::from(&record.output_path);
    if !output.is_file() {
        return None;
    }
    let hash = content_hash(source_path).ok()?;
    if hash != record.content_hash {
        return None;
    }
    Some(output)
}

/// Persist a successful encode so a later re-drop of the same source+preset can skip.
pub fn record_output(
    source_path: &Path,
    preset_id: &str,
    output_path: &Path,
) -> Result<(), String> {
    let dir = sidecar_dir(source_path);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create skip sidecar dir: {e}"))?;
    let hash = content_hash(source_path)?;
    let record = AlreadyRecord {
        source_path: source_path.to_string_lossy().into_owned(),
        preset_id: preset_id.to_string(),
        output_path: output_path.to_string_lossy().into_owned(),
        content_hash: hash,
    };
    let json = serde_json::to_string_pretty(&record)
        .map_err(|e| format!("cannot serialize skip sidecar: {e}"))?;
    let path = sidecar_path(source_path, preset_id);
    let mut file =
        fs::File::create(&path).map_err(|e| format!("cannot write skip sidecar: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("cannot write skip sidecar: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::output::preferred_output_path;
    use std::io::Write;

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "fo-skip-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("root");
        root
    }

    #[test]
    fn lookup_none_when_no_sidecar() {
        let root = temp_root("none");
        let source = root.join("Photo.JPG");
        fs::write(&source, b"pixels").expect("source");
        assert_eq!(lookup_existing_output(&source, "image-balanced"), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn record_then_lookup_returns_output_for_same_source_and_preset() {
        let root = temp_root("hit");
        let source = root.join("Photo.JPG");
        fs::write(&source, b"pixels-v1").expect("source");
        let out = preferred_output_path(&source, "webp");
        fs::create_dir_all(out.parent().unwrap()).expect("dir");
        fs::write(&out, b"encoded").expect("out");

        record_output(&source, "image-balanced", &out).expect("record");
        assert_eq!(
            lookup_existing_output(&source, "image-balanced"),
            Some(out.clone())
        );
        // Different preset → no hit even if same preferred naming stem.
        assert_eq!(lookup_existing_output(&source, "image-small"), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lookup_misses_when_source_content_changes() {
        let root = temp_root("changed");
        let source = root.join("shot.png");
        fs::write(&source, b"aaa").expect("source");
        let out = root.join("_compressed").join("shot.webp");
        fs::create_dir_all(out.parent().unwrap()).expect("dir");
        fs::write(&out, b"enc").expect("out");
        record_output(&source, "image-balanced", &out).expect("record");

        fs::write(&source, b"bbb-edited").expect("rewrite");
        assert_eq!(lookup_existing_output(&source, "image-balanced"), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lookup_misses_when_output_file_missing() {
        let root = temp_root("missing-out");
        let source = root.join("shot.png");
        fs::write(&source, b"aaa").expect("source");
        let out = root.join("_compressed").join("shot.webp");
        fs::create_dir_all(out.parent().unwrap()).expect("dir");
        fs::write(&out, b"enc").expect("out");
        record_output(&source, "image-balanced", &out).expect("record");
        fs::remove_file(&out).expect("rm out");
        assert_eq!(lookup_existing_output(&source, "image-balanced"), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn content_hash_stable_for_same_bytes() {
        let root = temp_root("hash");
        let a = root.join("a.bin");
        let b = root.join("b.bin");
        {
            let mut fa = fs::File::create(&a).unwrap();
            fa.write_all(b"hello").unwrap();
            let mut fb = fs::File::create(&b).unwrap();
            fb.write_all(b"hello").unwrap();
        }
        assert_eq!(content_hash(&a).unwrap(), content_hash(&b).unwrap());
        fs::write(&b, b"hellp").unwrap();
        assert_ne!(content_hash(&a).unwrap(), content_hash(&b).unwrap());
        let _ = fs::remove_dir_all(&root);
    }
}

//! Compressed output path policy.
//!
//! For source `/path/to/Photo.JPG` and `preset_or_ext` `webp` (or `.webp`):
//! - Directory: `/path/to/_compressed/` (created on first write via [`prepare_output_path`])
//! - Preferred file: `Photo.webp` (source stem + sanitized extension)
//! - Collision policy: if that path already exists, use `Photo_2.webp`, then `Photo_3.webp`, …
//!   (1-based suffix starting at `_2`; never overwrites an existing file)
//! - Never returns the source path; never writes in place.

use std::fs;
use std::path::{Path, PathBuf};

/// Directory name created beside the source file's parent.
pub const COMPRESSED_DIR_NAME: &str = "_compressed";

/// Sanitize `preset_or_ext` into a file extension (no leading dot).
///
/// Keeps ASCII alphanumeric, `_`, and `-`; lowercases. Empty / all-invalid → `"out"`.
pub fn extension_from_preset_or_ext(preset_or_ext: &str) -> String {
    let trimmed = preset_or_ext.trim().trim_start_matches('.');
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch.to_ascii_lowercase());
        }
    }
    if out.is_empty() {
        "out".into()
    } else {
        out
    }
}

/// Pure preferred path (no collision resolution, no mkdir).
///
/// `(source_path, preset_or_ext) -> <parent>/_compressed/<stem>.<ext>`
pub fn preferred_output_path(source_path: &Path, preset_or_ext: &str) -> PathBuf {
    let parent = source_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("output");
    let ext = extension_from_preset_or_ext(preset_or_ext);
    parent
        .join(COMPRESSED_DIR_NAME)
        .join(format!("{stem}.{ext}"))
}

/// Pure collision resolution given an `exists` predicate.
///
/// Starts at [`preferred_output_path`]; on collision appends `_2`, `_3`, … before the extension.
/// Skips any candidate equal to `source_path`.
pub fn resolve_output_path_with<F>(
    source_path: &Path,
    preset_or_ext: &str,
    mut exists: F,
) -> PathBuf
where
    F: FnMut(&Path) -> bool,
{
    let preferred = preferred_output_path(source_path, preset_or_ext);
    let parent = preferred
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = preferred
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output")
        .to_string();
    let ext = preferred
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("out")
        .to_string();

    for n in 1u32.. {
        let name = if n == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem}_{n}.{ext}")
        };
        let candidate = parent.join(name);
        if candidate != source_path && !exists(&candidate) {
            return candidate;
        }
    }
    unreachable!("u32 range exhausted while resolving output path");
}

/// Create `<parent>/_compressed` if needed and return a non-colliding output path.
///
/// Errors if the directory cannot be created (e.g. permissions).
pub fn prepare_output_path(source_path: &Path, preset_or_ext: &str) -> Result<PathBuf, String> {
    let preferred = preferred_output_path(source_path, preset_or_ext);
    let dir = preferred
        .parent()
        .ok_or_else(|| "cannot determine _compressed directory".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("cannot create _compressed directory: {e}"))?;

    let path = resolve_output_path_with(source_path, preset_or_ext, |p| p.exists());
    if path == source_path {
        return Err("refusing to overwrite source file".into());
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::io::Write;

    #[test]
    fn preferred_path_nests_under_compressed_beside_parent() {
        let source = Path::new("/path/to/Photo.JPG");
        let out = preferred_output_path(source, "webp");
        assert_eq!(out, PathBuf::from("/path/to/_compressed/Photo.webp"));
    }

    #[test]
    fn preferred_path_nested_and_unicode_stem() {
        let source = Path::new("/photos/旅行/写真.JPEG");
        let out = preferred_output_path(source, ".avif");
        assert_eq!(out, PathBuf::from("/photos/旅行/_compressed/写真.avif"));
    }

    #[test]
    fn extension_sanitizes_preset_slug() {
        assert_eq!(extension_from_preset_or_ext("Balanced!"), "balanced");
        assert_eq!(extension_from_preset_or_ext("..WEBP"), "webp");
        assert_eq!(extension_from_preset_or_ext("!!!"), "out");
        assert_eq!(extension_from_preset_or_ext("stub"), "stub");
    }

    #[test]
    fn collisions_use_deterministic_numeric_suffix() {
        let source = Path::new("/a/b/shot.png");
        let mut occupied = HashSet::new();
        occupied.insert(PathBuf::from("/a/b/_compressed/shot.webp"));
        occupied.insert(PathBuf::from("/a/b/_compressed/shot_2.webp"));

        let out = resolve_output_path_with(source, "webp", |p| occupied.contains(p));
        assert_eq!(out, PathBuf::from("/a/b/_compressed/shot_3.webp"));
    }

    #[test]
    fn source_already_under_compressed_nests_another_compressed_dir() {
        let source = Path::new("/a/_compressed/shot.stub");
        let out = preferred_output_path(source, "stub");
        assert_eq!(out, PathBuf::from("/a/_compressed/_compressed/shot.stub"));
        assert_ne!(out, source);
    }

    #[test]
    fn prepare_creates_dir_and_avoids_overwrite() {
        let root = std::env::temp_dir().join(format!(
            "fo-output-path-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("root");
        let source = root.join("Holiday.JPG");
        {
            let mut f = fs::File::create(&source).expect("source");
            f.write_all(b"src").expect("write");
        }

        let first = prepare_output_path(&source, "stub").expect("first");
        assert_eq!(first, root.join("_compressed").join("Holiday.stub"));
        assert!(root.join("_compressed").is_dir());
        fs::write(&first, b"out1").expect("occupy first");

        let second = prepare_output_path(&source, "stub").expect("second");
        assert_eq!(second, root.join("_compressed").join("Holiday_2.stub"));
        assert!(!second.exists());

        let source_bytes = fs::read(&source).expect("read source");
        assert_eq!(source_bytes, b"src");

        let _ = fs::remove_dir_all(&root);
    }
}

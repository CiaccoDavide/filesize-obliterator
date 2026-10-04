//! Runtime asset-protocol scope grants for offline image preview.
//!
//! Config ships with an empty assetProtocol.scope; this module allows only the
//! exact source/output files needed for a compare view.

use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

fn validate_preview_file_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("preview path is required".into());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("preview path contains control characters".into());
    }
    // Reject URI-looking inputs (http:, asset:, file:, …) while keeping Windows drive paths.
    let bytes = trimmed.as_bytes();
    let looks_like_windows_abs = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    let looks_like_unc = trimmed.starts_with("\\\\");
    if !looks_like_windows_abs && !looks_like_unc {
        if let Some(scheme_end) = trimmed.find(':') {
            let scheme = &trimmed[..scheme_end];
            if !scheme.is_empty()
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '.' || c == '-')
            {
                return Err("preview path must be a filesystem path".into());
            }
        }
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("preview path must be absolute".into());
    }
    if path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("preview path must not contain parent traversal".into());
    }
    if !path.is_file() {
        return Err("preview path is not a readable file".into());
    }
    Ok(path)
}

fn allow_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|e| format!("asset scope grant failed: {e}"))
}

/// Allow only the two concrete files needed for an offline image compare.
#[tauri::command]
pub fn preview_allow_assets(
    app: AppHandle,
    source_path: String,
    output_path: String,
) -> Result<(), String> {
    let source = validate_preview_file_path(&source_path)?;
    let output = validate_preview_file_path(&output_path)?;
    allow_file(&app, &source)?;
    allow_file(&app, &output)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_preview_file_path;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file(name: &str, contents: &[u8]) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("fo-preview-{nanos}"));
        fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join(name);
        let mut f = fs::File::create(&path).expect("create");
        f.write_all(contents).expect("write");
        path
    }

    #[test]
    fn rejects_empty_relative_scheme_and_traversal() {
        assert!(validate_preview_file_path("").is_err());
        assert!(validate_preview_file_path("   ").is_err());
        assert!(validate_preview_file_path("relative/pic.png").is_err());
        assert!(validate_preview_file_path("https://evil.example/a.png").is_err());
        assert!(validate_preview_file_path("asset://localhost/x").is_err());
        assert!(validate_preview_file_path("/tmp/../etc/passwd").is_err());
    }

    #[test]
    fn accepts_existing_absolute_file() {
        let path = temp_file("shot.png", b"x");
        let raw = path.to_string_lossy().into_owned();
        let ok = validate_preview_file_path(&raw).expect("absolute file ok");
        assert_eq!(ok, path);
        let _ = fs::remove_file(&path);
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir(parent);
        }
    }
}

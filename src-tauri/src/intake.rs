use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPath {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    /// True when this file came from expanding a dropped/picked directory (one level).
    pub from_directory: bool,
}

/// Resolve dropped/picked paths into file probes.
/// Directories expand one level of immediate files (nested dirs skipped).
#[tauri::command]
pub fn intake_resolve(paths: Vec<String>) -> Result<Vec<ResolvedPath>, String> {
    let mut out = Vec::new();
    for raw in paths {
        let path = PathBuf::from(&raw);
        let meta = fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        if meta.is_file() {
            out.push(file_probe(&path, meta.len(), false)?);
            continue;
        }
        if meta.is_dir() {
            let entries = fs::read_dir(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            for entry in entries {
                let entry = entry.map_err(|e| e.to_string())?;
                let child = entry.path();
                let child_meta = entry.metadata().map_err(|e| format!("{}: {e}", child.display()))?;
                if child_meta.is_file() {
                    out.push(file_probe(&child, child_meta.len(), true)?);
                }
            }
            continue;
        }
        return Err(format!("{}: not a file or directory", path.display()));
    }
    Ok(out)
}

fn file_probe(path: &Path, bytes: u64, from_directory: bool) -> Result<ResolvedPath, String> {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let path_str = path
        .to_str()
        .ok_or_else(|| format!("{}: non-utf8 path", path.display()))?
        .to_string();
    Ok(ResolvedPath {
        path: path_str,
        name,
        bytes,
        from_directory,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn resolves_file_and_expands_directory_one_level() {
        let dir = std::env::temp_dir().join(format!(
            "fo-intake-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let nested = dir.join("nested");
        fs::create_dir_all(&nested).unwrap();

        let file_a = dir.join("a.png");
        let mut f = fs::File::create(&file_a).unwrap();
        write!(f, "abc").unwrap();

        let nested_file = nested.join("deep.jpg");
        fs::File::create(&nested_file).unwrap();

        let lone = dir.join("lone.mp3");
        let mut f2 = fs::File::create(&lone).unwrap();
        write!(f2, "xy").unwrap();

        let resolved = intake_resolve(vec![
            lone.to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
        ])
        .expect("resolve");

        let lone_s = lone.to_string_lossy().into_owned();
        let file_a_s = file_a.to_string_lossy().into_owned();
        let paths: Vec<&str> = resolved.iter().map(|r| r.path.as_str()).collect();
        assert!(paths.contains(&lone_s.as_str()));
        assert!(paths.contains(&file_a_s.as_str()));
        assert!(!paths.iter().any(|p| p.ends_with("deep.jpg")));

        let from_dir = resolved
            .iter()
            .find(|r| r.path.ends_with("a.png"))
            .expect("a.png");
        assert!(from_dir.from_directory);
        assert_eq!(from_dir.bytes, 3);

        let lone_meta = resolved
            .iter()
            .find(|r| r.path.ends_with("lone.mp3"))
            .expect("lone");
        assert!(!lone_meta.from_directory);
        assert_eq!(lone_meta.bytes, 2);

        let _ = fs::remove_dir_all(&dir);
    }
}

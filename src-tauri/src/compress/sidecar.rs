//! Resolve vendored encoder sidecars for offline release bundles.
//!
//! Lookup order (no network):
//! 1. Explicit env var (`FFMPEG_PATH` / `GS_PATH`) when set to an existing file
//! 2. Beside the running executable (Tauri `bundle.externalBin` drop-in)
//! 3. Common Tauri resource / binaries layouts relative to the exe
//! 4. Host `PATH` (dev machines / CI); release bundles should not need this

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Names to try when locating a tool beside the app or on PATH.
#[derive(Debug, Clone, Copy)]
pub struct ToolSpec {
    pub env_var: &'static str,
    pub label: &'static str,
    /// Bare filenames next to the executable / under resources (with optional `.exe`).
    pub file_names: &'static [&'static str],
    /// `PATH` / spawn names (Windows may differ from Unix).
    pub path_names: &'static [&'static str],
    pub install_hint: &'static str,
}

pub const FFMPEG: ToolSpec = ToolSpec {
    env_var: "FFMPEG_PATH",
    label: "ffmpeg",
    file_names: &["ffmpeg", "ffmpeg.exe"],
    path_names: &["ffmpeg"],
    install_hint: "Install ffmpeg locally or bundle it via `scripts/fetch-sidecars.sh` \
(Tauri externalBin) for offline video compression.",
};

pub const GHOSTSCRIPT: ToolSpec = ToolSpec {
    env_var: "GS_PATH",
    label: "ghostscript",
    file_names: &["gs", "gs.exe", "gswin64c.exe", "gswin32c.exe", "ghostscript"],
    path_names: &["gs", "gswin64c", "gswin32c", "ghostscript"],
    install_hint: "Install Ghostscript locally or bundle it via `scripts/fetch-sidecars.sh` \
(Tauri externalBin) for offline PDF compression.",
};

/// Ordered candidate paths for a tool under `exe_dir` (parent of `current_exe`).
///
/// Includes Tauri `externalBin` siblings, `resources/`, macOS `Contents/Resources`,
/// and `binaries/` with optional Rust target-triple suffixes used at fetch/build time.
pub fn sidecar_candidates(
    exe_dir: &Path,
    file_names: &[&str],
    target_triple: Option<&str>,
) -> Vec<PathBuf> {
    let mut out = Vec::new();

    for name in file_names {
        push_unique(&mut out, exe_dir.join(name));
    }

    let rel_dirs = [
        "resources",
        "../Resources",
        "binaries",
        "../Resources/binaries",
    ];
    for rel in rel_dirs {
        let dir = exe_dir.join(rel);
        for name in file_names {
            push_unique(&mut out, dir.join(name));
            if let Some(triple) = target_triple {
                push_unique(&mut out, dir.join(format!("{name}-{triple}")));
                // Windows fetch layout keeps `.exe` after the triple.
                if let Some(stem) = name.strip_suffix(".exe") {
                    push_unique(&mut out, dir.join(format!("{stem}-{triple}.exe")));
                } else {
                    push_unique(&mut out, dir.join(format!("{name}-{triple}.exe")));
                }
            }
        }
    }

    // Dev: triple-suffixed binary sitting next to the app binary (Tauri target dir).
    if let Some(triple) = target_triple {
        for name in file_names {
            if let Some(stem) = name.strip_suffix(".exe") {
                push_unique(&mut out, exe_dir.join(format!("{stem}-{triple}.exe")));
            } else {
                push_unique(&mut out, exe_dir.join(format!("{name}-{triple}")));
                push_unique(&mut out, exe_dir.join(format!("{name}-{triple}.exe")));
            }
        }
    }

    out
}

fn push_unique(out: &mut Vec<PathBuf>, path: PathBuf) {
    if !out.iter().any(|p| p == &path) {
        out.push(path);
    }
}

fn first_existing_file(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

fn which_on_path(names: &[&str], version_arg: &str) -> Option<PathBuf> {
    for name in names {
        match Command::new(name)
            .arg(version_arg)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(status) if status.success() => return Some(PathBuf::from(name)),
            Ok(_) | Err(_) => continue,
        }
    }
    None
}

/// Resolve a local tool without network.
pub fn resolve_tool(spec: &ToolSpec, version_arg: &str) -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var(spec.env_var) {
        let p = PathBuf::from(explicit.trim());
        if p.is_file() {
            return Ok(p);
        }
        return Err(format!(
            "missing tool: {} ({} set but not a file: {})",
            spec.label,
            spec.env_var,
            p.display()
        ));
    }

    let triple = option_env!("TARGET")
        .map(str::to_string)
        .or_else(|| std::env::var("TARGET").ok())
        .or_else(host_target_triple);

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidates = sidecar_candidates(dir, spec.file_names, triple.as_deref());
            if let Some(found) = first_existing_file(&candidates) {
                return Ok(found);
            }
        }
    }

    // Dev/test: also scan src-tauri/binaries (fetch script output) when present.
    let manifest_binaries = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if manifest_binaries.is_dir() {
        let mut direct = Vec::new();
        for name in spec.file_names {
            direct.push(manifest_binaries.join(name));
            if let Some(t) = triple.as_deref() {
                if let Some(stem) = name.strip_suffix(".exe") {
                    direct.push(manifest_binaries.join(format!("{stem}-{t}.exe")));
                } else {
                    direct.push(manifest_binaries.join(format!("{name}-{t}")));
                    direct.push(manifest_binaries.join(format!("{name}-{t}.exe")));
                }
            }
        }
        if let Some(found) = first_existing_file(&direct) {
            return Ok(found);
        }
    }

    which_on_path(spec.path_names, version_arg).ok_or_else(|| {
        format!(
            "missing tool: {} (not found on PATH, beside the app, or via {}). {}",
            spec.label, spec.env_var, spec.install_hint
        )
    })
}

fn host_target_triple() -> Option<String> {
    let output = Command::new("rustc").arg("-vV").output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().find_map(|line| {
        line.strip_prefix("host: ")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    })
}

pub fn resolve_ffmpeg() -> Result<PathBuf, String> {
    resolve_tool(&FFMPEG, "-version")
}

pub fn resolve_ghostscript() -> Result<PathBuf, String> {
    resolve_tool(&GHOSTSCRIPT, "-v")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("fo-sidecar-{label}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn touch(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(path, b"stub").expect("touch");
    }

    #[test]
    fn candidates_prefer_exe_sibling_then_resources_then_binaries() {
        let exe_dir = PathBuf::from("/App/Contents/MacOS");
        let c = sidecar_candidates(&exe_dir, &["ffmpeg"], Some("aarch64-apple-darwin"));
        assert_eq!(c[0], exe_dir.join("ffmpeg"));
        assert!(
            c.iter().any(|p| p == &exe_dir.join("resources/ffmpeg")),
            "resources layout: {c:?}"
        );
        assert!(
            c.iter()
                .any(|p| p == &exe_dir.join("../Resources/ffmpeg")),
            "macOS Resources: {c:?}"
        );
        assert!(
            c.iter().any(|p| p == &exe_dir.join("binaries/ffmpeg")),
            "binaries/: {c:?}"
        );
        assert!(
            c.iter()
                .any(|p| p == &exe_dir.join("binaries/ffmpeg-aarch64-apple-darwin")),
            "triple-suffixed fetch name: {c:?}"
        );
    }

    #[test]
    fn candidates_include_windows_exe_triple_form() {
        let exe_dir = PathBuf::from(r"C:\Program Files\App");
        let c = sidecar_candidates(
            &exe_dir,
            &["gs.exe", "gswin64c.exe"],
            Some("x86_64-pc-windows-msvc"),
        );
        assert!(c.iter().any(|p| p == &exe_dir.join("gs.exe")));
        assert!(c.iter().any(|p| {
            p == &exe_dir.join("binaries/gs-x86_64-pc-windows-msvc.exe")
                || p == &exe_dir.join("gs-x86_64-pc-windows-msvc.exe")
        }));
    }

    #[test]
    fn first_existing_picks_bundled_sibling_without_path() {
        let dir = temp_dir("sibling");
        let ffmpeg = dir.join("ffmpeg");
        touch(&ffmpeg);
        let candidates = sidecar_candidates(&dir, &["ffmpeg", "ffmpeg.exe"], None);
        let found = first_existing_file(&candidates).expect("bundled ffmpeg");
        assert_eq!(found, ffmpeg);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn first_existing_finds_triple_suffixed_under_binaries() {
        let dir = temp_dir("triple");
        let dest = dir
            .join("binaries")
            .join("ffmpeg-x86_64-unknown-linux-gnu");
        touch(&dest);
        let candidates =
            sidecar_candidates(&dir, &["ffmpeg"], Some("x86_64-unknown-linux-gnu"));
        let found = first_existing_file(&candidates).expect("triple ffmpeg");
        assert_eq!(found, dest);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ghostscript_candidates_cover_unix_and_windows_names() {
        let dir = PathBuf::from("/opt/app");
        let c = sidecar_candidates(&dir, GHOSTSCRIPT.file_names, None);
        assert!(c.iter().any(|p| p.file_name().and_then(|s| s.to_str()) == Some("gs")));
        assert!(c
            .iter()
            .any(|p| p.file_name().and_then(|s| s.to_str()) == Some("gswin64c.exe")));
    }
}

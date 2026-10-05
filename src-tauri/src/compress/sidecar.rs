//! Resolve encoder tools for offline use.
//!
//! ffmpeg lookup order (no network):
//! 1. Explicit env var (`FFMPEG_PATH`) when set to an existing working file
//! 2. Beside the running executable (Tauri `bundle.externalBin` drop-in)
//! 3. Common Tauri resource / binaries layouts relative to the exe
//! 4. `src-tauri/binaries` (fetch script output) during cargo test / dev
//! 5. Host `PATH` (dev machines / CI)
//!
//! Ghostscript is **PATH / `GS_PATH` only** — AGPL, not redistributed via externalBin.
//! See `THIRD_PARTY_NOTICES.md`.

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
    /// When false, skip sidecar / binaries layouts (PATH + env only).
    pub allow_sidecar: bool,
}

pub const FFMPEG: ToolSpec = ToolSpec {
    env_var: "FFMPEG_PATH",
    label: "ffmpeg",
    file_names: &["ffmpeg", "ffmpeg.exe"],
    path_names: &["ffmpeg"],
    install_hint: "Install ffmpeg locally or bundle it via `scripts/fetch-sidecars.sh` \
(Tauri externalBin) for offline video compression.",
    allow_sidecar: true,
};

pub const GHOSTSCRIPT: ToolSpec = ToolSpec {
    env_var: "GS_PATH",
    label: "ghostscript",
    file_names: &["gs", "gs.exe", "gswin64c.exe", "gswin32c.exe", "ghostscript"],
    path_names: &["gs", "gswin64c", "gswin32c", "ghostscript"],
    install_hint: "Install Ghostscript on the host (PATH) or set GS_PATH. \
Ghostscript is AGPL and is not bundled in the installer — see THIRD_PARTY_NOTICES.md.",
    allow_sidecar: false,
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

fn probe_version(path: &Path, version_arg: &str) -> bool {
    Command::new(path)
        .arg(version_arg)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn first_working_file(candidates: &[PathBuf], version_arg: &str) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|p| p.is_file() && probe_version(p, version_arg))
        .cloned()
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
        if p.is_file() && probe_version(&p, version_arg) {
            return Ok(p);
        }
        return Err(format!(
            "missing tool: {} ({} set but not a working file: {})",
            spec.label,
            spec.env_var,
            p.display()
        ));
    }

    let triple = option_env!("TARGET")
        .map(str::to_string)
        .or_else(|| std::env::var("TARGET").ok())
        .or_else(host_target_triple);

    if spec.allow_sidecar {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let candidates = sidecar_candidates(dir, spec.file_names, triple.as_deref());
                if let Some(found) = first_working_file(&candidates, version_arg) {
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
            if let Some(found) = first_working_file(&direct, version_arg) {
                return Ok(found);
            }
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

/// When `FO_REQUIRE_ENCODERS=1`, **ffmpeg** soft-skips become hard failures (CI).
///
/// Ghostscript remains soft-skippable: AGPL PATH-only exception means PDF tests
/// must not fail the matrix when `gs` / `gswin64c` is absent.
#[cfg(test)]
pub fn encoders_required() -> bool {
    matches!(
        std::env::var("FO_REQUIRE_ENCODERS").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes")
    )
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
            &["ffmpeg.exe"],
            Some("x86_64-pc-windows-msvc"),
        );
        assert!(c.iter().any(|p| p == &exe_dir.join("ffmpeg.exe")));
        assert!(c.iter().any(|p| {
            p == &exe_dir.join("binaries/ffmpeg-x86_64-pc-windows-msvc.exe")
                || p == &exe_dir.join("ffmpeg-x86_64-pc-windows-msvc.exe")
        }));
    }

    #[test]
    fn first_working_skips_inert_stub_files() {
        let dir = temp_dir("stub");
        let stub = dir.join("ffmpeg");
        touch(&stub);
        let candidates = sidecar_candidates(&dir, &["ffmpeg", "ffmpeg.exe"], None);
        assert!(
            first_working_file(&candidates, "-version").is_none(),
            "inert stub must not count as a working ffmpeg"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn first_working_finds_triple_suffixed_under_binaries_when_probe_ok() {
        // Use a tiny shell script that answers -version successfully when possible.
        let dir = temp_dir("triple");
        let dest = dir
            .join("binaries")
            .join("ffmpeg-x86_64-unknown-linux-gnu");
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::write(
                &dest,
                b"#!/bin/sh\nif [ \"$1\" = \"-version\" ]; then echo ffmpeg; exit 0; fi\nexit 1\n",
            )
            .expect("write");
            let mut perms = fs::metadata(&dest).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&dest, perms).unwrap();
            let candidates =
                sidecar_candidates(&dir, &["ffmpeg"], Some("x86_64-unknown-linux-gnu"));
            let found = first_working_file(&candidates, "-version").expect("triple ffmpeg");
            assert_eq!(found, dest);
        }
        #[cfg(not(unix))]
        {
            // On Windows, inert files are skipped; PATH coverage is separate.
            touch(&dest);
            let candidates =
                sidecar_candidates(&dir, &["ffmpeg"], Some("x86_64-unknown-linux-gnu"));
            assert!(first_working_file(&candidates, "-version").is_none());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ghostscript_disallows_sidecar_layout() {
        assert!(!GHOSTSCRIPT.allow_sidecar);
        assert!(FFMPEG.allow_sidecar);
    }

    #[test]
    fn staged_or_path_ffmpeg_resolves_when_encoders_required() {
        if !encoders_required() {
            // Soft path: still exercise resolve; soft-skip only when truly absent.
            match resolve_ffmpeg() {
                Ok(p) => assert!(p.as_os_str().len() > 0, "empty ffmpeg path"),
                Err(e) => eprintln!("ignoring test: {e}"),
            }
            return;
        }
        let path = resolve_ffmpeg().expect("FO_REQUIRE_ENCODERS=1 requires working ffmpeg");
        assert!(
            probe_version(&path, "-version"),
            "resolved ffmpeg must answer -version: {}",
            path.display()
        );
    }

    #[test]
    fn path_ghostscript_soft_skips_when_absent() {
        // GS is PATH-only (AGPL) — never hard-fail under FO_REQUIRE_ENCODERS.
        match resolve_ghostscript() {
            Ok(p) => {
                assert!(p.as_os_str().len() > 0);
                assert!(
                    probe_version(&p, "-v"),
                    "resolved ghostscript must answer -v: {}",
                    p.display()
                );
            }
            Err(e) => eprintln!("ignoring test: {e}"),
        }
    }
}

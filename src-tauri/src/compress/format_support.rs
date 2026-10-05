//! Offline format capability probe for extended image/video inputs.
//!
//! Used to emit clear errors when a container is recognized but unavailable
//! on the current platform (e.g. HEIC without macOS `sips`).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

/// Still-image containers decoded by the bundled `image` crate (no platform tools).
#[allow(dead_code)] // public capability table for docs/UI
pub const BUNDLED_STILL_IMAGE_EXTS: &[&str] =
    &["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "bmp"];

/// Image containers that require a platform decoder.
#[allow(dead_code)] // public capability table for docs/UI
pub const PLATFORM_IMAGE_EXTS: &[&str] = &["heic", "heif"];

/// Image containers recognized but never decoded in this build.
#[allow(dead_code)] // public capability table for docs/UI
pub const UNSUPPORTED_IMAGE_EXTS: &[&str] = &["avif"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // re-exported; constructed via image_format_capabilities
pub enum FormatAvailability {
    /// Offline encode/decode path is available on this machine.
    Available,
    /// Recognized but no offline decoder on this platform/build.
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // re-exported; constructed via image_format_capabilities
pub struct FormatCapability {
    pub id: &'static str,
    pub availability: FormatAvailability,
    pub note: &'static str,
}

/// Snapshot of extended-format capabilities for docs/tests/UI.
#[allow(dead_code)] // re-exported for UI; covered by unit tests
pub fn image_format_capabilities() -> Vec<FormatCapability> {
    vec![
        FormatCapability {
            id: "jpeg",
            availability: FormatAvailability::Available,
            note: "Bundled decoder/encoder",
        },
        FormatCapability {
            id: "png",
            availability: FormatAvailability::Available,
            note: "Bundled decoder/encoder",
        },
        FormatCapability {
            id: "webp",
            availability: FormatAvailability::Available,
            note: "Bundled still + animated encode",
        },
        FormatCapability {
            id: "gif",
            availability: FormatAvailability::Available,
            note: "Bundled; animated GIF → animated WebP",
        },
        FormatCapability {
            id: "tiff",
            availability: FormatAvailability::Available,
            note: "Bundled still decode → JPEG/WebP",
        },
        FormatCapability {
            id: "bmp",
            availability: FormatAvailability::Available,
            note: "Bundled still decode → JPEG/WebP",
        },
        FormatCapability {
            id: "heic",
            availability: if heic_decode_available() {
                FormatAvailability::Available
            } else {
                FormatAvailability::Unavailable
            },
            note: heic_capability_note(),
        },
        FormatCapability {
            id: "avif",
            availability: FormatAvailability::Unavailable,
            note: "No offline AVIF decoder bundled",
        },
    ]
}

pub fn heic_capability_note() -> &'static str {
    if cfg!(target_os = "macos") {
        if heic_decode_available() {
            "macOS sips / ImageIO offline decode"
        } else {
            "macOS HEIC decode needs local sips (not found)"
        }
    } else {
        "HEIC decode is macOS-only in this build (no libheif bundle)"
    }
}

/// True when this process can convert HEIC/HEIF offline (macOS `sips`).
pub fn heic_decode_available() -> bool {
    cfg!(target_os = "macos") && resolve_sips().is_some()
}

pub fn resolve_sips() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    for candidate in ["/usr/bin/sips", "sips"] {
        let p = PathBuf::from(candidate);
        if sips_runs(&p) {
            return Some(if candidate == "sips" {
                PathBuf::from("sips")
            } else {
                p
            });
        }
    }
    None
}

fn sips_runs(bin: &Path) -> bool {
    Command::new(bin)
        .arg("-h")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Clear error when an image extension cannot be decoded offline here.
pub fn image_format_rejection(ext: &str) -> Option<String> {
    let ext = ext.to_ascii_lowercase();
    match ext.as_str() {
        "heic" | "heif" if !heic_decode_available() => Some(format!(
            "unsupported image format '.{ext}' ({})",
            heic_capability_note()
        )),
        "avif" => Some(
            "unsupported image format '.avif' (offline decoder not bundled)".into(),
        ),
        _ => None,
    }
}

pub fn extension_lower(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_list_includes_heic_and_gif() {
        let caps = image_format_capabilities();
        let ids: Vec<_> = caps.iter().map(|c| c.id).collect();
        assert!(ids.contains(&"heic"));
        assert!(ids.contains(&"gif"));
        assert!(ids.contains(&"tiff"));
        let gif = caps.iter().find(|c| c.id == "gif").unwrap();
        assert_eq!(gif.availability, FormatAvailability::Available);
    }

    #[test]
    fn avif_always_rejected() {
        let err = image_format_rejection("avif").expect("avif");
        assert!(err.contains("unsupported"), "{err}");
        assert!(err.contains("avif"), "{err}");
    }

    #[test]
    fn heic_rejection_matches_platform() {
        match image_format_rejection("heic") {
            None => assert!(
                heic_decode_available(),
                "no rejection only when HEIC decode is available"
            ),
            Some(err) => {
                assert!(!heic_decode_available());
                assert!(err.contains("unsupported"), "{err}");
                assert!(err.contains("heic"), "{err}");
            }
        }
    }
}

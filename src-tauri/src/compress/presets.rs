//! Built-in compression preset registry (stable ids for UI + job runner).
//!
//! HEIC/HEIF is intentionally unsupported here — no offline decoder is bundled.

use super::types::MediaKind;
use serde::{Deserialize, Serialize};

/// Stable image preset ids.
pub const IMAGE_HIGH: &str = "image-high";
pub const IMAGE_BALANCED: &str = "image-balanced";
pub const IMAGE_SMALL: &str = "image-small";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub id: String,
    pub label: String,
    pub kind: MediaKind,
    pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ImageEncodeTarget {
    /// Lossy JPEG. `quality` is 1–100.
    Jpeg { quality: u8 },
    /// Lossy WebP. `quality` is 0.0–100.0.
    Webp { quality: f32 },
}

#[derive(Debug, Clone, Copy)]
pub struct ImagePreset {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub target: ImageEncodeTarget,
}

impl ImagePreset {
    pub fn output_ext(&self) -> &'static str {
        match self.target {
            ImageEncodeTarget::Jpeg { .. } => "jpg",
            ImageEncodeTarget::Webp { .. } => "webp",
        }
    }

    pub fn info(&self) -> PresetInfo {
        PresetInfo {
            id: self.id.into(),
            label: self.label.into(),
            kind: MediaKind::Image,
            description: self.description.into(),
        }
    }
}

/// High prioritizes visual quality over size (may not shrink already-optimized inputs).
const IMAGE_PRESETS: &[ImagePreset] = &[
    ImagePreset {
        id: IMAGE_HIGH,
        label: "High",
        description: "High-quality JPEG (~q90). Prefers fidelity; size savings are modest on already-compressed photos.",
        target: ImageEncodeTarget::Jpeg { quality: 90 },
    },
    ImagePreset {
        id: IMAGE_BALANCED,
        label: "Balanced",
        description: "Balanced WebP (~q75). Good quality/size tradeoff for typical photos.",
        target: ImageEncodeTarget::Webp { quality: 75.0 },
    },
    ImagePreset {
        id: IMAGE_SMALL,
        label: "Small",
        description: "Small WebP (~q45). Prioritizes file size over fine detail.",
        target: ImageEncodeTarget::Webp { quality: 45.0 },
    },
];

pub fn image_presets() -> &'static [ImagePreset] {
    IMAGE_PRESETS
}

pub fn image_preset(id: &str) -> Option<&'static ImagePreset> {
    IMAGE_PRESETS.iter().find(|p| p.id == id)
}

/// All built-in presets (currently image-only; other kinds arrive in later tasks).
pub fn all_presets() -> Vec<PresetInfo> {
    image_presets().iter().map(ImagePreset::info).collect()
}

pub fn presets_for_kind(kind: &MediaKind) -> Vec<PresetInfo> {
    all_presets()
        .into_iter()
        .filter(|p| &p.kind == kind)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_registry_has_three_stable_ids() {
        let ids: Vec<_> = image_presets().iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![IMAGE_HIGH, IMAGE_BALANCED, IMAGE_SMALL]);
        for p in image_presets() {
            assert_eq!(p.info().kind, MediaKind::Image);
            assert!(!p.label.is_empty());
            assert!(!p.description.is_empty());
            assert!(!p.output_ext().is_empty());
        }
    }

    #[test]
    fn presets_for_kind_filters_image() {
        assert_eq!(presets_for_kind(&MediaKind::Image).len(), 3);
        assert!(presets_for_kind(&MediaKind::Audio).is_empty());
        assert!(presets_for_kind(&MediaKind::Video).is_empty());
        assert!(presets_for_kind(&MediaKind::Pdf).is_empty());
    }

    #[test]
    fn preset_info_serde_camel_case() {
        let info = image_preset(IMAGE_BALANCED).unwrap().info();
        let json = serde_json::to_string(&info).expect("ser");
        assert!(json.contains("\"id\":\"image-balanced\""));
        assert!(json.contains("\"kind\":\"image\""));
        assert!(json.contains("\"label\":\"Balanced\""));
        assert!(json.contains("\"description\":"));
    }
}

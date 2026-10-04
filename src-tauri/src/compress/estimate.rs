//! Offline dry-run size estimates — heuristic only; never writes `_compressed` outputs.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::presets::{
    audio_preset, image_preset, pdf_preset, video_preset, AUDIO_BALANCED, AUDIO_HIGH, AUDIO_SMALL,
    IMAGE_BALANCED, IMAGE_HIGH, IMAGE_SMALL, PDF_EBOOK, PDF_PRINT, PDF_SCREEN, VIDEO_BALANCED,
    VIDEO_HIGH, VIDEO_SMALL,
};
use super::types::MediaKind;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EstimateConfidence {
    Exact,
    Approximate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompressEstimateRequest {
    pub source_path: String,
    pub media_kind: MediaKind,
    pub preset_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompressEstimateResult {
    pub path: String,
    pub preset_id: String,
    pub estimated_bytes: u64,
    pub confidence: EstimateConfidence,
    pub original_bytes: u64,
}

/// Fixed heuristic ratio (estimated / original) per built-in preset.
///
/// Values are deliberately coarse — UI labels them approximate.
pub fn heuristic_ratio(kind: &MediaKind, preset_id: &str) -> Option<f64> {
    match kind {
        MediaKind::Image => match preset_id {
            IMAGE_HIGH => Some(0.90),
            IMAGE_BALANCED => Some(0.40),
            IMAGE_SMALL => Some(0.22),
            _ => None,
        },
        MediaKind::Audio => match preset_id {
            AUDIO_HIGH => Some(0.95),
            AUDIO_BALANCED => Some(0.55),
            AUDIO_SMALL => Some(0.40),
            _ => None,
        },
        MediaKind::Video => match preset_id {
            VIDEO_HIGH => Some(0.85),
            VIDEO_BALANCED => Some(0.45),
            VIDEO_SMALL => Some(0.25),
            _ => None,
        },
        MediaKind::Pdf => match preset_id {
            PDF_PRINT => Some(0.92),
            PDF_EBOOK => Some(0.55),
            PDF_SCREEN => Some(0.35),
            _ => None,
        },
    }
}

fn preset_exists(kind: &MediaKind, preset_id: &str) -> bool {
    match kind {
        MediaKind::Image => image_preset(preset_id).is_some(),
        MediaKind::Audio => audio_preset(preset_id).is_some(),
        MediaKind::Video => video_preset(preset_id).is_some(),
        MediaKind::Pdf => pdf_preset(preset_id).is_some(),
    }
}

/// Pure size estimate from known original bytes + preset (no filesystem writes).
pub fn estimate_bytes(
    kind: &MediaKind,
    preset_id: &str,
    original_bytes: u64,
) -> Result<(u64, EstimateConfidence), String> {
    if !preset_exists(kind, preset_id) {
        return Err(format!("unknown preset for {:?}: {preset_id}", kind));
    }
    let ratio = heuristic_ratio(kind, preset_id)
        .ok_or_else(|| format!("no estimate heuristic for preset: {preset_id}"))?;
    let estimated = ((original_bytes as f64) * ratio).round() as u64;
    Ok((estimated, EstimateConfidence::Approximate))
}

/// Read source metadata and return a dry-run estimate. Never creates `_compressed`.
pub fn estimate_request(request: CompressEstimateRequest) -> Result<CompressEstimateResult, String> {
    let source = PathBuf::from(&request.source_path);
    if !source.is_file() {
        return Err("source file not found".into());
    }
    let original_bytes = fs::metadata(&source)
        .map_err(|e| format!("cannot read source: {e}"))?
        .len();
    let (estimated_bytes, confidence) =
        estimate_bytes(&request.media_kind, &request.preset_id, original_bytes)?;
    Ok(CompressEstimateResult {
        path: request.source_path,
        preset_id: request.preset_id,
        estimated_bytes,
        confidence,
        original_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn heuristic_ratios_are_stable_for_built_in_presets() {
        assert_eq!(
            estimate_bytes(&MediaKind::Image, IMAGE_BALANCED, 10_000).unwrap(),
            (4_000, EstimateConfidence::Approximate)
        );
        assert_eq!(
            estimate_bytes(&MediaKind::Audio, AUDIO_SMALL, 1_000).unwrap(),
            (400, EstimateConfidence::Approximate)
        );
        assert_eq!(
            estimate_bytes(&MediaKind::Video, VIDEO_SMALL, 8_000).unwrap(),
            (2_000, EstimateConfidence::Approximate)
        );
        assert_eq!(
            estimate_bytes(&MediaKind::Pdf, PDF_EBOOK, 2_000).unwrap(),
            (1_100, EstimateConfidence::Approximate)
        );
    }

    #[test]
    fn unknown_preset_errors() {
        let err = estimate_bytes(&MediaKind::Image, "nope", 100).unwrap_err();
        assert!(err.contains("unknown preset"));
    }

    #[test]
    fn estimate_request_reads_only_and_skips_compressed_dir() {
        let dir = std::env::temp_dir().join(format!(
            "fo-estimate-dry-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("photo.png");
        fs::write(&source, vec![0u8; 5_000]).unwrap();

        let result = estimate_request(CompressEstimateRequest {
            source_path: source.to_string_lossy().into_owned(),
            media_kind: MediaKind::Image,
            preset_id: IMAGE_SMALL.into(),
        })
        .expect("estimate");

        assert_eq!(result.original_bytes, 5_000);
        assert_eq!(result.estimated_bytes, 1_100); // 5000 * 0.22
        assert_eq!(result.confidence, EstimateConfidence::Approximate);
        assert_eq!(result.preset_id, IMAGE_SMALL);
        assert!(!Path::new(&dir).join("_compressed").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn result_serde_camel_case() {
        let result = CompressEstimateResult {
            path: "/a.png".into(),
            preset_id: IMAGE_BALANCED.into(),
            estimated_bytes: 400,
            confidence: EstimateConfidence::Approximate,
            original_bytes: 1000,
        };
        let json = serde_json::to_string(&result).expect("ser");
        assert!(json.contains("\"path\":\"/a.png\""));
        assert!(json.contains("\"presetId\":\"image-balanced\""));
        assert!(json.contains("\"estimatedBytes\":400"));
        assert!(json.contains("\"confidence\":\"approximate\""));
        assert!(json.contains("\"originalBytes\":1000"));
    }
}

//! Built-in compression preset registry (stable ids for UI + job runner).
//!
//! HEIC/HEIF decode is platform-gated (macOS `sips`); see `format_support`.

use super::types::MediaKind;
use serde::{Deserialize, Serialize};

/// Stable image preset ids.
pub const IMAGE_HIGH: &str = "image-high";
pub const IMAGE_BALANCED: &str = "image-balanced";
pub const IMAGE_SMALL: &str = "image-small";

/// Stable audio preset ids.
pub const AUDIO_HIGH: &str = "audio-high";
pub const AUDIO_BALANCED: &str = "audio-balanced";
pub const AUDIO_SMALL: &str = "audio-small";

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

/// Built-in image presets. `image-high` is quality-first (may not shrink already-optimized
/// inputs); `image-balanced` / `image-small` target size on typical photo-like JPEG/PNG.
const IMAGE_PRESETS: &[ImagePreset] = &[
    ImagePreset {
        id: IMAGE_HIGH,
        label: "High",
        description: "High-quality JPEG (~q90). Quality-first: prefers fidelity; may not shrink already-optimized photos.",
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

/// CBR MP3 bitrate class for audio presets (kbps).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioBitrateKbps {
    Kbps320 = 320,
    Kbps192 = 192,
    Kbps128 = 128,
}

#[derive(Debug, Clone, Copy)]
pub struct AudioPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub bitrate: AudioBitrateKbps,
}

impl AudioPreset {
    pub fn output_ext(&self) -> &'static str {
        "mp3"
    }

    pub fn info(&self) -> PresetInfo {
        PresetInfo {
            id: self.id.into(),
            label: self.label.into(),
            kind: MediaKind::Audio,
            description: self.description.into(),
        }
    }
}

/// Built-in audio presets — three distinct CBR MP3 bitrate alternatives.
const AUDIO_PRESETS: &[AudioPreset] = &[
    AudioPreset {
        id: AUDIO_HIGH,
        label: "High",
        description: "High-quality MP3 (320 kbps CBR). Quality-first; may not shrink already-small MP3s.",
        bitrate: AudioBitrateKbps::Kbps320,
    },
    AudioPreset {
        id: AUDIO_BALANCED,
        label: "Balanced",
        description: "Balanced MP3 (192 kbps CBR). Good quality/size tradeoff for typical tracks.",
        bitrate: AudioBitrateKbps::Kbps192,
    },
    AudioPreset {
        id: AUDIO_SMALL,
        label: "Small",
        description: "Small MP3 (128 kbps CBR). Prioritizes file size over fine detail.",
        bitrate: AudioBitrateKbps::Kbps128,
    },
];

pub fn audio_presets() -> &'static [AudioPreset] {
    AUDIO_PRESETS
}

pub fn audio_preset(id: &str) -> Option<&'static AudioPreset> {
    AUDIO_PRESETS.iter().find(|p| p.id == id)
}

/// Stable video preset ids.
pub const VIDEO_HIGH: &str = "video-high";
pub const VIDEO_BALANCED: &str = "video-balanced";
pub const VIDEO_SMALL: &str = "video-small";

/// H.264 CRF + scale/audio knobs for video presets (ffmpeg libx264 → MP4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoEncodeTarget {
    /// libx264 CRF (lower = higher quality / larger files).
    pub crf: u8,
    /// Max output height in pixels (`-2` width keeps aspect). `None` = no scale.
    pub max_height: Option<u32>,
    /// AAC audio bitrate in kbps.
    pub audio_kbps: u32,
    /// x264 preset name (`veryfast` / `fast` / `medium`).
    pub x264_preset: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub struct VideoPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub target: VideoEncodeTarget,
}

impl VideoPreset {
    pub fn output_ext(&self) -> &'static str {
        "mp4"
    }

    pub fn info(&self) -> PresetInfo {
        PresetInfo {
            id: self.id.into(),
            label: self.label.into(),
            kind: MediaKind::Video,
            description: self.description.into(),
        }
    }
}

/// Built-in video presets — social-small / balanced / high via distinct CRF + scale targets.
const VIDEO_PRESETS: &[VideoPreset] = &[
    VideoPreset {
        id: VIDEO_HIGH,
        label: "High",
        description: "High-quality H.264 MP4 (CRF 18). Quality-first; may not shrink already-small encodes.",
        target: VideoEncodeTarget {
            crf: 18,
            max_height: None,
            audio_kbps: 192,
            x264_preset: "medium",
        },
    },
    VideoPreset {
        id: VIDEO_BALANCED,
        label: "Balanced",
        description: "Balanced H.264 MP4 (CRF 23, ≤1080p). Good quality/size tradeoff for typical clips.",
        target: VideoEncodeTarget {
            crf: 23,
            max_height: Some(1080),
            audio_kbps: 128,
            x264_preset: "fast",
        },
    },
    VideoPreset {
        id: VIDEO_SMALL,
        label: "Social small",
        description: "Social-small H.264 MP4 (CRF 28, ≤720p). Prioritizes file size for sharing.",
        target: VideoEncodeTarget {
            crf: 28,
            max_height: Some(720),
            audio_kbps: 96,
            x264_preset: "veryfast",
        },
    },
];

pub fn video_presets() -> &'static [VideoPreset] {
    VIDEO_PRESETS
}

pub fn video_preset(id: &str) -> Option<&'static VideoPreset> {
    VIDEO_PRESETS.iter().find(|p| p.id == id)
}

/// Stable PDF preset ids (Ghostscript `PDFSETTINGS` print / ebook / screen).
pub const PDF_PRINT: &str = "pdf-print";
pub const PDF_EBOOK: &str = "pdf-ebook";
pub const PDF_SCREEN: &str = "pdf-screen";

/// Ghostscript `-dPDFSETTINGS=` target for PDF image DPI / quality tradeoffs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfSettings {
    /// ~300 dpi — quality-first / print.
    Printer,
    /// ~150 dpi — balanced ebook.
    Ebook,
    /// ~72 dpi — smallest / screen.
    Screen,
}

impl PdfSettings {
    pub fn gs_name(self) -> &'static str {
        match self {
            PdfSettings::Printer => "/printer",
            PdfSettings::Ebook => "/ebook",
            PdfSettings::Screen => "/screen",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PdfPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub settings: PdfSettings,
}

impl PdfPreset {
    pub fn output_ext(&self) -> &'static str {
        "pdf"
    }

    pub fn info(&self) -> PresetInfo {
        PresetInfo {
            id: self.id.into(),
            label: self.label.into(),
            kind: MediaKind::Pdf,
            description: self.description.into(),
        }
    }
}

/// Built-in PDF presets — print / ebook / screen via Ghostscript PDFSETTINGS.
const PDF_PRESETS: &[PdfPreset] = &[
    PdfPreset {
        id: PDF_PRINT,
        label: "Print",
        description: "Print-quality PDF (~300 dpi). Quality-first; may not shrink already-optimized PDFs.",
        settings: PdfSettings::Printer,
    },
    PdfPreset {
        id: PDF_EBOOK,
        label: "Ebook",
        description: "Ebook PDF (~150 dpi). Good quality/size tradeoff for typical image-heavy docs.",
        settings: PdfSettings::Ebook,
    },
    PdfPreset {
        id: PDF_SCREEN,
        label: "Screen",
        description: "Screen PDF (~72 dpi). Prioritizes file size; typical image-heavy PDFs shrink vs print.",
        settings: PdfSettings::Screen,
    },
];

pub fn pdf_presets() -> &'static [PdfPreset] {
    PDF_PRESETS
}

pub fn pdf_preset(id: &str) -> Option<&'static PdfPreset> {
    PDF_PRESETS.iter().find(|p| p.id == id)
}

/// All built-in presets (image + audio + video + pdf).
pub fn all_presets() -> Vec<PresetInfo> {
    let mut out: Vec<_> = image_presets().iter().map(ImagePreset::info).collect();
    out.extend(audio_presets().iter().map(AudioPreset::info));
    out.extend(video_presets().iter().map(VideoPreset::info));
    out.extend(pdf_presets().iter().map(PdfPreset::info));
    out
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
    fn audio_registry_has_three_stable_ids() {
        let ids: Vec<_> = audio_presets().iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![AUDIO_HIGH, AUDIO_BALANCED, AUDIO_SMALL]);
        for p in audio_presets() {
            assert_eq!(p.info().kind, MediaKind::Audio);
            assert!(!p.label.is_empty());
            assert!(!p.description.is_empty());
            assert_eq!(p.output_ext(), "mp3");
        }
        assert_eq!(audio_preset(AUDIO_HIGH).unwrap().bitrate, AudioBitrateKbps::Kbps320);
        assert_eq!(
            audio_preset(AUDIO_BALANCED).unwrap().bitrate,
            AudioBitrateKbps::Kbps192
        );
        assert_eq!(audio_preset(AUDIO_SMALL).unwrap().bitrate, AudioBitrateKbps::Kbps128);
    }

    #[test]
    fn video_registry_has_three_stable_ids() {
        let ids: Vec<_> = video_presets().iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![VIDEO_HIGH, VIDEO_BALANCED, VIDEO_SMALL]);
        for p in video_presets() {
            assert_eq!(p.info().kind, MediaKind::Video);
            assert!(!p.label.is_empty());
            assert!(!p.description.is_empty());
            assert_eq!(p.output_ext(), "mp4");
        }
        assert_eq!(video_preset(VIDEO_HIGH).unwrap().target.crf, 18);
        assert_eq!(video_preset(VIDEO_BALANCED).unwrap().target.crf, 23);
        assert_eq!(video_preset(VIDEO_SMALL).unwrap().target.crf, 28);
        assert_eq!(video_preset(VIDEO_SMALL).unwrap().label, "Social small");
    }

    #[test]
    fn pdf_registry_has_three_stable_ids() {
        let ids: Vec<_> = pdf_presets().iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![PDF_PRINT, PDF_EBOOK, PDF_SCREEN]);
        for p in pdf_presets() {
            assert_eq!(p.info().kind, MediaKind::Pdf);
            assert!(!p.label.is_empty());
            assert!(!p.description.is_empty());
            assert_eq!(p.output_ext(), "pdf");
        }
        assert_eq!(pdf_preset(PDF_PRINT).unwrap().settings, PdfSettings::Printer);
        assert_eq!(pdf_preset(PDF_EBOOK).unwrap().settings, PdfSettings::Ebook);
        assert_eq!(pdf_preset(PDF_SCREEN).unwrap().settings, PdfSettings::Screen);
        assert_eq!(pdf_preset(PDF_PRINT).unwrap().settings.gs_name(), "/printer");
        assert_eq!(pdf_preset(PDF_EBOOK).unwrap().settings.gs_name(), "/ebook");
        assert_eq!(pdf_preset(PDF_SCREEN).unwrap().settings.gs_name(), "/screen");
    }

    #[test]
    fn presets_for_kind_filters_image_audio_video_pdf() {
        assert_eq!(presets_for_kind(&MediaKind::Image).len(), 3);
        assert_eq!(presets_for_kind(&MediaKind::Audio).len(), 3);
        assert_eq!(presets_for_kind(&MediaKind::Video).len(), 3);
        assert_eq!(presets_for_kind(&MediaKind::Pdf).len(), 3);
    }

    #[test]
    fn preset_info_serde_camel_case() {
        let info = image_preset(IMAGE_BALANCED).unwrap().info();
        let json = serde_json::to_string(&info).expect("ser");
        assert!(json.contains("\"id\":\"image-balanced\""));
        assert!(json.contains("\"kind\":\"image\""));
        assert!(json.contains("\"label\":\"Balanced\""));
        assert!(json.contains("\"description\":"));

        let audio = audio_preset(AUDIO_BALANCED).unwrap().info();
        let json = serde_json::to_string(&audio).expect("ser");
        assert!(json.contains("\"id\":\"audio-balanced\""));
        assert!(json.contains("\"kind\":\"audio\""));
        assert!(json.contains("\"label\":\"Balanced\""));

        let video = video_preset(VIDEO_SMALL).unwrap().info();
        let json = serde_json::to_string(&video).expect("ser");
        assert!(json.contains("\"id\":\"video-small\""));
        assert!(json.contains("\"kind\":\"video\""));
        assert!(json.contains("\"label\":\"Social small\""));

        let pdf = pdf_preset(PDF_EBOOK).unwrap().info();
        let json = serde_json::to_string(&pdf).expect("ser");
        assert!(json.contains("\"id\":\"pdf-ebook\""));
        assert!(json.contains("\"kind\":\"pdf\""));
        assert!(json.contains("\"label\":\"Ebook\""));
        assert!(json.contains("\"description\":"));

        let print = pdf_preset(PDF_PRINT).unwrap().info();
        let json = serde_json::to_string(&print).expect("ser");
        assert!(json.contains("\"id\":\"pdf-print\""));
        assert!(json.contains("\"kind\":\"pdf\""));

        let screen = pdf_preset(PDF_SCREEN).unwrap().info();
        let json = serde_json::to_string(&screen).expect("ser");
        assert!(json.contains("\"id\":\"pdf-screen\""));
        assert!(json.contains("\"kind\":\"pdf\""));
        assert!(json.contains("\"label\":\"Screen\""));
    }
}

//! Extension → media kind for watch-folder enqueue (mirrors frontend intake).

use crate::compress::MediaKind;
use std::path::Path;

const IMAGE_EXT: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tif", "tiff", "heic", "heif",
];
const AUDIO_EXT: &[&str] = &[
    "mp3", "aac", "m4a", "wav", "flac", "ogg", "opus", "wma", "aiff", "aif",
];
const VIDEO_EXT: &[&str] = &[
    "mp4", "mov", "mkv", "webm", "avi", "m4v", "mpeg", "mpg", "3gp", "3g2", "ts", "mts",
    "m2ts",
];

fn extension_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
}

/// Supported media kind for a path, or `None` when unsupported / unknown.
pub fn detect_media_kind(path: &Path) -> Option<MediaKind> {
    let ext = extension_lower(path)?;
    if ext == "pdf" {
        return Some(MediaKind::Pdf);
    }
    if IMAGE_EXT.contains(&ext.as_str()) {
        return Some(MediaKind::Image);
    }
    if AUDIO_EXT.contains(&ext.as_str()) {
        return Some(MediaKind::Audio);
    }
    if VIDEO_EXT.contains(&ext.as_str()) {
        return Some(MediaKind::Video);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn detects_supported_kinds_by_extension() {
        assert_eq!(
            detect_media_kind(Path::new("/a/Photo.JPG")),
            Some(MediaKind::Image)
        );
        assert_eq!(
            detect_media_kind(Path::new("/a/track.mp3")),
            Some(MediaKind::Audio)
        );
        assert_eq!(
            detect_media_kind(Path::new("/a/clip.MP4")),
            Some(MediaKind::Video)
        );
        assert_eq!(
            detect_media_kind(Path::new("/a/doc.pdf")),
            Some(MediaKind::Pdf)
        );
        assert_eq!(detect_media_kind(Path::new("/a/notes.txt")), None);
        assert_eq!(detect_media_kind(&PathBuf::from("/a/noext")), None);
    }
}

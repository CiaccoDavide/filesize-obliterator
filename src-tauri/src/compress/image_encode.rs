//! Offline still-image encode (JPEG / PNG / WebP decode; JPEG / WebP encode).
//!
//! HEIC/HEIF is not supported — fail with a clear error (no cloud decode).

use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, ImageEncoder};

use super::presets::{image_preset, ImageEncodeTarget};

fn extension_lower(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn reject_unsupported_container(path: &Path) -> Result<(), String> {
    match extension_lower(path).as_str() {
        "heic" | "heif" | "avif" => Err(format!(
            "unsupported image format '.{}' (offline decoder not bundled)",
            extension_lower(path)
        )),
        _ => Ok(()),
    }
}

/// Compress `source` with a registered image preset into `dest`.
///
/// Corrupt or unsupported inputs return `Err` — never panics.
pub fn encode_image(source: &Path, preset_id: &str, dest: &Path) -> Result<(), String> {
    let preset = image_preset(preset_id)
        .ok_or_else(|| format!("unknown image preset: {preset_id}"))?;
    reject_unsupported_container(source)?;

    let img = image::open(source).map_err(|e| format!("unsupported or corrupt image: {e}"))?;

    match preset.target {
        ImageEncodeTarget::Jpeg { quality } => {
            let rgb = img.to_rgb8();
            let file = File::create(dest).map_err(|e| format!("cannot write output: {e}"))?;
            let mut writer = BufWriter::new(file);
            let encoder = JpegEncoder::new_with_quality(&mut writer, quality);
            encoder
                .write_image(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    ExtendedColorType::Rgb8,
                )
                .map_err(|e| format!("jpeg encode failed: {e}"))?;
        }
        ImageEncodeTarget::Webp { quality } => {
            let rgba = img.to_rgba8();
            let encoder = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height());
            // Prefer fallible encode_simple — Encoder::encode unwraps and can panic the worker.
            let encoded = encoder
                .encode_simple(false, quality)
                .map_err(|e| format!("webp encode failed: {e:?}"))?;
            std::fs::write(dest, &*encoded).map_err(|e| format!("cannot write output: {e}"))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::presets::{IMAGE_BALANCED, IMAGE_HIGH, IMAGE_SMALL};
    use image::{ImageBuffer, Rgba};
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fo-image-encode-{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write_gradient_png(path: &Path, w: u32, h: u32) {
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_fn(w, h, |x, y| {
            Rgba([
                (x % 256) as u8,
                (y % 256) as u8,
                ((x + y) % 256) as u8,
                255,
            ])
        });
        img.save(path).expect("save png");
    }

    /// Soft photo-like RGB (smooth gradients + mild noise) — closer to camera stills than
    /// hard synthetic patterns, so lossy WebP size claims stay meaningful.
    fn write_photo_like_png(path: &Path, w: u32, h: u32) {
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_fn(w, h, |x, y| {
            let fx = x as f32 / w as f32;
            let fy = y as f32 / h as f32;
            let noise = ((x.wrapping_mul(374761393) ^ y.wrapping_mul(668265263)) % 17) as f32;
            let r = ((0.35 + 0.45 * fx) * 255.0 + noise).clamp(0.0, 255.0) as u8;
            let g = ((0.40 + 0.35 * fy) * 255.0 + noise * 0.5).clamp(0.0, 255.0) as u8;
            let b = ((0.55 + 0.25 * (1.0 - fx) * fy) * 255.0).clamp(0.0, 255.0) as u8;
            Rgba([r, g, b, 255])
        });
        img.save(path).expect("save photo-like png");
    }

    #[test]
    fn encodes_png_jpeg_webp_inputs_for_each_preset() {
        let dir = temp_dir("roundtrip");
        let png = dir.join("sample.png");
        write_gradient_png(&png, 64, 64);

        // Derive JPEG + WebP fixtures from the PNG via the same offline encoders.
        let jpeg = dir.join("sample.jpg");
        encode_image(&png, IMAGE_HIGH, &jpeg).expect("png->jpg fixture");
        let webp = dir.join("sample.webp");
        encode_image(&png, IMAGE_BALANCED, &webp).expect("png->webp fixture");

        for (src, preset, ext) in [
            (&png, IMAGE_HIGH, "jpg"),
            (&jpeg, IMAGE_BALANCED, "webp"),
            (&webp, IMAGE_SMALL, "webp"),
        ] {
            let out = dir.join(format!("out-{preset}.{ext}"));
            encode_image(src, preset, &out).unwrap_or_else(|e| panic!("{preset}: {e}"));
            assert!(out.is_file(), "missing {preset}");
            assert!(fs::metadata(&out).unwrap().len() > 0);
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn balanced_and_small_shrink_photo_like_png_and_jpeg() {
        let dir = temp_dir("shrink-photo");
        let png = dir.join("scene.png");
        write_photo_like_png(&png, 480, 320);
        let png_bytes = fs::metadata(&png).unwrap().len();

        let jpeg = dir.join("scene.jpg");
        encode_image(&png, IMAGE_HIGH, &jpeg).expect("photo-like jpeg fixture");
        let jpeg_bytes = fs::metadata(&jpeg).unwrap().len();

        for (src, src_bytes, label) in [(&png, png_bytes, "png"), (&jpeg, jpeg_bytes, "jpeg")] {
            for preset in [IMAGE_BALANCED, IMAGE_SMALL] {
                let out = dir.join(format!("{label}-{preset}.webp"));
                encode_image(src, preset, &out).unwrap_or_else(|e| panic!("{label}/{preset}: {e}"));
                let out_bytes = fs::metadata(&out).unwrap().len();
                assert!(
                    out_bytes <= src_bytes,
                    "{preset} should shrink typical-ish {label}: {out_bytes} > {src_bytes}"
                );
            }
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn small_preset_shrinks_noisy_png() {
        let dir = temp_dir("shrink");
        let png = dir.join("photo.png");
        // Larger noisy image so lossy WebP reliably beats raw PNG.
        write_gradient_png(&png, 320, 240);
        let original = fs::metadata(&png).unwrap().len();

        let out = dir.join("photo.webp");
        encode_image(&png, IMAGE_SMALL, &out).expect("encode");
        let result = fs::metadata(&out).unwrap().len();
        assert!(
            result <= original,
            "small preset should not grow typical photo PNG: {result} > {original}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_image_fails_without_panic() {
        let dir = temp_dir("corrupt");
        let junk = dir.join("broken.jpg");
        fs::write(&junk, b"not-an-image").expect("write");
        let out = dir.join("out.webp");
        let err = encode_image(&junk, IMAGE_BALANCED, &out).expect_err("must fail");
        assert!(
            err.contains("corrupt") || err.contains("unsupported"),
            "unexpected error: {err}"
        );
        assert!(!out.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn heic_fails_clearly() {
        let dir = temp_dir("heic");
        let heic = dir.join("shot.heic");
        fs::write(&heic, b"fake").expect("write");
        let out = dir.join("out.jpg");
        let err = encode_image(&heic, IMAGE_HIGH, &out).expect_err("heic unsupported");
        assert!(err.contains("unsupported"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_preset_fails() {
        let dir = temp_dir("preset");
        let png = dir.join("a.png");
        write_gradient_png(&png, 8, 8);
        let out = dir.join("a.jpg");
        let err = encode_image(&png, "nope", &out).expect_err("unknown");
        assert!(err.contains("unknown image preset"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn smoke_writes_under_compressed_via_prepare_output_path() {
        use crate::compress::output::prepare_output_path;
        use crate::compress::presets::image_preset;

        let dir = temp_dir("smoke-path");
        let png = dir.join("Holiday.PNG");
        write_gradient_png(&png, 48, 48);

        let preset = image_preset(IMAGE_BALANCED).expect("preset");
        let reserved = prepare_output_path(&png, preset.output_ext()).expect("reserve");
        assert_eq!(
            reserved,
            dir.join("_compressed").join("Holiday.webp")
        );

        encode_image(&png, IMAGE_BALANCED, &reserved).expect("encode");
        assert!(reserved.is_file());
        assert!(fs::metadata(&reserved).unwrap().len() > 0);
        // Source untouched.
        assert!(fs::metadata(&png).unwrap().len() > 0);

        let _ = fs::remove_dir_all(&dir);
    }
}

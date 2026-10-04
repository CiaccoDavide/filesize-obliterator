//! Offline still-image encode (JPEG / PNG / WebP decode; JPEG / WebP encode).
//!
//! HEIC/HEIF is not supported — fail with a clear error (no cloud decode).
//!
//! Metadata:
//! - `strip_metadata = true`: bake EXIF orientation into pixels, emit no EXIF/GPS.
//! - `strip_metadata = false`: keep sensor pixels + copy EXIF (incl. orientation/GPS) on JPEG;
//!   WebP bakes orientation into pixels (container EXIF not written by the WebP path).

use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::metadata::Orientation;
use image::{DynamicImage, ExtendedColorType, ImageDecoder, ImageEncoder, ImageReader};

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

fn open_image(source: &Path) -> Result<(DynamicImage, Orientation, Option<Vec<u8>>), String> {
    let reader = ImageReader::open(source)
        .map_err(|e| format!("unsupported or corrupt image: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("unsupported or corrupt image: {e}"))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("unsupported or corrupt image: {e}"))?;
    let orientation = decoder
        .orientation()
        .unwrap_or(Orientation::NoTransforms);
    let exif = decoder.exif_metadata().ok().flatten();
    let img = DynamicImage::from_decoder(decoder)
        .map_err(|e| format!("unsupported or corrupt image: {e}"))?;
    Ok((img, orientation, exif))
}

fn encode_jpeg(
    img: &DynamicImage,
    quality: u8,
    dest: &Path,
    exif: Option<&[u8]>,
) -> Result<(), String> {
    let rgb = img.to_rgb8();
    let file = File::create(dest).map_err(|e| format!("cannot write output: {e}"))?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, quality);
    if let Some(chunk) = exif {
        encoder
            .set_exif_metadata(chunk.to_vec())
            .map_err(|e| format!("jpeg exif write failed: {e}"))?;
    }
    encoder
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("jpeg encode failed: {e}"))?;
    Ok(())
}

fn encode_webp(img: &DynamicImage, quality: f32, dest: &Path) -> Result<(), String> {
    let rgba = img.to_rgba8();
    let encoder = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height());
    // Prefer fallible encode_simple — Encoder::encode unwraps and can panic the worker.
    let encoded = encoder
        .encode_simple(false, quality)
        .map_err(|e| format!("webp encode failed: {e:?}"))?;
    std::fs::write(dest, &*encoded).map_err(|e| format!("cannot write output: {e}"))?;
    Ok(())
}

/// Compress `source` with a registered image preset into `dest`.
///
/// Corrupt or unsupported inputs return `Err` — never panics.
pub fn encode_image(
    source: &Path,
    preset_id: &str,
    dest: &Path,
    strip_metadata: bool,
) -> Result<(), String> {
    let preset = image_preset(preset_id)
        .ok_or_else(|| format!("unknown image preset: {preset_id}"))?;
    reject_unsupported_container(source)?;

    let (mut img, orientation, exif) = open_image(source)?;

    match preset.target {
        ImageEncodeTarget::Jpeg { quality } => {
            if strip_metadata {
                img.apply_orientation(orientation);
                encode_jpeg(&img, quality, dest, None)?;
            } else {
                encode_jpeg(&img, quality, dest, exif.as_deref())?;
            }
        }
        ImageEncodeTarget::Webp { quality } => {
            // WebP path cannot round-trip EXIF via the bundled encoder; always bake orientation.
            img.apply_orientation(orientation);
            encode_webp(&img, quality, dest)?;
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

    /// Minimal big-endian TIFF/EXIF payload: Orientation=6 + GPS IFD with LatitudeRef=N.
    /// Payload is what `JpegEncoder::set_exif_metadata` expects (no `Exif\0\0` prefix).
    fn exif_orientation6_with_gps() -> Vec<u8> {
        // Layout (MM / big-endian):
        // 0:  MM 00 2A | IFD0 @ 8
        // 8:  count=2 | Orientation | GPSInfo | next=0
        // 32: GPS IFD count=1 | GPSLatitudeRef="N\0" inline | next=0
        let mut buf = Vec::new();
        buf.extend_from_slice(&[0x4D, 0x4D, 0x00, 0x2A]); // MM, 42
        buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x08]); // IFD0 offset
        buf.extend_from_slice(&[0x00, 0x02]); // 2 entries
                                              // Orientation tag 0x0112, SHORT, count 1, value 6
        buf.extend_from_slice(&[0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00]);
        // GPSInfo tag 0x8825, LONG, count 1, value = offset 32
        buf.extend_from_slice(&[0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x20]);
        buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // next IFD
                                                         // GPS IFD @ 32
        buf.extend_from_slice(&[0x00, 0x01]); // 1 entry
                                             // GPSLatitudeRef 0x0001, ASCII, count 2, "N\0" inline in value
        buf.extend_from_slice(&[0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, b'N', 0x00, 0x00, 0x00]);
        buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // next
        buf
    }

    fn write_jpeg_fixture_with_gps(path: &Path, w: u32, h: u32) {
        let img: ImageBuffer<image::Rgb<u8>, Vec<u8>> = ImageBuffer::from_fn(w, h, |x, y| {
            // Distinct corner so orientation tests can spot bake-in.
            if x == 0 && y == 0 {
                image::Rgb([255, 0, 0])
            } else {
                image::Rgb([
                    (x % 256) as u8,
                    (y % 256) as u8,
                    ((x + y) % 256) as u8,
                ])
            }
        });
        let file = File::create(path).expect("create jpeg");
        let mut writer = BufWriter::new(file);
        let mut encoder = JpegEncoder::new_with_quality(&mut writer, 90);
        encoder
            .set_exif_metadata(exif_orientation6_with_gps())
            .expect("set exif");
        encoder
            .write_image(
                img.as_raw(),
                w,
                h,
                ExtendedColorType::Rgb8,
            )
            .expect("encode jpeg fixture");
    }

    fn jpeg_has_gps_exif(path: &Path) -> bool {
        let bytes = fs::read(path).expect("read");
        // APP1 Exif marker sequence + GPSInfo tag 0x8825 in TIFF payload.
        bytes.windows(6).any(|w| w == b"Exif\0\0")
            && bytes.windows(2).any(|w| w == [0x88, 0x25])
    }

    fn read_orientation(path: &Path) -> Orientation {
        let reader = ImageReader::open(path)
            .expect("open")
            .with_guessed_format()
            .expect("guess");
        let mut decoder = reader.into_decoder().expect("decoder");
        decoder.orientation().unwrap_or(Orientation::NoTransforms)
    }

    fn read_dims(path: &Path) -> (u32, u32) {
        let img = image::open(path).expect("open");
        (img.width(), img.height())
    }

    #[test]
    fn encodes_png_jpeg_webp_inputs_for_each_preset() {
        let dir = temp_dir("roundtrip");
        let png = dir.join("sample.png");
        write_gradient_png(&png, 64, 64);

        // Derive JPEG + WebP fixtures from the PNG via the same offline encoders.
        let jpeg = dir.join("sample.jpg");
        encode_image(&png, IMAGE_HIGH, &jpeg, true).expect("png->jpg fixture");
        let webp = dir.join("sample.webp");
        encode_image(&png, IMAGE_BALANCED, &webp, true).expect("png->webp fixture");

        for (src, preset, ext) in [
            (&png, IMAGE_HIGH, "jpg"),
            (&jpeg, IMAGE_BALANCED, "webp"),
            (&webp, IMAGE_SMALL, "webp"),
        ] {
            let out = dir.join(format!("out-{preset}.{ext}"));
            encode_image(src, preset, &out, true).unwrap_or_else(|e| panic!("{preset}: {e}"));
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
        encode_image(&png, IMAGE_HIGH, &jpeg, true).expect("photo-like jpeg fixture");
        let jpeg_bytes = fs::metadata(&jpeg).unwrap().len();

        for (src, src_bytes, label) in [(&png, png_bytes, "png"), (&jpeg, jpeg_bytes, "jpeg")] {
            for preset in [IMAGE_BALANCED, IMAGE_SMALL] {
                let out = dir.join(format!("{label}-{preset}.webp"));
                encode_image(src, preset, &out, true)
                    .unwrap_or_else(|e| panic!("{label}/{preset}: {e}"));
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
        encode_image(&png, IMAGE_SMALL, &out, true).expect("encode");
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
        let err = encode_image(&junk, IMAGE_BALANCED, &out, true).expect_err("must fail");
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
        let err = encode_image(&heic, IMAGE_HIGH, &out, true).expect_err("heic unsupported");
        assert!(err.contains("unsupported"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_preset_fails() {
        let dir = temp_dir("preset");
        let png = dir.join("a.png");
        write_gradient_png(&png, 8, 8);
        let out = dir.join("a.jpg");
        let err = encode_image(&png, "nope", &out, true).expect_err("unknown");
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

        encode_image(&png, IMAGE_BALANCED, &reserved, true).expect("encode");
        assert!(reserved.is_file());
        assert!(fs::metadata(&reserved).unwrap().len() > 0);
        // Source untouched.
        assert!(fs::metadata(&png).unwrap().len() > 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn strip_on_removes_gps_exif_from_jpeg_fixture() {
        let dir = temp_dir("strip-gps");
        let src = dir.join("geo.jpg");
        // Tall 2×4 so Orientation=6 (90° CW) becomes 4×2 after bake-in.
        write_jpeg_fixture_with_gps(&src, 2, 4);
        assert!(jpeg_has_gps_exif(&src), "fixture must contain GPS EXIF");
        assert_eq!(read_orientation(&src), Orientation::Rotate90);

        let out = dir.join("out.jpg");
        encode_image(&src, IMAGE_HIGH, &out, true).expect("strip on");
        assert!(!jpeg_has_gps_exif(&out), "strip-on must remove GPS/EXIF");
        assert_eq!(
            read_orientation(&out),
            Orientation::NoTransforms,
            "strip-on clears orientation tag"
        );
        // Orientation baked into pixels: 2×4 + Rotate90 → 4×2.
        assert_eq!(read_dims(&out), (4, 2));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn strip_off_preserves_jpeg_orientation_tag() {
        let dir = temp_dir("keep-orient");
        let src = dir.join("phone.jpg");
        write_jpeg_fixture_with_gps(&src, 2, 4);
        assert_eq!(read_orientation(&src), Orientation::Rotate90);

        let out = dir.join("out.jpg");
        encode_image(&src, IMAGE_HIGH, &out, false).expect("strip off");
        assert_eq!(
            read_orientation(&out),
            Orientation::Rotate90,
            "strip-off must preserve Orientation EXIF"
        );
        // Sensor pixel dims unchanged (tag carries orientation).
        assert_eq!(read_dims(&out), (2, 4));
        // GPS preserved when strip is off (tags kept).
        assert!(jpeg_has_gps_exif(&out), "strip-off keeps EXIF/GPS when present");

        // Applying the preserved orientation yields the same visual size as strip-on bake-in.
        let mut decoder = ImageReader::open(&out)
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .into_decoder()
            .unwrap();
        let orientation = decoder.orientation().unwrap();
        let mut img = DynamicImage::from_decoder(decoder).unwrap();
        img.apply_orientation(orientation);
        assert_eq!((img.width(), img.height()), (4, 2));

        let _ = fs::remove_dir_all(&dir);
    }
}

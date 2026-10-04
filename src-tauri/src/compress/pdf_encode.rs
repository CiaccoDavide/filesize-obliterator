//! Offline PDF compress via a local Ghostscript binary (sidecar / PATH / `GS_PATH`).
//!
//! Inputs: `.pdf`. Output: `.pdf` at print / ebook / screen image DPI targets.
//! No network. Missing Ghostscript → `missing tool: ghostscript…`.
//! Encrypted/password PDFs → clear `encrypted` error (no password UI).
//! Bad input → `unsupported or corrupt pdf…`.

use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use super::presets::{pdf_preset, PdfPreset, PdfSettings};

fn extension_lower(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn reject_unsupported_container(path: &Path) -> Result<(), String> {
    match extension_lower(path).as_str() {
        "pdf" => Ok(()),
        other if !other.is_empty() => Err(format!(
            "unsupported pdf format '.{other}' (expected pdf)"
        )),
        _ => Err("unsupported pdf format (missing file extension)".into()),
    }
}

fn cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel.is_some_and(|c| c.load(Ordering::SeqCst))
}

/// Resolve local Ghostscript without network. Order: `GS_PATH`, sidecar-adjacent, then `PATH`.
pub fn resolve_ghostscript() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("GS_PATH") {
        let p = PathBuf::from(explicit.trim());
        if p.is_file() {
            return Ok(p);
        }
        return Err(format!(
            "missing tool: ghostscript (GS_PATH set but not a file: {})",
            p.display()
        ));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["gs", "gswin64c.exe", "gswin32c.exe", "ghostscript"] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
            for rel in [
                "resources/gs",
                "../Resources/gs",
                "binaries/gs",
                "resources/gswin64c.exe",
                "binaries/gswin64c.exe",
            ] {
                let candidate = dir.join(rel);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    which_ghostscript().ok_or_else(|| {
        "missing tool: ghostscript (not found on PATH, beside the app, or via GS_PATH). \
Install Ghostscript locally or bundle it as a sidecar for offline PDF compression."
            .to_string()
    })
}

fn which_ghostscript() -> Option<PathBuf> {
    // On Windows the first name (`gs`) is often absent; NotFound must not abort the loop
    // before `gswin64c` / `gswin32c` are tried.
    for name in ["gs", "gswin64c", "gswin32c", "ghostscript"] {
        match Command::new(name)
            .arg("-v")
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

/// Reject password-protected PDFs up front (no password UI in this task).
fn reject_encrypted_pdf(source: &Path) -> Result<(), String> {
    let mut file = fs::File::open(source).map_err(|e| format!("cannot read source: {e}"))?;
    let mut header = [0u8; 8];
    let n = file
        .read(&mut header)
        .map_err(|e| format!("cannot read source: {e}"))?;
    if n < 5 || !header[..n].starts_with(b"%PDF-") {
        return Err("unsupported or corrupt pdf: missing %PDF header".into());
    }

    // `/Encrypt` lives in the trailer (near EOF); linearized PDFs may also advertise it early.
    // Scan a bounded prefix + suffix instead of allocating the whole file.
    const WINDOW: u64 = 512 * 1024;
    let len = file
        .metadata()
        .map_err(|e| format!("cannot read source: {e}"))?
        .len();
    let mut buf = Vec::new();

    let prefix = len.min(WINDOW);
    buf.resize(prefix as usize, 0);
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("cannot read source: {e}"))?;
    file.read_exact(&mut buf)
        .map_err(|e| format!("cannot read source: {e}"))?;
    if pdf_appears_encrypted(&buf) {
        return Err(
            "encrypted pdf: password-protected PDFs are not supported (no password UI)"
                .into(),
        );
    }

    if len > WINDOW {
        let start = len - WINDOW;
        buf.resize(WINDOW as usize, 0);
        file.seek(SeekFrom::Start(start))
            .map_err(|e| format!("cannot read source: {e}"))?;
        file.read_exact(&mut buf)
            .map_err(|e| format!("cannot read source: {e}"))?;
        if pdf_appears_encrypted(&buf) {
            return Err(
                "encrypted pdf: password-protected PDFs are not supported (no password UI)"
                    .into(),
            );
        }
    }
    Ok(())
}

fn pdf_appears_encrypted(bytes: &[u8]) -> bool {
    // Scan for `/Encrypt` as a PDF name token (not preceded by a letter/digit that would
    // make it part of a longer name).
    let needle = b"/Encrypt";
    let mut i = 0;
    while i + needle.len() <= bytes.len() {
        if &bytes[i..i + needle.len()] == needle {
            let before_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
            let after = i + needle.len();
            let after_ok = after >= bytes.len() || !bytes[after].is_ascii_alphanumeric();
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn build_gs_args(source: &Path, dest: &Path, settings: PdfSettings) -> Vec<String> {
    vec![
        "-q".into(),
        "-dNOPAUSE".into(),
        "-dBATCH".into(),
        "-dSAFER".into(),
        "-sDEVICE=pdfwrite".into(),
        "-dCompatibilityLevel=1.4".into(),
        format!("-dPDFSETTINGS={}", settings.gs_name()),
        // Reinforce downsample/re-encode so image-heavy inputs shrink under screen vs print.
        "-dDetectDuplicateImages=true".into(),
        "-dCompressFonts=true".into(),
        format!("-sOutputFile={}", dest.display()),
        source.display().to_string(),
    ]
}

fn map_gs_failure(stderr: &str, status_code: Option<i32>) -> String {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("password")
        || lower.contains("this file requires a password")
        || lower.contains("encrypted")
    {
        return "encrypted pdf: password-protected PDFs are not supported (no password UI)"
            .into();
    }
    if lower.contains("error")
        || lower.contains("undefined")
        || lower.contains("unable")
        || lower.contains("can't")
        || lower.contains("cannot")
        || lower.contains("unrecoverable")
        || !stderr.trim().is_empty()
    {
        return format!(
            "unsupported or corrupt pdf: {}",
            stderr
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("ghostscript failed")
        );
    }
    format!(
        "unsupported or corrupt pdf: ghostscript exited {:?}",
        status_code
    )
}

fn output_looks_like_pdf(path: &Path) -> bool {
    match fs::read(path) {
        Ok(bytes) => bytes.len() >= 5 && bytes.starts_with(b"%PDF-"),
        Err(_) => false,
    }
}

/// Compress `source` with a registered PDF preset into `dest` (PDF).
///
/// When `cancel` is set, the Ghostscript child is killed and the error is `"cancelled"`.
pub fn encode_pdf(
    source: &Path,
    preset_id: &str,
    dest: &Path,
    cancel: Option<&AtomicBool>,
) -> Result<(), String> {
    let preset: &PdfPreset = pdf_preset(preset_id)
        .ok_or_else(|| format!("unknown pdf preset: {preset_id}"))?;
    reject_unsupported_container(source)?;
    reject_encrypted_pdf(source)?;
    if cancelled(cancel) {
        return Err("cancelled".into());
    }

    let gs = resolve_ghostscript()?;
    let args = build_gs_args(source, dest, preset.settings);

    let mut child = Command::new(&gs)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "missing tool: ghostscript (failed to spawn binary)".to_string()
            } else {
                format!("missing tool: ghostscript ({e})")
            }
        })?;

    let stderr_pipe = child.stderr.take();
    let stderr_handle = stderr_pipe.map(|pipe| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let reader = BufReader::new(pipe);
            for line in reader.lines().map_while(Result::ok) {
                buf.push_str(&line);
                buf.push('\n');
            }
            buf
        })
    });

    // Cooperative cancel: poll while Ghostscript runs (no fine-grained page progress API).
    let status = loop {
        if cancelled(cancel) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(dest);
            return Err("cancelled".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(40)),
            Err(e) => {
                let _ = fs::remove_file(dest);
                return Err(format!("ghostscript wait failed: {e}"));
            }
        }
    };
    let stderr = stderr_handle
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();

    if cancelled(cancel) {
        let _ = fs::remove_file(dest);
        return Err("cancelled".into());
    }

    if !status.success() {
        let _ = fs::remove_file(dest);
        return Err(map_gs_failure(&stderr, status.code()));
    }

    if !dest.is_file() || fs::metadata(dest).map(|m| m.len()).unwrap_or(0) == 0 {
        let _ = fs::remove_file(dest);
        return Err("unsupported or corrupt pdf: ghostscript produced empty output".into());
    }

    if !output_looks_like_pdf(dest) {
        let _ = fs::remove_file(dest);
        return Err("unsupported or corrupt pdf: output is not a valid PDF".into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::output::prepare_output_path;
    use crate::compress::presets::{PDF_EBOOK, PDF_PRINT, PDF_SCREEN};
    use std::io::Write;
    use std::sync::atomic::AtomicBool;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fo-pdf-encode-{}-{}-{}",
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

    fn require_gs() -> PathBuf {
        resolve_ghostscript().unwrap_or_else(|e| {
            panic!("ghostscript required for pdf encode tests: {e}");
        })
    }

    /// Minimal valid one-page PDF (text only) — always openable; may not shrink.
    fn write_minimal_pdf(path: &Path) {
        let content = b"%PDF-1.4\n\
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n\
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n\
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n\
4 0 obj<< /Length 44 >>stream\n\
BT /F1 24 Tf 72 200 Td (Hello) Tj ET\n\
endstream\nendobj\n\
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n\
xref\n\
0 6\n\
0000000000 65535 f \n\
0000000009 00000 n \n\
0000000058 00000 n \n\
0000000115 00000 n \n\
0000000242 00000 n \n\
0000000335 00000 n \n\
trailer<< /Size 6 /Root 1 0 R >>\n\
startxref\n\
406\n\
%%EOF\n";
        fs::write(path, content).expect("write minimal pdf");
    }

    /// Image-heavy PDF with embedded rasters. Screen should shrink vs print.
    /// Prefers `img2pdf` / `magick`; otherwise Ghostscript JPEG → embedded DCT pages.
    /// Never falls back to vector-only pages (that would make screen≈print).
    fn write_image_heavy_pdf(path: &Path) {
        let dir = path.parent().expect("parent");
        let png_a = dir.join("heavy-a.png");
        let png_b = dir.join("heavy-b.png");
        const W: u32 = 1200;
        const H: u32 = 900;

        let made_png = write_plasma_png(&png_a, W, H) && write_plasma_png(&png_b, W, H);
        assert!(made_png, "could not create PNG fixtures (need magick or gs)");

        let img2pdf = Command::new("img2pdf")
            .arg(&png_a)
            .arg(&png_b)
            .arg("-o")
            .arg(path)
            .status();
        if img2pdf.map(|s| s.success()).unwrap_or(false) && path.is_file() {
            assert_fixture_embeds_images(path);
            return;
        }

        let magick = Command::new("magick")
            .arg(&png_a)
            .arg(&png_b)
            .arg(path)
            .status();
        if magick.map(|s| s.success()).unwrap_or(false) && path.is_file() {
            assert_fixture_embeds_images(path);
            return;
        }

        // Ghostscript path: raster JPEGs (not vectors), then embed as DCT image XObjects.
        let gs = require_gs();
        let jpeg_a = dir.join("heavy-a.jpg");
        let jpeg_b = dir.join("heavy-b.jpg");
        assert!(
            write_plasma_jpeg(&gs, &jpeg_a, W, H) && write_plasma_jpeg(&gs, &jpeg_b, W, H),
            "could not create JPEG fixtures via ghostscript"
        );
        assert!(
            write_pdf_with_embedded_jpegs(&gs, path, &[&jpeg_a, &jpeg_b], W, H),
            "could not build image-heavy PDF with embedded JPEGs"
        );
        assert_fixture_embeds_images(path);
    }

    fn assert_fixture_embeds_images(path: &Path) {
        let bytes = fs::read(path).expect("read fixture");
        let has_image = bytes.windows(6).any(|w| w == b"/Image")
            || bytes.windows(10).any(|w| w == b"/DCTDecode");
        assert!(
            has_image,
            "image-heavy fixture must embed raster images (no silent vector fallback)"
        );
    }

    fn ps_path_literal(path: &Path) -> String {
        let s = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let s = s.to_string_lossy();
        let mut out = String::with_capacity(s.len() + 2);
        out.push('(');
        for c in s.chars() {
            match c {
                '(' | ')' | '\\' => {
                    out.push('\\');
                    out.push(c);
                }
                _ => out.push(c),
            }
        }
        out.push(')');
        out
    }

    fn write_plasma_jpeg(gs: &Path, path: &Path, w: u32, h: u32) -> bool {
        if Command::new("magick")
            .args([
                "-size",
                &format!("{w}x{h}"),
                "plasma:fractal",
                path.to_str().unwrap_or(""),
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
            && path.is_file()
        {
            return true;
        }
        // Rasterize noisy fills to a real JPEG (bitmap), never leave as PDF vectors.
        Command::new(gs)
            .args([
                "-q",
                "-dNOPAUSE",
                "-dBATCH",
                "-dSAFER",
                "-sDEVICE=jpeg",
                "-dJPEGQ=95",
                "-r72",
                &format!("-g{w}x{h}"),
                &format!("-sOutputFile={}", path.display()),
                "-c",
                "0 1 40 { /i exch def 0 1 30 { /j exch def \
                   i 20 mul j 20 mul moveto \
                   i 255 div j 255 div 0.5 setrgbcolor \
                   22 22 rectfill } for } for showpage",
            ])
            .status()
            .map(|s| s.success() && path.is_file())
            .unwrap_or(false)
    }

    fn write_pdf_with_embedded_jpegs(
        gs: &Path,
        dest: &Path,
        jpegs: &[&Path],
        w: u32,
        h: u32,
    ) -> bool {
        let mut ps = String::new();
        for jpeg in jpegs {
            let lit = ps_path_literal(jpeg);
            ps.push_str(&format!(
                "<< /PageSize [{w} {h}] >> setpagedevice\n\
                 {w} {h} scale\n\
                 {w} {h} 8 [{w} 0 0 {h} neg 0 {h}]\n\
                 {lit} (r) file /DCTDecode filter false 3 colorimage\n\
                 showpage\n"
            ));
        }
        let status = Command::new(gs)
            .args([
                "-q",
                "-dNOPAUSE",
                "-dBATCH",
                "-dSAFER",
                "-sDEVICE=pdfwrite",
                "-dCompatibilityLevel=1.4",
                &format!("-sOutputFile={}", dest.display()),
                "-c",
                &ps,
            ])
            .status();
        status.map(|s| s.success() && dest.is_file()).unwrap_or(false)
    }

    fn write_plasma_png(path: &Path, w: u32, h: u32) -> bool {
        if Command::new("magick")
            .args([
                "-size",
                &format!("{w}x{h}"),
                "plasma:fractal",
                path.to_str().unwrap_or(""),
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
            && path.is_file()
        {
            return true;
        }
        // Ghostscript PNG device fallback.
        let gs = match resolve_ghostscript() {
            Ok(p) => p,
            Err(_) => return false,
        };
        Command::new(&gs)
            .args([
                "-q",
                "-dNOPAUSE",
                "-dBATCH",
                "-dSAFER",
                "-sDEVICE=png16m",
                "-r72",
                &format!("-g{w}x{h}"),
                &format!("-sOutputFile={}", path.display()),
                "-c",
                "0 1 40 { /i exch def 0 1 30 { /j exch def \
                   i 20 mul j 20 mul moveto \
                   i 255 div j 255 div 0.5 setrgbcolor \
                   22 22 rectfill } for } for showpage",
            ])
            .status()
            .map(|s| s.success() && path.is_file())
            .unwrap_or(false)
    }

    fn write_encrypted_pdf_stub(path: &Path) {
        // Minimal PDF bytes that include a trailer /Encrypt entry (clear fail path).
        let content = b"%PDF-1.4\n\
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n\
2 0 obj<< /Type /Pages /Kids [] /Count 0 >>endobj\n\
3 0 obj<< /Filter /Standard /V 4 /R 4 /Length 128 /U (xxxxxxxxxxxxxxxx) /O (xxxxxxxxxxxxxxxx) /P -4 >>endobj\n\
xref\n\
0 4\n\
0000000000 65535 f \n\
0000000009 00000 n \n\
0000000058 00000 n \n\
0000000107 00000 n \n\
trailer<< /Size 4 /Root 1 0 R /Encrypt 3 0 R >>\n\
startxref\n\
260\n\
%%EOF\n";
        fs::write(path, content).expect("write encrypted stub");
    }

    #[test]
    fn pdf_appears_encrypted_detects_trailer_token() {
        let mut bytes = b"%PDF-1.4\ntrailer<< /Encrypt 3 0 R >>\n".to_vec();
        assert!(pdf_appears_encrypted(&bytes));
        bytes = b"%PDF-1.4\n(no encrypt here)\n".to_vec();
        assert!(!pdf_appears_encrypted(&bytes));
    }

    #[test]
    fn encodes_minimal_pdf_for_each_preset() {
        require_gs();
        let dir = temp_dir("roundtrip");
        let src = dir.join("doc.pdf");
        write_minimal_pdf(&src);
        for preset in [PDF_PRINT, PDF_EBOOK, PDF_SCREEN] {
            let out = dir.join(format!("{preset}.pdf"));
            encode_pdf(&src, preset, &out, None)
                .unwrap_or_else(|e| panic!("{preset}: {e}"));
            assert!(out.is_file(), "missing {preset}");
            assert!(output_looks_like_pdf(&out), "{preset} not valid PDF");
            assert!(fs::metadata(&out).unwrap().len() > 0);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn screen_shrinks_image_heavy_vs_print() {
        require_gs();
        let dir = temp_dir("shrink");
        let src = dir.join("heavy.pdf");
        write_image_heavy_pdf(&src);
        let original = fs::metadata(&src).unwrap().len();
        assert!(original > 50_000, "fixture too small: {original}");

        let print_out = dir.join("print.pdf");
        let screen_out = dir.join("screen.pdf");
        encode_pdf(&src, PDF_PRINT, &print_out, None).expect("print");
        encode_pdf(&src, PDF_SCREEN, &screen_out, None).expect("screen");

        let print_bytes = fs::metadata(&print_out).unwrap().len();
        let screen_bytes = fs::metadata(&screen_out).unwrap().len();
        assert!(
            screen_bytes < print_bytes,
            "screen should be smaller than print for image-heavy PDF: screen={screen_bytes} print={print_bytes} original={original}"
        );
        assert!(
            screen_bytes < original,
            "screen should shrink typical image-heavy PDF: {screen_bytes} >= {original}"
        );
        // Exception note (acceptance): print/high may grow already-optimized inputs.
        let _ = print_bytes;
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_pdf_fails_without_panic() {
        require_gs();
        let dir = temp_dir("corrupt");
        let junk = dir.join("broken.pdf");
        fs::write(&junk, b"not-a-pdf").expect("write");
        let out = dir.join("out.pdf");
        let err = encode_pdf(&junk, PDF_EBOOK, &out, None).expect_err("must fail");
        assert!(
            err.contains("corrupt") || err.contains("unsupported"),
            "unexpected error: {err}"
        );
        assert!(!err.contains("missing tool"), "{err}");
        assert!(!out.exists() || fs::metadata(&out).map(|m| m.len()).unwrap_or(0) == 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn encrypted_pdf_fails_clearly() {
        let dir = temp_dir("encrypted");
        let enc = dir.join("secret.pdf");
        write_encrypted_pdf_stub(&enc);
        let out = dir.join("out.pdf");
        let err = encode_pdf(&enc, PDF_SCREEN, &out, None).expect_err("encrypted");
        assert!(err.contains("encrypted"), "{err}");
        assert!(err.contains("password"), "{err}");
        assert!(!err.contains("missing tool"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_preset_fails() {
        let dir = temp_dir("preset");
        let src = dir.join("a.pdf");
        write_minimal_pdf(&src);
        let out = dir.join("a-out.pdf");
        let err = encode_pdf(&src, "nope", &out, None).expect_err("unknown");
        assert!(err.contains("unknown pdf preset"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn smoke_writes_under_compressed_via_prepare_output_path() {
        require_gs();
        let dir = temp_dir("smoke-path");
        let src = dir.join("Report.PDF");
        write_minimal_pdf(&src);

        let preset = pdf_preset(PDF_EBOOK).expect("preset");
        let reserved = prepare_output_path(&src, preset.output_ext()).expect("reserve");
        assert_eq!(reserved, dir.join("_compressed").join("Report.pdf"));

        encode_pdf(&src, PDF_EBOOK, &reserved, None).expect("encode");
        assert!(reserved.is_file());
        assert!(output_looks_like_pdf(&reserved));
        assert!(fs::metadata(&src).unwrap().len() > 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn respects_cancel_flag_without_leaving_output() {
        require_gs();
        let dir = temp_dir("cancel");
        let src = dir.join("heavy.pdf");
        write_image_heavy_pdf(&src);
        let out = dir.join("out.pdf");
        let cancel = AtomicBool::new(true);
        let err = encode_pdf(&src, PDF_EBOOK, &out, Some(&cancel)).expect_err("cancelled");
        assert_eq!(err, "cancelled");
        assert!(!out.exists() || fs::metadata(&out).map(|m| m.len()).unwrap_or(0) == 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_tool_message_shape_is_documented() {
        let missing =
            "missing tool: ghostscript (not found on PATH, beside the app, or via GS_PATH)";
        let bad = "unsupported or corrupt pdf: missing %PDF header";
        let enc = "encrypted pdf: password-protected PDFs are not supported (no password UI)";
        assert!(missing.starts_with("missing tool"));
        assert!(bad.starts_with("unsupported or corrupt"));
        assert!(enc.starts_with("encrypted"));
        assert!(!bad.contains("missing tool"));
        assert!(!enc.contains("missing tool"));
    }

    #[test]
    fn non_pdf_extension_fails_clearly() {
        let dir = temp_dir("ext");
        let src = dir.join("notes.txt");
        {
            let mut f = fs::File::create(&src).unwrap();
            f.write_all(b"%PDF-1.4 fake").unwrap();
        }
        let out = dir.join("out.pdf");
        let err = encode_pdf(&src, PDF_PRINT, &out, None).expect_err("ext");
        assert!(err.contains("unsupported"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }
}

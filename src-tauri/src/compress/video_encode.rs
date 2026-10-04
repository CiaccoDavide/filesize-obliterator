//! Offline video compress via a local ffmpeg binary (sidecar / PATH / `FFMPEG_PATH`).
//!
//! Inputs: MP4, WebM, MKV, MOV/M4V, plus 3GP/MPEG-TS where local ffmpeg demuxes.
//! Output: `.mp4` (H.264 + AAC).
//! No network. Missing ffmpeg → `missing tool: ffmpeg…`. Bad input → `unsupported or corrupt video…`.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use super::presets::{video_preset, VideoEncodeTarget, VideoPreset};

/// Containers this build documents as supported for offline video compress.
pub const SUPPORTED_VIDEO_CONTAINERS: &[&str] = &[
    "mp4", "webm", "mkv", "mov", "m4v", "3gp", "3g2", "ts", "mts", "m2ts",
];

fn extension_lower(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn reject_unsupported_container(path: &Path) -> Result<(), String> {
    let ext = extension_lower(path);
    if SUPPORTED_VIDEO_CONTAINERS.iter().any(|c| *c == ext) {
        return Ok(());
    }
    match ext.as_str() {
        "avi" | "mpeg" | "mpg" | "wmv" | "flv" => Err(format!(
            "unsupported video format '.{ext}' (offline demuxer not enabled for this container)"
        )),
        other if !other.is_empty() => Err(format!(
            "unsupported video format '.{other}' (expected {})",
            SUPPORTED_VIDEO_CONTAINERS.join(", ")
        )),
        _ => Err("unsupported video format (missing file extension)".into()),
    }
}

fn cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel.is_some_and(|c| c.load(Ordering::SeqCst))
}

/// Resolve local ffmpeg without network. Order: `FFMPEG_PATH`, sidecar-adjacent, then `PATH`.
pub fn resolve_ffmpeg() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("FFMPEG_PATH") {
        let p = PathBuf::from(explicit.trim());
        if p.is_file() {
            return Ok(p);
        }
        return Err(format!(
            "missing tool: ffmpeg (FFMPEG_PATH set but not a file: {})",
            p.display()
        ));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["ffmpeg", "ffmpeg.exe"] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
            // Tauri externalBin layout: resources/ or MacOS sibling Resources
            for rel in ["resources/ffmpeg", "../Resources/ffmpeg", "binaries/ffmpeg"] {
                let candidate = dir.join(rel);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    which_ffmpeg().ok_or_else(|| {
        "missing tool: ffmpeg (not found on PATH, beside the app, or via FFMPEG_PATH). \
Install ffmpeg locally or bundle it as a sidecar for offline video compression."
            .to_string()
    })
}

fn which_ffmpeg() -> Option<PathBuf> {
    // Prefer a real spawn check over shell `which` so Windows/macOS/Linux share one path.
    let status = Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;
    status.success().then(|| PathBuf::from("ffmpeg"))
}

fn probe_duration_secs(ffmpeg: &Path, source: &Path) -> Option<f64> {
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(source)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_duration_from_ffmpeg_stderr(&stderr)
}

fn parse_duration_from_ffmpeg_stderr(stderr: &str) -> Option<f64> {
    // Duration: 00:00:03.04, start: 0.000000, bitrate: ...
    for line in stderr.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("Duration:") else {
            continue;
        };
        let token = rest.split(',').next()?.trim();
        return parse_hhmmss(token);
    }
    None
}

fn parse_hhmmss(token: &str) -> Option<f64> {
    let mut parts = token.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

fn parse_out_time_secs(line: &str) -> Option<f64> {
    // ffmpeg -progress: out_time_ms is microseconds despite the name (same unit as out_time_us).
    // Also: out_time_us=<µs> and out_time=HH:MM:SS.micro.
    if let Some(v) = line.strip_prefix("out_time_ms=") {
        let us: f64 = v.trim().parse().ok()?;
        return Some(us / 1_000_000.0);
    }
    if let Some(v) = line.strip_prefix("out_time_us=") {
        let us: f64 = v.trim().parse().ok()?;
        return Some(us / 1_000_000.0);
    }
    if let Some(v) = line.strip_prefix("out_time=") {
        return parse_hhmmss(v.trim());
    }
    None
}

fn build_ffmpeg_args(
    source: &Path,
    dest: &Path,
    target: &VideoEncodeTarget,
    strip_metadata: bool,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        source.to_string_lossy().into_owned(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        target.x264_preset.into(),
        "-crf".into(),
        target.crf.to_string(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        format!("{}k", target.audio_kbps),
        "-movflags".into(),
        "+faststart".into(),
        // Denser than the default ~0.5s so short encodes still emit mid-progress ticks.
        "-stats_period".into(),
        "0.2".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
    ];
    if strip_metadata {
        args.push("-map_metadata".into());
        args.push("-1".into());
    }
    if let Some(h) = target.max_height {
        // Scale down only; never upscale. Width `-2` keeps aspect + even dims for yuv420p.
        args.push("-vf".into());
        args.push(format!("scale=-2:'min(ih,{h})'"));
    }
    args.push("-pix_fmt".into());
    args.push("yuv420p".into());
    args.push(dest.to_string_lossy().into_owned());
    args
}

fn map_ffmpeg_failure(stderr: &str, status_code: Option<i32>) -> String {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("unknown encoder")
        || lower.contains("encoder not found")
        || lower.contains("unknown decoder")
        || lower.contains("decoder not found")
        || lower.contains("error while opening encoder")
    {
        return format!(
            "missing tool: ffmpeg codecs unavailable (libx264/aac required): {}",
            stderr.lines().last().unwrap_or("encode failed")
        );
    }
    if lower.contains("invalid data")
        || lower.contains("does not contain any stream")
        || lower.contains("moov atom not found")
        || lower.contains("invalid")
        || lower.contains("could not find codec")
        || lower.contains("error opening input")
    {
        return format!(
            "unsupported or corrupt video: {}",
            stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("decode failed")
        );
    }
    format!(
        "unsupported or corrupt video: ffmpeg exited {:?} — {}",
        status_code,
        stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("encode failed")
    )
}

/// Compress `source` with a registered video preset into `dest` (MP4).
///
/// `on_progress` receives percent in `0.0..=100.0` during the encode; return `false` to stop.
/// When `cancel` is set, the ffmpeg child is killed and the error is `"cancelled"`.
pub fn encode_video(
    source: &Path,
    preset_id: &str,
    dest: &Path,
    cancel: Option<&AtomicBool>,
    mut on_progress: Option<&mut dyn FnMut(f64) -> bool>,
    strip_metadata: bool,
) -> Result<(), String> {
    let preset: &VideoPreset = video_preset(preset_id)
        .ok_or_else(|| format!("unknown video preset: {preset_id}"))?;
    reject_unsupported_container(source)?;
    if cancelled(cancel) {
        return Err("cancelled".into());
    }

    let ffmpeg = resolve_ffmpeg()?;
    let duration = probe_duration_secs(&ffmpeg, source);

    if cancelled(cancel) {
        return Err("cancelled".into());
    }

    let args = build_ffmpeg_args(source, dest, &preset.target, strip_metadata);
    let mut child = Command::new(&ffmpeg)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "missing tool: ffmpeg (failed to spawn binary)".to_string()
            } else {
                format!("missing tool: ffmpeg ({e})")
            }
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "missing tool: ffmpeg (no progress pipe)".to_string())?;
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

    let reader = BufReader::new(stdout);
    let mut last_reported = -1.0_f64;
    for line in reader.lines().map_while(Result::ok) {
        if cancelled(cancel) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(dest);
            return Err("cancelled".into());
        }

        if let Some(out_secs) = parse_out_time_secs(&line) {
            let percent = match duration.filter(|d| *d > 0.05) {
                Some(d) => ((out_secs / d) * 100.0).clamp(0.0, 99.0),
                None => 50.0, // unknown duration: keep a mid-encode signal
            };
            // Throttle: at least 1% steps so long encodes still move the meter.
            if percent - last_reported >= 1.0 || last_reported < 0.0 {
                last_reported = percent;
                if let Some(cb) = on_progress.as_mut() {
                    if !cb(percent) {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = std::fs::remove_file(dest);
                        return Err("cancelled".into());
                    }
                }
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg wait failed: {e}"))?;
    let stderr = stderr_handle
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();

    if cancelled(cancel) {
        let _ = std::fs::remove_file(dest);
        return Err("cancelled".into());
    }

    if !status.success() {
        let _ = std::fs::remove_file(dest);
        return Err(map_ffmpeg_failure(&stderr, status.code()));
    }

    if !dest.is_file() || std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0) == 0 {
        let _ = std::fs::remove_file(dest);
        return Err("unsupported or corrupt video: ffmpeg produced empty output".into());
    }

    if let Some(cb) = on_progress.as_mut() {
        let _ = cb(99.0);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::presets::{VIDEO_BALANCED, VIDEO_HIGH, VIDEO_SMALL};
    use crate::compress::output::prepare_output_path;
    use std::fs;
    use std::sync::atomic::AtomicBool;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fo-video-encode-{}-{}-{}",
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

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/video")
            .join(name)
    }

    fn require_ffmpeg() -> PathBuf {
        resolve_ffmpeg().unwrap_or_else(|e| {
            panic!("ffmpeg required for video encode tests: {e}");
        })
    }

    /// Tiny synthetic MP4 (color bars + sine) for offline roundtrip tests.
    fn write_fixture_mp4(path: &Path, seconds: f32) {
        let ffmpeg = require_ffmpeg();
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("testsrc=size=320x240:rate=10:duration={seconds}"),
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=440:duration={seconds}"),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("spawn ffmpeg for fixture");
        assert!(status.success(), "fixture encode failed");
    }

    #[test]
    fn parses_duration_and_progress_lines() {
        let stderr = "  Duration: 00:00:03.50, start: 0.000000, bitrate: 100 kb/s\n";
        assert!((parse_duration_from_ffmpeg_stderr(stderr).unwrap() - 3.5).abs() < 0.01);
        // out_time_ms uses microseconds (same numeric scale as out_time_us).
        assert!((parse_out_time_secs("out_time_ms=1500000").unwrap() - 1.5).abs() < 0.01);
        assert!((parse_out_time_secs("out_time_us=2500000").unwrap() - 2.5).abs() < 0.01);
        assert!((parse_out_time_secs("out_time=00:00:01.234567").unwrap() - 1.234567).abs() < 1e-6);
        // Mis-parsing ms as milliseconds would turn 2s of encode into ~2000s → 99% instantly.
        let two_secs = parse_out_time_secs("out_time_ms=2000000").unwrap();
        assert!((two_secs - 2.0).abs() < 0.01, "got {two_secs}");
    }

    #[test]
    fn out_time_ms_percent_increases_instead_of_jumping_to_99() {
        let duration = 10.0_f64;
        let samples_us = [1_000_000_f64, 4_000_000.0, 7_000_000.0, 9_500_000.0];
        let mut percents = Vec::new();
        for us in samples_us {
            let line = format!("out_time_ms={us}");
            let out_secs = parse_out_time_secs(&line).unwrap();
            percents.push(((out_secs / duration) * 100.0).clamp(0.0, 99.0));
        }
        assert!(
            (percents[0] - 10.0).abs() < 0.01 && (percents[1] - 40.0).abs() < 0.01,
            "got {percents:?}"
        );
        assert!(
            percents.windows(2).all(|w| w[1] > w[0]),
            "progress must increase across out_time_ms samples, got {percents:?}"
        );
        assert!(
            percents.iter().any(|&p| p < 90.0),
            "must include a true mid-encode value, got {percents:?}"
        );
        // Document the old bug: treating out_time_ms as milliseconds clamps every sample to 99%.
        let buggy: Vec<f64> = samples_us
            .iter()
            .map(|us| ((us / 1000.0 / duration) * 100.0).clamp(0.0, 99.0))
            .collect();
        assert!(buggy.iter().all(|&p| (p - 99.0).abs() < 0.01), "got {buggy:?}");
    }

    #[test]
    fn registry_documents_supported_containers() {
        assert!(SUPPORTED_VIDEO_CONTAINERS.contains(&"mp4"));
        assert!(SUPPORTED_VIDEO_CONTAINERS.contains(&"webm"));
        assert!(SUPPORTED_VIDEO_CONTAINERS.contains(&"mkv"));
        assert!(SUPPORTED_VIDEO_CONTAINERS.contains(&"3gp"));
        assert!(SUPPORTED_VIDEO_CONTAINERS.contains(&"ts"));
        assert!(SUPPORTED_VIDEO_CONTAINERS.contains(&"m2ts"));
    }

    #[test]
    fn avi_fails_clearly_as_unsupported() {
        let dir = temp_dir("avi");
        let avi = dir.join("clip.avi");
        fs::write(&avi, b"fake").expect("write");
        let out = dir.join("out.mp4");
        let err = encode_video(&avi, VIDEO_HIGH, &out, None, None, true).expect_err("avi unsupported");
        assert!(err.contains("unsupported"), "{err}");
        assert!(!err.contains("missing tool"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_preset_fails() {
        let dir = temp_dir("preset");
        let src = dir.join("a.mp4");
        fs::write(&src, b"x").unwrap();
        let out = dir.join("a.mp4");
        let err = encode_video(&src, "nope", &out, None, None, true).expect_err("unknown");
        assert!(err.contains("unknown video preset"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_video_fails_without_panic() {
        require_ffmpeg();
        let dir = temp_dir("corrupt");
        let junk = dir.join("broken.mp4");
        fs::write(&junk, b"not-a-video-file").expect("write");
        let out = dir.join("out.mp4");
        let err = encode_video(&junk, VIDEO_BALANCED, &out, None, None, true).expect_err("must fail");
        assert!(
            err.contains("corrupt") || err.contains("unsupported") || err.contains("missing tool"),
            "unexpected error: {err}"
        );
        assert!(!out.exists() || fs::metadata(&out).map(|m| m.len()).unwrap_or(0) == 0);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Heavier source so ffmpeg emits multiple `-progress` out_time samples (tiny
    /// fixtures often finish in one tick and only surface the terminal percent).
    fn write_progress_fixture_mp4(path: &Path) {
        let ffmpeg = require_ffmpeg();
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=1280x720:rate=30:duration=6",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=6",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("spawn ffmpeg for progress fixture");
        assert!(status.success(), "progress fixture encode failed");
    }

    #[test]
    fn encodes_mp4_for_each_preset_with_mid_progress() {
        require_ffmpeg();
        let dir = temp_dir("roundtrip");
        let src = dir.join("tone.mp4");
        write_progress_fixture_mp4(&src);

        for preset in [VIDEO_HIGH, VIDEO_BALANCED, VIDEO_SMALL] {
            let out = dir.join(format!("{preset}.mp4"));
            let seen = std::sync::Mutex::new(Vec::new());
            let mut on_progress = |p: f64| -> bool {
                seen.lock().unwrap().push(p);
                true
            };
            encode_video(&src, preset, &out, None, Some(&mut on_progress), true)
                .unwrap_or_else(|e| panic!("{preset}: {e}"));
            assert!(out.is_file(), "missing {preset}");
            assert!(fs::metadata(&out).unwrap().len() > 0);
            let progress = seen.lock().unwrap().clone();
            assert!(
                progress.iter().any(|&p| p > 0.0 && p < 100.0),
                "{preset} should emit progress, got {progress:?}"
            );
            // veryfast (video-small) can finish in one progress tick on fast hosts; require
            // increasing mid-encode samples on the slower presets where ffmpeg emits several.
            if preset != VIDEO_SMALL {
                let before_end: Vec<f64> = progress.iter().copied().filter(|&p| p < 99.0).collect();
                assert!(
                    before_end.iter().any(|&p| p > 0.0 && p < 90.0),
                    "{preset} should emit genuine mid-encode progress (<90%), not jump to 99%; got {progress:?}"
                );
                assert!(
                    before_end.len() >= 2 && before_end.windows(2).any(|w| w[1] > w[0] + 0.5),
                    "{preset} mid-progress should increase during encode, got {progress:?}"
                );
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn balanced_and_small_shrink_verbose_source() {
        require_ffmpeg();
        let dir = temp_dir("shrink");
        let src = dir.join("fat.mp4");
        // Higher bitrate source so re-encode can shrink.
        let ffmpeg = require_ffmpeg();
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=640x360:rate=24:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
                "-c:v",
                "libx264",
                "-crf",
                "12",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "256k",
                "-shortest",
            ])
            .arg(&src)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("spawn");
        assert!(status.success());
        let original = fs::metadata(&src).unwrap().len();

        for preset in [VIDEO_BALANCED, VIDEO_SMALL] {
            let out = dir.join(format!("{preset}.mp4"));
            encode_video(&src, preset, &out, None, None, true).unwrap_or_else(|e| panic!("{preset}: {e}"));
            let result = fs::metadata(&out).unwrap().len();
            assert!(
                result < original,
                "{preset} should shrink: {result} >= {original}"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn smoke_writes_under_compressed_via_prepare_output_path() {
        require_ffmpeg();
        let dir = temp_dir("smoke-path");
        let src = dir.join("Holiday.MP4");
        write_fixture_mp4(&src, 0.8);

        let preset = video_preset(VIDEO_BALANCED).expect("preset");
        let reserved = prepare_output_path(&src, preset.output_ext()).expect("reserve");
        assert_eq!(reserved, dir.join("_compressed").join("Holiday.mp4"));

        encode_video(&src, VIDEO_BALANCED, &reserved, None, None, true).expect("encode");
        assert!(reserved.is_file());
        assert!(fs::metadata(&reserved).unwrap().len() > 0);
        assert!(fs::metadata(&src).unwrap().len() > 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn respects_cancel_flag_without_leaving_output() {
        require_ffmpeg();
        let dir = temp_dir("cancel");
        let src = dir.join("long.mp4");
        write_fixture_mp4(&src, 3.0);
        let out = dir.join("out.mp4");
        let cancel = AtomicBool::new(true);
        let err =
            encode_video(&src, VIDEO_BALANCED, &out, Some(&cancel), None, true).expect_err("cancelled");
        assert_eq!(err, "cancelled");
        assert!(!out.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancel_during_progress_kills_encode() {
        require_ffmpeg();
        let dir = temp_dir("cancel-mid");
        let src = dir.join("long.mp4");
        write_progress_fixture_mp4(&src);
        let out = dir.join("out.mp4");
        let cancel = AtomicBool::new(false);
        let mut ticks = 0u32;
        let mut on_progress = |_p: f64| -> bool {
            ticks += 1;
            if ticks >= 2 {
                cancel.store(true, Ordering::SeqCst);
                return false;
            }
            true
        };
        let err = encode_video(
            &src,
            VIDEO_HIGH,
            &out,
            Some(&cancel),
            Some(&mut on_progress),
            true,
        );
        assert_eq!(err.expect_err("expected cancel"), "cancelled");
        assert!(!out.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_tool_message_shape_is_documented() {
        let missing = "missing tool: ffmpeg (not found on PATH, beside the app, or via FFMPEG_PATH)";
        let bad = "unsupported or corrupt video: invalid data";
        assert!(missing.starts_with("missing tool"));
        assert!(bad.starts_with("unsupported or corrupt"));
        assert!(!bad.contains("missing tool"));
    }

    #[test]
    fn encodes_webm_and_mkv_fixtures_to_mp4() {
        require_ffmpeg();
        let dir = temp_dir("containers");
        for name in ["tone.webm", "tone.mkv"] {
            let src = fixture(name);
            assert!(src.is_file(), "missing fixture {}", src.display());
            let out = dir.join(format!("{name}.mp4"));
            encode_video(&src, VIDEO_BALANCED, &out, None, None, true)
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(out.is_file());
            assert!(fs::metadata(&out).unwrap().len() > 0);
        }
        let _ = fs::remove_dir_all(&dir);
    }
}

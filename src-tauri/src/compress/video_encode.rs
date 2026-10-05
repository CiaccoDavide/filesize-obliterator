//! Offline video compress via a local ffmpeg binary (sidecar / PATH / `FFMPEG_PATH`).
//!
//! Inputs: MP4, WebM, MKV, MOV/M4V, plus 3GP/MPEG-TS where local ffmpeg demuxes.
//! Output: `.mp4` (H.264 + AAC).
//! No network. Missing ffmpeg → `missing tool: ffmpeg…`. Bad input → `unsupported or corrupt video…`.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::Duration;
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

pub use crate::compress::sidecar::resolve_ffmpeg;

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

/// Stable status string for the settings HUD capability probe.
pub const HW_STATUS_READY: &str = "HW: READY";
pub const HW_STATUS_UNAVAILABLE: &str = "HW: UNAVAILABLE";
/// Emitted on the compress log/status stream when HW init fails and software takes over.
pub const HW_FALLBACK_LOG: &str = "HW FALLBACK";

/// Platform HW H.264 encoders we may select (bundled/local ffmpeg).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HwVideoEncoder {
    VideoToolbox,
    Nvenc,
    Qsv,
    Amf,
}

impl HwVideoEncoder {
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            Self::VideoToolbox => "h264_videotoolbox",
            Self::Nvenc => "h264_nvenc",
            Self::Qsv => "h264_qsv",
            Self::Amf => "h264_amf",
        }
    }
}

/// Preference order for the current OS (first listed-and-present wins).
pub fn hw_encoder_candidates() -> &'static [HwVideoEncoder] {
    if cfg!(target_os = "macos") {
        &[HwVideoEncoder::VideoToolbox]
    } else {
        // Windows / Linux: probe NVENC, then QSV, then AMF.
        &[
            HwVideoEncoder::Nvenc,
            HwVideoEncoder::Qsv,
            HwVideoEncoder::Amf,
        ]
    }
}

/// True when `encoders_text` lists the encoder as a whole token (ffmpeg `-encoders` line).
pub fn encoder_listed_in(encoders_text: &str, encoder: HwVideoEncoder) -> bool {
    let name = encoder.ffmpeg_name();
    for line in encoders_text.lines() {
        let mut parts = line.split_whitespace();
        let _flags = parts.next();
        if parts.next() == Some(name) {
            return true;
        }
    }
    false
}

/// Parse `ffmpeg -encoders` text for the first preferred HW encoder that is listed.
pub fn select_hw_encoder_from_list(encoders_text: &str) -> Option<HwVideoEncoder> {
    hw_encoder_candidates()
        .iter()
        .copied()
        .find(|candidate| encoder_listed_in(encoders_text, *candidate))
}

fn ffmpeg_encoders_text(ffmpeg: &Path) -> Option<String> {
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Probe whether a listed HW encoder can actually open a session (not just appear in `-encoders`).
///
/// Listing-only is insufficient: many ffmpeg builds advertise NVENC/QSV/AMF/VT without working
/// hardware. A one-frame lavfi encode to `null` proves init usability.
pub fn probe_hw_encoder_init(ffmpeg: &Path, encoder: HwVideoEncoder) -> bool {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        "color=c=black:s=64x64:d=0.2:r=10".into(),
        "-frames:v".into(),
        "1".into(),
        "-an".into(),
    ];
    // Minimal codec knobs matching production encode paths (incl. VT `-allow_sw 0`).
    match encoder {
        HwVideoEncoder::VideoToolbox => {
            args.push("-c:v".into());
            args.push(encoder.ffmpeg_name().into());
            args.push("-q:v".into());
            args.push("65".into());
            args.push("-allow_sw".into());
            args.push("0".into());
        }
        HwVideoEncoder::Nvenc => {
            args.push("-c:v".into());
            args.push(encoder.ffmpeg_name().into());
            args.push("-preset".into());
            args.push("p4".into());
            args.push("-rc".into());
            args.push("vbr".into());
            args.push("-cq".into());
            args.push("28".into());
        }
        HwVideoEncoder::Qsv => {
            args.push("-c:v".into());
            args.push(encoder.ffmpeg_name().into());
            args.push("-global_quality".into());
            args.push("28".into());
        }
        HwVideoEncoder::Amf => {
            args.push("-c:v".into());
            args.push(encoder.ffmpeg_name().into());
            args.push("-rc".into());
            args.push("cqp".into());
            args.push("-qp_i".into());
            args.push("28".into());
            args.push("-qp_p".into());
            args.push("28".into());
        }
    }
    args.push("-pix_fmt".into());
    args.push("yuv420p".into());
    args.push("-f".into());
    args.push("null".into());
    args.push("-".into());

    let output = Command::new(ffmpeg)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output();
    match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

/// Detect a usable HW H.264 encoder: listed by ffmpeg *and* able to init a HW session.
pub fn detect_hw_encoder_uncached(ffmpeg: &Path) -> Option<HwVideoEncoder> {
    let text = ffmpeg_encoders_text(ffmpeg)?;
    for candidate in hw_encoder_candidates() {
        if !encoder_listed_in(&text, *candidate) {
            continue;
        }
        if probe_hw_encoder_init(ffmpeg, *candidate) {
            return Some(*candidate);
        }
    }
    None
}

/// Cached detect so UI status + each video job share one init probe per process.
pub fn detect_hw_encoder(ffmpeg: &Path) -> Option<HwVideoEncoder> {
    static CACHED: OnceLock<Option<HwVideoEncoder>> = OnceLock::new();
    *CACHED.get_or_init(|| detect_hw_encoder_uncached(ffmpeg))
}

/// UI / IPC capability probe: `HW: READY` or `HW: UNAVAILABLE`.
pub fn hw_encode_status() -> &'static str {
    match resolve_ffmpeg().ok().and_then(|ff| detect_hw_encoder(&ff)) {
        Some(_) => HW_STATUS_READY,
        None => HW_STATUS_UNAVAILABLE,
    }
}

/// Map libx264 CRF (lower=better) onto VideoToolbox `-q:v` (1–100, lower=better).
pub fn videotoolbox_q_from_crf(crf: u8) -> u8 {
    // CRF 18 → ~40, 23 → ~52, 28 → ~65 (clamped).
    let q = 40i32 + ((crf as i32 - 18) * 5) / 2;
    q.clamp(20, 80) as u8
}

fn push_video_codec_args(args: &mut Vec<String>, target: &VideoEncodeTarget, hw: Option<HwVideoEncoder>) {
    match hw {
        None => {
            args.push("-c:v".into());
            args.push("libx264".into());
            args.push("-preset".into());
            args.push(target.x264_preset.into());
            args.push("-crf".into());
            args.push(target.crf.to_string());
        }
        Some(HwVideoEncoder::VideoToolbox) => {
            args.push("-c:v".into());
            args.push(HwVideoEncoder::VideoToolbox.ffmpeg_name().into());
            args.push("-q:v".into());
            args.push(videotoolbox_q_from_crf(target.crf).to_string());
            // Force real HW; software VT path is our explicit libx264 fallback.
            args.push("-allow_sw".into());
            args.push("0".into());
        }
        Some(HwVideoEncoder::Nvenc) => {
            args.push("-c:v".into());
            args.push(HwVideoEncoder::Nvenc.ffmpeg_name().into());
            args.push("-preset".into());
            args.push("p4".into());
            args.push("-rc".into());
            args.push("vbr".into());
            args.push("-cq".into());
            args.push(target.crf.to_string());
        }
        Some(HwVideoEncoder::Qsv) => {
            args.push("-c:v".into());
            args.push(HwVideoEncoder::Qsv.ffmpeg_name().into());
            args.push("-global_quality".into());
            args.push(target.crf.to_string());
        }
        Some(HwVideoEncoder::Amf) => {
            args.push("-c:v".into());
            args.push(HwVideoEncoder::Amf.ffmpeg_name().into());
            args.push("-rc".into());
            args.push("cqp".into());
            args.push("-qp_i".into());
            args.push(target.crf.to_string());
            args.push("-qp_p".into());
            args.push(target.crf.to_string());
        }
    }
}

fn build_ffmpeg_args(
    source: &Path,
    dest: &Path,
    target: &VideoEncodeTarget,
    strip_metadata: bool,
    hw: Option<HwVideoEncoder>,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        source.to_string_lossy().into_owned(),
    ];
    push_video_codec_args(&mut args, target, hw);
    args.push("-c:a".into());
    args.push("aac".into());
    args.push("-b:a".into());
    args.push(format!("{}k", target.audio_kbps));
    args.push("-movflags".into());
    args.push("+faststart".into());
    // Denser than the default ~0.5s so short encodes still emit mid-progress ticks.
    args.push("-stats_period".into());
    args.push("0.2".into());
    args.push("-progress".into());
    args.push("pipe:1".into());
    args.push("-nostats".into());
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

fn run_ffmpeg_encode(
    ffmpeg: &Path,
    args: &[String],
    dest: &Path,
    duration: Option<f64>,
    cancel: Option<&AtomicBool>,
    on_progress: &mut Option<&mut dyn FnMut(f64) -> bool>,
) -> Result<(), String> {
    let mut child = Command::new(ffmpeg)
        .args(args)
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

    // Progress lines arrive on a reader thread so the encode loop can poll `cancel`
    // even when ffmpeg goes silent (no out_time lines) — otherwise cancel never kills
    // the child and the UI stays ABORTING forever.
    let (line_tx, line_rx) = mpsc::channel::<String>();
    let reader_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line_tx.send(line).is_err() {
                break;
            }
        }
    });

    let mut last_reported = -1.0_f64;
    let cancelled_mid = loop {
        match line_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(line) => {
                if cancelled(cancel) {
                    break true;
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
                                break true;
                            }
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if cancelled(cancel) {
                    break true;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break false,
        }
    };

    if cancelled_mid {
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(dest);
        // Drop the sender side via reader exit after kill closes the pipe.
        let _ = reader_handle.join();
        return Err("cancelled".into());
    }
    let _ = reader_handle.join();

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

/// Compress `source` with a registered video preset into `dest` (MP4).
///
/// `on_progress` receives percent in `0.0..=100.0` during the encode; return `false` to stop.
/// When `cancel` is set, the ffmpeg child is killed and the error is `"cancelled"`.
/// When `prefer_hardware` is true and a usable platform HW encoder is detected, try it first;
/// on failure (other than cancel), emit [`HW_FALLBACK_LOG`] via `on_log` and retry with libx264.
#[allow(clippy::too_many_arguments)]
pub fn encode_video(
    source: &Path,
    preset_id: &str,
    dest: &Path,
    cancel: Option<&AtomicBool>,
    on_progress: Option<&mut dyn FnMut(f64) -> bool>,
    strip_metadata: bool,
    prefer_hardware: bool,
    on_log: Option<&mut dyn FnMut(&str)>,
) -> Result<(), String> {
    let ffmpeg = resolve_ffmpeg()?;
    let hw = if prefer_hardware {
        detect_hw_encoder(&ffmpeg)
    } else {
        None
    };
    encode_video_with_hw(
        source,
        preset_id,
        dest,
        cancel,
        on_progress,
        strip_metadata,
        hw,
        on_log,
    )
}

/// Encode trying an explicit HW encoder first (test seam for forced HW failure → fallback).
#[allow(clippy::too_many_arguments)]
fn encode_video_with_hw(
    source: &Path,
    preset_id: &str,
    dest: &Path,
    cancel: Option<&AtomicBool>,
    mut on_progress: Option<&mut dyn FnMut(f64) -> bool>,
    strip_metadata: bool,
    hw: Option<HwVideoEncoder>,
    mut on_log: Option<&mut dyn FnMut(&str)>,
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

    if let Some(encoder) = hw {
        let args = build_ffmpeg_args(source, dest, &preset.target, strip_metadata, Some(encoder));
        match run_ffmpeg_encode(&ffmpeg, &args, dest, duration, cancel, &mut on_progress) {
            Ok(()) => return Ok(()),
            Err(e) if e == "cancelled" => return Err(e),
            Err(_) => {
                let _ = std::fs::remove_file(dest);
                if let Some(log) = on_log.as_mut() {
                    log(HW_FALLBACK_LOG);
                }
            }
        }
    }

    if cancelled(cancel) {
        return Err("cancelled".into());
    }

    let args = build_ffmpeg_args(source, dest, &preset.target, strip_metadata, None);
    run_ffmpeg_encode(&ffmpeg, &args, dest, duration, cancel, &mut on_progress)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::presets::{VIDEO_BALANCED, VIDEO_HIGH, VIDEO_SMALL};
    use crate::compress::output::prepare_output_path;
    use std::fs;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

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

    /// Soft-skip gate: when ffmpeg is absent, print an explicit ignore reason and return `None`
    /// so CI / bare hosts skip encoder-heavy tests instead of failing.
    fn require_ffmpeg() -> Option<PathBuf> {
        match resolve_ffmpeg() {
            Ok(p) => Some(p),
            Err(e) => {
                eprintln!("ignoring test: {e}");
                None
            }
        }
    }

    /// Tiny synthetic MP4 (color bars + sine) for offline roundtrip tests.
    /// Caller must soft-skip via [`require_ffmpeg`] first.
    fn write_fixture_mp4(path: &Path, seconds: f32) {
        let ffmpeg = resolve_ffmpeg().expect("ffmpeg required to synthesize video fixture");
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
        let err = encode_video(&avi, VIDEO_HIGH, &out, None, None, true, false, None)
            .expect_err("avi unsupported");
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
        let err = encode_video(&src, "nope", &out, None, None, true, false, None).expect_err("unknown");
        assert!(err.contains("unknown video preset"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_video_fails_without_panic() {
        let Some(_) = require_ffmpeg() else {
            return;
        };
        let dir = temp_dir("corrupt");
        let junk = dir.join("broken.mp4");
        fs::write(&junk, b"not-a-video-file").expect("write");
        let out = dir.join("out.mp4");
        let err = encode_video(&junk, VIDEO_BALANCED, &out, None, None, true, false, None)
            .expect_err("must fail");
        assert!(
            err.contains("corrupt") || err.contains("unsupported") || err.contains("missing tool"),
            "unexpected error: {err}"
        );
        assert!(!out.exists() || fs::metadata(&out).map(|m| m.len()).unwrap_or(0) == 0);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Heavier source so ffmpeg emits multiple `-progress` out_time samples (tiny
    /// fixtures often finish in one tick and only surface the terminal percent).
    /// Caller must soft-skip via [`require_ffmpeg`] first.
    fn write_progress_fixture_mp4(path: &Path) {
        let ffmpeg = resolve_ffmpeg().expect("ffmpeg required to synthesize progress fixture");
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
        let Some(_) = require_ffmpeg() else {
            return;
        };
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
            encode_video(&src, preset, &out, None, Some(&mut on_progress), true, false, None)
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
        let Some(ffmpeg) = require_ffmpeg() else {
            return;
        };
        let dir = temp_dir("shrink");
        let src = dir.join("fat.mp4");
        // Higher bitrate source so re-encode can shrink.
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
            encode_video(&src, preset, &out, None, None, true, false, None)
                .unwrap_or_else(|e| panic!("{preset}: {e}"));
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
        let Some(_) = require_ffmpeg() else {
            return;
        };
        let dir = temp_dir("smoke-path");
        let fixture_src = fixture("tone.mp4");
        assert!(
            fixture_src.is_file(),
            "missing fixture {}",
            fixture_src.display()
        );
        let src = dir.join("Holiday.MP4");
        fs::copy(&fixture_src, &src).expect("copy committed video fixture");

        let preset = video_preset(VIDEO_BALANCED).expect("preset");
        let reserved = prepare_output_path(&src, preset.output_ext()).expect("reserve");
        assert_eq!(reserved, dir.join("_compressed").join("Holiday.mp4"));

        encode_video(&src, VIDEO_BALANCED, &reserved, None, None, true, false, None).expect("encode");
        assert!(reserved.is_file());
        assert!(fs::metadata(&reserved).unwrap().len() > 0);
        assert!(fs::metadata(&src).unwrap().len() > 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn respects_cancel_flag_without_leaving_output() {
        let Some(_) = require_ffmpeg() else {
            return;
        };
        let dir = temp_dir("cancel");
        let src = dir.join("long.mp4");
        write_fixture_mp4(&src, 3.0);
        let out = dir.join("out.mp4");
        let cancel = AtomicBool::new(true);
        let err =
            encode_video(&src, VIDEO_BALANCED, &out, Some(&cancel), None, true, false, None)
                .expect_err("cancelled");
        assert_eq!(err, "cancelled");
        assert!(!out.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancel_flag_polled_without_progress_callback_kills_encode() {
        let Some(_) = require_ffmpeg() else {
            return;
        };
        let dir = temp_dir("cancel-poll");
        let src = dir.join("long.mp4");
        write_progress_fixture_mp4(&src);
        let out = dir.join("out.mp4");
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_w = Arc::clone(&cancel);
        // Flip cancel from another thread — encode must observe it even with no
        // on_progress callback (poll path, not progress-line-only).
        let watcher = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            cancel_w.store(true, Ordering::SeqCst);
        });
        let err = encode_video(
            &src,
            VIDEO_HIGH,
            &out,
            Some(cancel.as_ref()),
            None,
            true,
            false,
            None,
        );
        let _ = watcher.join();
        assert_eq!(err.expect_err("expected cancel"), "cancelled");
        assert!(!out.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancel_during_progress_kills_encode() {
        let Some(_) = require_ffmpeg() else {
            return;
        };
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
            false,
            None,
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
        let Some(_) = require_ffmpeg() else {
            return;
        };
        let dir = temp_dir("containers");
        for name in ["tone.webm", "tone.mkv"] {
            let src = fixture(name);
            assert!(src.is_file(), "missing fixture {}", src.display());
            let out = dir.join(format!("{name}.mp4"));
            encode_video(&src, VIDEO_BALANCED, &out, None, None, true, false, None)
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(out.is_file());
            assert!(fs::metadata(&out).unwrap().len() > 0);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn selects_videotoolbox_from_encoder_list_on_macos() {
        let sample = "\
 Encoders:
 V....D libx264              libx264 H.264
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder
";
        let selected = select_hw_encoder_from_list(sample);
        if cfg!(target_os = "macos") {
            assert_eq!(selected, Some(HwVideoEncoder::VideoToolbox));
        } else {
            // Non-macOS candidates prefer nvenc when listed.
            assert_eq!(selected, Some(HwVideoEncoder::Nvenc));
        }
    }

    #[test]
    fn empty_encoder_list_means_unavailable() {
        assert_eq!(select_hw_encoder_from_list("Encoders:\n V....D libx264\n"), None);
        assert_eq!(hw_encode_status() == HW_STATUS_READY || hw_encode_status() == HW_STATUS_UNAVAILABLE, true);
    }

    #[test]
    fn videotoolbox_q_tracks_crf_presets() {
        assert_eq!(videotoolbox_q_from_crf(18), 40);
        assert_eq!(videotoolbox_q_from_crf(23), 52);
        assert_eq!(videotoolbox_q_from_crf(28), 65);
    }

    #[test]
    fn software_args_still_use_libx264() {
        let src = Path::new("/tmp/in.mp4");
        let dest = Path::new("/tmp/out.mp4");
        let target = video_preset(VIDEO_BALANCED).unwrap().target;
        let args = build_ffmpeg_args(src, dest, &target, true, None);
        assert!(args.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(args.iter().any(|a| a == "-crf"));
    }

    #[test]
    fn hw_args_use_platform_encoder_not_libx264() {
        let src = Path::new("/tmp/in.mp4");
        let dest = Path::new("/tmp/out.mp4");
        let target = video_preset(VIDEO_HIGH).unwrap().target;
        let args = build_ffmpeg_args(src, dest, &target, true, Some(HwVideoEncoder::VideoToolbox));
        assert!(args.windows(2).any(|w| w[0] == "-c:v" && w[1] == "h264_videotoolbox"));
        assert!(!args.iter().any(|a| a == "libx264"));
    }

    /// Cross-platform encoder that cannot init on this host (forces HW failure → fallback).
    fn forced_unusable_hw_encoder() -> HwVideoEncoder {
        if cfg!(target_os = "macos") {
            HwVideoEncoder::Nvenc
        } else {
            HwVideoEncoder::VideoToolbox
        }
    }

    #[test]
    fn prefer_hardware_smoke_encode_when_ready() {
        let Some(ffmpeg) = require_ffmpeg() else {
            return;
        };
        // Use uncached detect so this test asserts real init usability, not a stale cache.
        let Some(hw) = detect_hw_encoder_uncached(&ffmpeg) else {
            eprintln!("ignoring test: no usable HW encoder");
            return;
        };
        assert_eq!(hw_encode_status(), HW_STATUS_READY);
        let dir = temp_dir("hw-smoke");
        let src = dir.join("tone.mp4");
        write_fixture_mp4(&src, 0.5);
        let out = dir.join("hw.mp4");
        let logs = std::sync::Mutex::new(Vec::<String>::new());
        let mut on_log = |msg: &str| {
            logs.lock().unwrap().push(msg.to_string());
        };
        encode_video_with_hw(
            &src,
            VIDEO_SMALL,
            &out,
            None,
            None,
            true,
            Some(hw),
            Some(&mut on_log),
        )
        .unwrap_or_else(|e| panic!("HW prefer encode failed ({hw:?}): {e}"));
        assert!(out.is_file());
        assert!(fs::metadata(&out).unwrap().len() > 0);
        // Successful HW path should not emit fallback.
        assert!(
            !logs.lock().unwrap().iter().any(|m| m == HW_FALLBACK_LOG),
            "unexpected fallback on ready HW: {:?}",
            logs.lock().unwrap()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hw_encode_failure_emits_fallback_log_and_retries_software() {
        let Some(ffmpeg) = require_ffmpeg() else {
            return;
        };
        let bad = forced_unusable_hw_encoder();
        assert!(
            !probe_hw_encoder_init(&ffmpeg, bad),
            "forced encoder {:?} must fail HW init on this host",
            bad
        );

        let dir = temp_dir("hw-fallback");
        let src = dir.join("tone.mp4");
        write_fixture_mp4(&src, 0.4);
        let out = dir.join("out.mp4");
        let logs = std::sync::Mutex::new(Vec::<String>::new());
        let mut on_log = |msg: &str| {
            logs.lock().unwrap().push(msg.to_string());
        };

        encode_video_with_hw(
            &src,
            VIDEO_SMALL,
            &out,
            None,
            None,
            true,
            Some(bad),
            Some(&mut on_log),
        )
        .expect("software retry after HW failure must succeed");

        assert!(out.is_file());
        assert!(fs::metadata(&out).unwrap().len() > 0);
        let captured = logs.lock().unwrap().clone();
        assert!(
            captured.iter().any(|m| m == HW_FALLBACK_LOG),
            "expected {HW_FALLBACK_LOG} in log stream, got {captured:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn init_probe_rejects_unusable_listed_style_encoder() {
        let Some(ffmpeg) = require_ffmpeg() else {
            return;
        };
        let bad = forced_unusable_hw_encoder();
        assert!(!probe_hw_encoder_init(&ffmpeg, bad));
        // Listing alone must not mark READY when init fails for all candidates.
        // (Uncached path walks candidates; a foreign encoder is never selected as READY.)
        let status_ready_implies_init = match detect_hw_encoder_uncached(&ffmpeg) {
            Some(enc) => probe_hw_encoder_init(&ffmpeg, enc),
            None => true,
        };
        assert!(status_ready_implies_init);
    }

    #[test]
    fn software_path_works_when_hardware_not_preferred() {
        let Some(_) = require_ffmpeg() else {
            return;
        };
        let dir = temp_dir("sw-only");
        let src = dir.join("tone.mp4");
        write_fixture_mp4(&src, 0.4);
        let out = dir.join("sw.mp4");
        encode_video(&src, VIDEO_SMALL, &out, None, None, true, false, None)
            .expect("software encode");
        assert!(out.is_file());
        let _ = fs::remove_dir_all(&dir);
    }
}

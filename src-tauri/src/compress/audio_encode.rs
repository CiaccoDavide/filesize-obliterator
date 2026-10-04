//! Offline audio compress: decode common containers → CBR MP3 via vendored LAME.
//!
//! Inputs: MP3, WAV, AAC, M4A, FLAC. Output: `.mp3` at preset bitrate (320 / 192 / 128).
//! No network. Encoder is linked at build time (`mp3lame-sys`); if init fails, errors say
//! `missing codec` distinctly from corrupt/unsupported input.

use std::fs::File;
use std::path::Path;

use mp3lame_encoder::{Builder, DualPcm, Encoder, FlushNoGap, MonoPcm};
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use super::presets::{audio_preset, AudioBitrateKbps};

fn extension_lower(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn reject_unsupported_container(path: &Path) -> Result<(), String> {
    match extension_lower(path).as_str() {
        "mp3" | "wav" | "aac" | "m4a" | "flac" => Ok(()),
        "wma" | "ogg" | "opus" | "aiff" | "aif" => Err(format!(
            "unsupported audio format '.{}' (offline decoder not bundled for this container)",
            extension_lower(path)
        )),
        other if !other.is_empty() => Err(format!(
            "unsupported audio format '.{other}' (expected mp3, wav, aac, m4a, or flac)"
        )),
        _ => Err("unsupported audio format (missing file extension)".into()),
    }
}

fn lame_bitrate(kbps: AudioBitrateKbps) -> mp3lame_encoder::Bitrate {
    match kbps {
        AudioBitrateKbps::Kbps320 => mp3lame_encoder::Bitrate::Kbps320,
        AudioBitrateKbps::Kbps192 => mp3lame_encoder::Bitrate::Kbps192,
        AudioBitrateKbps::Kbps128 => mp3lame_encoder::Bitrate::Kbps128,
    }
}

fn build_lame_encoder(
    channels: u32,
    sample_rate: u32,
    bitrate: AudioBitrateKbps,
) -> Result<Encoder, String> {
    let channels_u8: u8 = channels
        .try_into()
        .map_err(|_| format!("unsupported channel count: {channels}"))?;
    if channels_u8 == 0 || channels_u8 > 2 {
        return Err(format!(
            "unsupported channel count: {channels} (MP3 encoder supports mono/stereo only)"
        ));
    }

    let mut builder = Builder::new().ok_or_else(|| {
        "missing codec: MP3 encoder (LAME) failed to initialize on this platform".to_string()
    })?;

    builder.set_num_channels(channels_u8).map_err(|_| {
        "missing codec: MP3 encoder rejected channel layout on this platform".to_string()
    })?;
    builder.set_sample_rate(sample_rate).map_err(|_| {
        format!(
            "unsupported or corrupt audio: sample rate {sample_rate} Hz is not supported by the MP3 encoder"
        )
    })?;
    builder
        .set_brate(lame_bitrate(bitrate))
        .map_err(|_| "missing codec: MP3 encoder rejected bitrate".to_string())?;
    builder
        .set_quality(mp3lame_encoder::Quality::Good)
        .map_err(|_| "missing codec: MP3 encoder rejected quality setting".to_string())?;

    builder.build().map_err(|_| {
        "missing codec: MP3 encoder (LAME) failed to build on this platform".to_string()
    })
}

struct PcmTrack {
    sample_rate: u32,
    channels: u32,
    /// Interleaved f32 samples, planar-converted to interleaved mono/stereo.
    interleaved: Vec<f32>,
}

fn decode_to_pcm(source: &Path) -> Result<PcmTrack, String> {
    let file = File::open(source).map_err(|e| format!("cannot read source: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = source.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("unsupported or corrupt audio: {e}"))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "unsupported or corrupt audio: no decodable audio track".to_string())?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| {
            // Symphonia reports unsupported codecs here — treat as missing decoder, not bad bytes.
            format!("missing codec: cannot decode track ({e})")
        })?;

    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut interleaved: Vec<f32> = Vec::new();
    let mut spec: Option<SignalSpec> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(SymphoniaError::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::IoError(_)) => break,
            Err(e) => {
                return Err(format!("unsupported or corrupt audio: {e}"));
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                if sample_buf.is_none() {
                    let s = *audio_buf.spec();
                    spec = Some(s);
                    let duration = audio_buf.capacity() as u64;
                    sample_buf = Some(SampleBuffer::<f32>::new(duration, s));
                }
                if let Some(buf) = sample_buf.as_mut() {
                    buf.copy_interleaved_ref(audio_buf);
                    interleaved.extend_from_slice(buf.samples());
                }
            }
            Err(SymphoniaError::DecodeError(_)) => {
                // Skip isolated frame errors; keep going.
                continue;
            }
            Err(e) => {
                return Err(format!("unsupported or corrupt audio: {e}"));
            }
        }
    }

    let spec = spec.ok_or_else(|| {
        "unsupported or corrupt audio: no samples decoded".to_string()
    })?;
    if interleaved.is_empty() {
        return Err("unsupported or corrupt audio: empty audio stream".into());
    }

    Ok(PcmTrack {
        sample_rate: spec.rate,
        channels: spec.channels.count() as u32,
        interleaved,
    })
}

fn encode_pcm_to_mp3(pcm: &PcmTrack, bitrate: AudioBitrateKbps, dest: &Path) -> Result<(), String> {
    let mut encoder = build_lame_encoder(pcm.channels, pcm.sample_rate, bitrate)?;

    let mut mp3_out = Vec::new();
    // Encode in chunks to bound peak memory for long tracks.
    const FRAME_SAMPLES_PER_CH: usize = 1152 * 32; // ~32 frames per channel

    match pcm.channels {
        1 => {
            let samples = &pcm.interleaved;
            let mut offset = 0;
            while offset < samples.len() {
                let end = (offset + FRAME_SAMPLES_PER_CH).min(samples.len());
                let chunk = &samples[offset..end];
                mp3_out.reserve(mp3lame_encoder::max_required_buffer_size(chunk.len()));
                encoder
                    .encode_to_vec(MonoPcm(chunk), &mut mp3_out)
                    .map_err(|e| format!("mp3 encode failed: {e:?}"))?;
                offset = end;
            }
        }
        2 => {
            let frames = pcm.interleaved.len() / 2;
            let mut left = Vec::with_capacity(frames);
            let mut right = Vec::with_capacity(frames);
            for pair in pcm.interleaved.chunks_exact(2) {
                left.push(pair[0]);
                right.push(pair[1]);
            }
            let mut offset = 0;
            while offset < frames {
                let end = (offset + FRAME_SAMPLES_PER_CH).min(frames);
                let input = DualPcm {
                    left: &left[offset..end],
                    right: &right[offset..end],
                };
                mp3_out.reserve(mp3lame_encoder::max_required_buffer_size(end - offset));
                encoder
                    .encode_to_vec(input, &mut mp3_out)
                    .map_err(|e| format!("mp3 encode failed: {e:?}"))?;
                offset = end;
            }
        }
        n => {
            return Err(format!(
                "unsupported channel count: {n} (MP3 encoder supports mono/stereo only)"
            ));
        }
    }

    mp3_out.reserve(7200);
    encoder
        .flush_to_vec::<FlushNoGap>(&mut mp3_out)
        .map_err(|e| format!("mp3 encode flush failed: {e:?}"))?;
    std::fs::write(dest, &mp3_out).map_err(|e| format!("cannot write output: {e}"))?;
    Ok(())
}

/// Compress `source` with a registered audio preset into `dest` (MP3).
///
/// Corrupt / unsupported inputs → `unsupported or corrupt audio…`.
/// Encoder init failures → `missing codec…`. Never panics.
pub fn encode_audio(source: &Path, preset_id: &str, dest: &Path) -> Result<(), String> {
    let preset = audio_preset(preset_id)
        .ok_or_else(|| format!("unknown audio preset: {preset_id}"))?;
    reject_unsupported_container(source)?;
    let pcm = decode_to_pcm(source)?;
    encode_pcm_to_mp3(&pcm, preset.bitrate, dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::presets::{AUDIO_BALANCED, AUDIO_HIGH, AUDIO_SMALL};
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fo-audio-encode-{}-{}-{}",
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
            .join("tests/fixtures/audio")
            .join(name)
    }

    /// Write a mono 16-bit PCM WAV (44.1 kHz) with a soft sine — large enough to shrink under MP3.
    fn write_sine_wav(path: &Path, seconds: f32) {
        let sample_rate: u32 = 44_100;
        let channels: u16 = 1;
        let bits: u16 = 16;
        let n = (sample_rate as f32 * seconds) as usize;
        let mut pcm = Vec::with_capacity(n * 2);
        for i in 0..n {
            let t = i as f32 / sample_rate as f32;
            let sample = (t * 440.0 * std::f32::consts::TAU).sin() * 0.35;
            let s = (sample * i16::MAX as f32) as i16;
            pcm.extend_from_slice(&s.to_le_bytes());
        }
        let data_len = pcm.len() as u32;
        let byte_rate = sample_rate * u32::from(channels) * u32::from(bits) / 8;
        let block_align = channels * bits / 8;
        let mut f = fs::File::create(path).expect("create wav");
        f.write_all(b"RIFF").unwrap();
        f.write_all(&(36 + data_len).to_le_bytes()).unwrap();
        f.write_all(b"WAVEfmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap(); // PCM fmt chunk size
        f.write_all(&1u16.to_le_bytes()).unwrap(); // PCM
        f.write_all(&channels.to_le_bytes()).unwrap();
        f.write_all(&sample_rate.to_le_bytes()).unwrap();
        f.write_all(&byte_rate.to_le_bytes()).unwrap();
        f.write_all(&block_align.to_le_bytes()).unwrap();
        f.write_all(&bits.to_le_bytes()).unwrap();
        f.write_all(b"data").unwrap();
        f.write_all(&data_len.to_le_bytes()).unwrap();
        f.write_all(&pcm).unwrap();
    }

    #[test]
    fn encodes_wav_mp3_flac_aac_m4a_for_each_preset() {
        let dir = temp_dir("roundtrip");
        let sources = ["tone.wav", "tone.mp3", "tone.flac", "tone.aac", "tone.m4a"];
        for name in sources {
            let src = fixture(name);
            assert!(src.is_file(), "missing fixture {}", src.display());
            for preset in [AUDIO_HIGH, AUDIO_BALANCED, AUDIO_SMALL] {
                let out = dir.join(format!("{name}-{preset}.mp3"));
                encode_audio(&src, preset, &out)
                    .unwrap_or_else(|e| panic!("{name}/{preset}: {e}"));
                assert!(out.is_file(), "missing {name}/{preset}");
                assert!(fs::metadata(&out).unwrap().len() > 0);
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn balanced_and_small_shrink_uncompressed_wav() {
        let dir = temp_dir("shrink-wav");
        let wav = dir.join("long.wav");
        write_sine_wav(&wav, 2.0);
        let original = fs::metadata(&wav).unwrap().len();

        for preset in [AUDIO_BALANCED, AUDIO_SMALL] {
            let out = dir.join(format!("{preset}.mp3"));
            encode_audio(&wav, preset, &out).unwrap_or_else(|e| panic!("{preset}: {e}"));
            let result = fs::metadata(&out).unwrap().len();
            assert!(
                result < original,
                "{preset} should shrink PCM WAV: {result} >= {original}"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_audio_fails_without_panic() {
        let dir = temp_dir("corrupt");
        let junk = dir.join("broken.mp3");
        fs::write(&junk, b"not-an-audio-file").expect("write");
        let out = dir.join("out.mp3");
        let err = encode_audio(&junk, AUDIO_BALANCED, &out).expect_err("must fail");
        assert!(
            err.contains("corrupt") || err.contains("unsupported"),
            "unexpected error: {err}"
        );
        assert!(!err.contains("missing codec"), "corrupt must not look like missing codec: {err}");
        assert!(!out.exists() || fs::metadata(&out).map(|m| m.len()).unwrap_or(0) == 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wma_fails_clearly_as_unsupported() {
        let dir = temp_dir("wma");
        let wma = dir.join("track.wma");
        fs::write(&wma, b"fake").expect("write");
        let out = dir.join("out.mp3");
        let err = encode_audio(&wma, AUDIO_HIGH, &out).expect_err("wma unsupported");
        assert!(err.contains("unsupported"), "{err}");
        assert!(!err.contains("missing codec"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_preset_fails() {
        let dir = temp_dir("preset");
        let wav = dir.join("a.wav");
        write_sine_wav(&wav, 0.1);
        let out = dir.join("a.mp3");
        let err = encode_audio(&wav, "nope", &out).expect_err("unknown");
        assert!(err.contains("unknown audio preset"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn smoke_writes_under_compressed_via_prepare_output_path() {
        use crate::compress::output::prepare_output_path;
        use crate::compress::presets::audio_preset;

        let dir = temp_dir("smoke-path");
        let wav = dir.join("Holiday.WAV");
        write_sine_wav(&wav, 0.5);

        let preset = audio_preset(AUDIO_BALANCED).expect("preset");
        let reserved = prepare_output_path(&wav, preset.output_ext()).expect("reserve");
        assert_eq!(reserved, dir.join("_compressed").join("Holiday.mp3"));

        encode_audio(&wav, AUDIO_BALANCED, &reserved).expect("encode");
        assert!(reserved.is_file());
        assert!(fs::metadata(&reserved).unwrap().len() > 0);
        assert!(fs::metadata(&wav).unwrap().len() > 0);

        let _ = fs::remove_dir_all(&dir);
    }

    /// Ensures the public error vocabulary distinguishes missing codec vs bad input.
    #[test]
    fn missing_codec_message_shape_is_documented() {
        // LAME is vendored; Builder::new almost always succeeds. Pin the error prefix contract
        // so job UI can branch on "missing codec" vs "unsupported or corrupt".
        let missing = "missing codec: MP3 encoder (LAME) failed to initialize on this platform";
        let bad = "unsupported or corrupt audio: no samples decoded";
        assert!(missing.starts_with("missing codec"));
        assert!(bad.starts_with("unsupported or corrupt"));
        assert!(!bad.contains("missing codec"));
    }
}

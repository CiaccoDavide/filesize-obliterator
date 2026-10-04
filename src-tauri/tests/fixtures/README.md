# Test fixtures

Small synthetic media used by offline smoke / encode tests. All files are generated locally for this repo (no third-party copyrighted content).

| Kind | Path | Notes |
|------|------|-------|
| Image | `image/sample.png` | 1×1 RGB PNG |
| Audio | `audio/tone.*` | Short sine tones (WAV/MP3/FLAC/AAC/M4A) + ALAC negative case |
| Video | `video/tone.*` | Short synthetic clips (MP4/WebM/MKV) |
| PDF | `pdf/minimal.pdf` | One-page text PDF |

Tests copy fixtures into temp dirs before encoding so paths stay machine-independent. Video/PDF encode tests soft-skip (pass with an `ignoring test: missing tool…` reason on stderr) when `ffmpeg` / Ghostscript are not available.

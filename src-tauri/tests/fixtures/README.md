# Test fixtures

Small synthetic media used by offline smoke / encode tests. All files are generated locally for this repo (no third-party copyrighted content).

| Kind | Path | Notes |
|------|------|-------|
| Image | `image/sample.png` | 1×1 RGB PNG |
| Audio | `audio/tone.*` | Short sine tones (WAV/MP3/FLAC/AAC/M4A) + ALAC negative case |
| Video | `video/tone.*` | Short synthetic clips (MP4/WebM/MKV) |
| PDF | `pdf/minimal.pdf` | One-page text PDF |

Tests copy fixtures into temp dirs before encoding so paths stay machine-independent. Video encode tests soft-skip when `ffmpeg` is missing (hard-fail under `FO_REQUIRE_ENCODERS=1`). PDF encode tests soft-skip when Ghostscript is not on PATH / `GS_PATH` — including under `FO_REQUIRE_ENCODERS=1` (AGPL PATH-only exception; Ghostscript is not bundled).

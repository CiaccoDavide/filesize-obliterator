---
title: Offline audio compression with multiple bitrate alternatives
labels: [enhancement]
depends_on: [005, 006]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Compress common audio formats offline with several bitrate/quality alternatives; write results into `_compressed`.

**Current behavior:**  
Job IPC and path rules exist; no audio encoders.

**Desired behavior:**  
Supported inputs include at least MP3, WAV, AAC/M4A, FLAC (decode where needed). Alternatives offer distinct size/quality tradeoffs (e.g. 320 / 192 / 128 kbps-class or VBR equivalents). Use local codecs only (bundled CLI sidecar and/or Rust crates). Must not call network services.

**Key interfaces:**
- Preset registry entries with `kind: "audio"`
- Job runner dispatches audio presets to the audio pipeline
- Clear failure when a codec is missing on a platform

**Acceptance criteria:**
- [ ] At least three audio alternatives are available
- [ ] Compressed file is written under `_compressed`
- [ ] Works offline
- [ ] Job failure messages name missing codec vs bad input
- [ ] App remains responsive (work off the UI thread / async Rust)

**Out of scope:**
- Multi-track editors, trimming UI
- Streaming/radio encoding
- DRM-protected files

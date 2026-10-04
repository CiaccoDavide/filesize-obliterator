---
title: Offline video compression with multiple quality alternatives
labels: [enhancement]
depends_on: [005, 006]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Compress common video formats offline with several quality/size alternatives; write results into `_compressed`.

**Current behavior:**  
Job IPC and path rules exist; no video encoders.

**Desired behavior:**  
Supported inputs include at least MP4 and WebM/MKV where demuxers allow. Alternatives cover distinct targets (e.g. “social small”, “balanced”, “high”). Prefer a well-known local encoder stack (e.g. bundled ffmpeg) declared as a dependency of the desktop bundle so the feature works offline after install. Progress events should update during long encodes.

**Key interfaces:**
- Preset registry entries with `kind: "video"`
- Progress hooks from the encoder into existing job events
- Documented list of supported containers/codecs

**Acceptance criteria:**
- [ ] At least three video alternatives exist
- [ ] Long encodes emit progress (not only 0% then 100%)
- [ ] Output under `_compressed`; source untouched
- [ ] Works offline with bundled/local tools
- [ ] Cancel cooperatively stops the encode

**Out of scope:**
- Timeline editing, cropping UI
- Hardware-encoder tuning beyond sensible defaults
- Streaming upload

---
title: Offline image compression with multiple quality alternatives
labels: [enhancement]
depends_on: [005, 006]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Compress common image formats offline with several selectable quality/size alternatives; write results into `_compressed`.

**Current behavior:**  
Job IPC and output path rules exist; no image encoders.

**Desired behavior:**  
Supported inputs include at least JPEG, PNG, WebP (and HEIC if feasible on-platform without online services; otherwise document unsupported). Offer multiple alternatives (e.g. high / balanced / small, or format-specific presets). Processing uses local libraries or bundled tools only — no cloud APIs. Each alternative has a stable id and human label for the UI.

**Key interfaces:**
- Preset registry entries: `{ id, label, kind: "image", description }`
- Encoder path invoked by the job runner for `kind == image`
- Output extension matches chosen format (e.g. `.jpg` / `.webp`)

**Acceptance criteria:**
- [ ] At least three image alternatives produce smaller or equal files on typical photos (document if a preset prioritizes quality over size)
- [ ] Works offline
- [ ] Outputs land in `_compressed` per path rules
- [ ] Corrupt/unsupported images fail the job without crashing the app
- [ ] Preset ids are stable strings the UI can list

**Out of scope:**
- Batch UI (later task)
- Lossless archival workflows beyond one optional “max quality” preset
- RAW camera pipelines

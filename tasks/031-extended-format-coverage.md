---
title: Extended format coverage (HEIC, GIF/animated WebP, more containers)
labels: [enhancement]
depends_on: [007, 008, 009]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Broaden supported inputs for common real-world files users actually drop.

**Current behavior:**  
Core formats only (JPEG/PNG/WebP, basic audio/video).

**Desired behavior:**  
Add best-effort offline support for: HEIC/HEIF (where platform decoders allow), animated GIF → compressed animated WebP or MP4 (document choice), TIFF, and additional video containers if the bundled encoder stack already demuxes them. Unsupported remainders still fail clearly. Update preset registry and docs.

**Key interfaces:**
- Expanded kind/extension maps
- Platform capability probe (e.g. HEIC unavailable → clear error)
- Fixtures + smokes for newly supported types where license allows

**Acceptance criteria:**
- [ ] At least HEIC **or** GIF animation path works offline on macOS (primary), with documented Windows/Linux behavior
- [ ] Unsupported variants error without crash
- [ ] README supported-formats table updated
- [ ] New types appear correctly in intake kind detection

**Out of scope:**
- Camera RAW full pipeline (CR2/NEF/DNG)
- DVD/Blu-ray structures

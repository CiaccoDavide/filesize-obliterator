---
title: Optional metadata strip (EXIF/GPS) on image and media compress
labels: [enhancement]
depends_on: [007, 008, 009]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Offer a privacy control to strip location and other sensitive metadata during compression, defaulting to a safe explicit choice.

**Current behavior:**  
Encoders may preserve or strip metadata inconsistently.

**Desired behavior:**  
A HUD toggle (session or per-batch): `STRIP METADATA`. When on, image EXIF/GPS and analogous tags on supported audio/video are removed from outputs. When off, preserve orientation and useful non-sensitive tags where the pipeline allows. Behavior documented per media kind. Offline only.

**Key interfaces:**
- Job option `stripMetadata: boolean`
- Preset/UI toggle bound into compress_start payloads
- Tests that GPS EXIF is absent when strip is on (fixture with GPS)

**Acceptance criteria:**
- [ ] Strip-on removes GPS/EXIF from a fixture JPEG output
- [ ] Strip-off preserves image orientation correctly when present
- [ ] Toggle state is visible before compress starts
- [ ] Unsupported strip for a kind fails soft (warn) rather than crashing

**Out of scope:**
- Full metadata editor
- Forensic guarantee against all steganographic channels

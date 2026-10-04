---
title: Dry-run size estimate before committing a compress batch
labels: [enhancement]
depends_on: [011, 013]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Let users preview estimated output sizes (and total savings) for the current selection and presets without writing files.

**Current behavior:**  
Compression starts immediately; users learn size outcomes only after encode.

**Desired behavior:**  
A `PREVIEW` / dry-run action estimates result bytes per item (heuristic or fast probe) and shows aggregate before/after. No files are written under `_compressed` during dry-run. Estimates are clearly labeled as estimates. Offline only.

**Key interfaces:**
- Command `compress_estimate` (or equivalent) returning `{ path, presetId, estimatedBytes, confidence }`
- UI summary strip: staged bytes → estimated bytes → Δ%

**Acceptance criteria:**
- [ ] Dry-run does not create or modify `_compressed` outputs
- [ ] UI shows per-item and aggregate estimates for the current presets
- [ ] Estimates are marked as approximate when not exact
- [ ] Works offline
- [ ] Starting a real compress still uses the same selected presets

**Out of scope:**
- Pixel-perfect quality simulation
- Cloud-based estimation

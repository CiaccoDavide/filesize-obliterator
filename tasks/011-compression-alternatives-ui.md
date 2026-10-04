---
title: Ice HUD UI to choose compression alternatives per file kind
labels: [enhancement]
depends_on: [003, 005, 007, 008, 009, 010]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Expose compression alternatives in the UI so the user can pick a preset before (or as) compression starts, with kind-aware options.

**Current behavior:**  
Presets exist in the backend registry; UI has no picker.

**Desired behavior:**  
For staged files, show available alternatives for that kind (image/audio/video/pdf). Selection is clear in Ice HUD chrome (micro labels, square controls — not soft pill tabs). Default preset is sensible (balanced). User can apply one preset to the whole selection of the same kind, or per-file if low complexity — prefer one global-per-kind default with optional per-file override if it stays simple.

**Key interfaces:**
- Command or query to list presets by kind from Rust (single source of truth)
- Staged file field: `presetId`
- Start action uses the selected preset(s)

**Acceptance criteria:**
- [ ] UI lists alternatives returned by the backend (not hard-coded duplicates that can drift)
- [ ] Changing selection updates which preset jobs use
- [ ] Unsupported kind shows no bogus presets
- [ ] Controls match Ice HUD patterns

**Out of scope:**
- Custom numeric sliders for every encoder flag
- A/B preview renderers for video

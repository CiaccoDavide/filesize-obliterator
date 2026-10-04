---
title: Custom preset builder for power users (local only)
labels: [enhancement]
depends_on: [011, 025]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Let users create and save named custom presets with a small set of safe parameters per media kind.

**Current behavior:**  
Only built-in alternatives.

**Desired behavior:**  
UI to clone a built-in preset and edit bounded fields (e.g. image quality 1–100, max edge length, audio bitrate, video CRF/height). Save to local settings. Custom presets appear in the alternatives list with a `CUSTOM` marker. Validation prevents insane values. Export/import as a local JSON file optional but nice.

**Key interfaces:**
- `CustomPreset` schema with `kind`, `params`, `id`, `label`
- Merge built-ins + customs in list_presets
- Delete/rename customs

**Acceptance criteria:**
- [ ] User can create a custom image preset and use it in a real compress job
- [ ] Customs persist across restarts
- [ ] Invalid params rejected with terse validation errors
- [ ] Built-ins remain immutable

**Out of scope:**
- Sharing presets to a marketplace
- Full ffmpeg filter graphs as free text (unsafe)

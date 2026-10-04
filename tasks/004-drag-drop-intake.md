---
title: Drag-and-drop intake for images, audio, video, and PDF
labels: [enhancement]
depends_on: [003]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Let users drop or pick files (images, audio, video, PDF) into an Ice HUD drop surface and stage them for compression.

**Current behavior:**  
Shell exists without file intake.

**Desired behavior:**  
Users can drag files onto a primary drop zone or use a native file picker. Accepted kinds: common image, audio, video, and PDF types. Rejected kinds show a terse HUD status (not a chatty modal). Staged files show path (monospace), kind, and size. Absolute paths must be available to the Rust side for writing `_compressed` next to originals (Tauri file-drop / dialog APIs that preserve filesystem paths).

**Key interfaces:**
- Staged file model: `{ id, path, name, kind, bytes, status }`
- Kind detection from extension + MIME where available: `image` | `audio` | `video` | `pdf` | `unsupported`
- Optional folder drop: either reject with clear status or expand to contained supported files (pick one; document it; prefer expanding one level of supported files if easy)

**Acceptance criteria:**
- [ ] Drag-and-drop of supported files stages them in the UI
- [ ] Native file picker can add the same kinds
- [ ] Unsupported files are not staged; user sees an operational status reason
- [ ] Staged entries expose a real filesystem path usable by Rust
- [ ] Drop zone matches Ice HUD visual language

**Out of scope:**
- Starting compression jobs
- Preset selection UI beyond a placeholder
- Network downloads / URL drops

---
title: Reveal original and `_compressed` outputs in the OS file manager
labels: [enhancement]
depends_on: [006, 012]
---

## Agent Brief

**Category:** enhancement  
**Summary:** From any staged or completed row, open Finder/Explorer/file manager at the file or `_compressed` folder.

**Current behavior:**  
Users must navigate manually to outputs.

**Desired behavior:**  
Actions: `REVEAL SOURCE`, `REVEAL OUTPUT`, `OPEN _COMPRESSED`. Use Tauri opener/shell plugin locally (no URLs). Disabled when path missing. Ice HUD tertiary buttons / row actions.

**Key interfaces:**
- Command wrapping platform reveal/open
- Row action menu or icon buttons

**Acceptance criteria:**
- [ ] Reveal source selects/highlights the original file in the OS file manager when supported
- [ ] Reveal output works after a successful job
- [ ] Open `_compressed` opens that directory for the item’s parent
- [ ] Missing paths show a terse status instead of crashing

**Out of scope:**
- In-app file browser replacing the OS
- Cloud drive deep links

---
title: Offline watch-folder mode for automatic compression
labels: [enhancement]
depends_on: [013, 025, 023]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Watch a user-selected folder and auto-enqueue new supported files with the default presets.

**Current behavior:**  
Only manual drop/picker intake.

**Desired behavior:**  
User enables `WATCH`, picks a directory. New files (and optionally files already present on enable — default off) enqueue using default per-kind presets and skip-already-compressed rules. Writes still go to that folder’s `_compressed`. Stop watch on disable or app quit. Purely local filesystem watching; no cloud sync APIs.

**Key interfaces:**
- Start/stop watch commands
- Debounce for incomplete copies (size-stable window)
- Status `WATCHING` in HUD

**Acceptance criteria:**
- [ ] Dropping a new supported file into the watched folder eventually enqueues and compresses it
- [ ] Incomplete copies are not compressed mid-write (debounce/size-stable)
- [ ] Watch stops cleanly when disabled
- [ ] Works offline

**Out of scope:**
- Watching entire home directory recursively unbounded
- Network share reliability guarantees

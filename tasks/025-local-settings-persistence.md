---
title: Persist local settings (defaults, concurrency, last presets)
labels: [enhancement]
depends_on: [011, 013]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Remember user preferences on disk locally so the next offline session starts where they left off.

**Current behavior:**  
Defaults reset every launch.

**Desired behavior:**  
Persist: default preset per kind, concurrency limit, strip-metadata flag, last window size (if cheap), UI density toggles if any. Store in app config dir via Tauri store/fs — never a remote account. Invalid/corrupt settings fall back to defaults without crashing.

**Key interfaces:**
- Settings schema versioned (`version` field)
- Load on startup; save on change (debounced)
- Settings panel in Ice HUD (compact)

**Acceptance criteria:**
- [ ] Changing default image preset survives app restart
- [ ] Concurrency setting is applied to the queue on next run
- [ ] Corrupt settings file recovers to defaults
- [ ] No network calls for sync

**Out of scope:**
- Multi-profile sync
- Cloud backup of settings

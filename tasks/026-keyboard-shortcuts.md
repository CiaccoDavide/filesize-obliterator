---
title: Keyboard shortcuts for intake, compress, abort, and clear
labels: [enhancement]
depends_on: [004, 013, 014]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Add a small set of discoverable keyboard shortcuts for power users.

**Current behavior:**  
Pointer-only primary flows.

**Desired behavior:**  
Shortcuts (platform-aware modifiers): open file picker, start compress, abort all, clear completed, focus drop zone, open settings. Show a `KEYS` overlay (`?`) listing bindings in Ice HUD monospace. Do not steal typing from inputs.

**Key interfaces:**
- Central shortcut map
- Help overlay component

**Acceptance criteria:**
- [ ] Documented shortcuts work on macOS and are remapped sensibly on Windows/Linux
- [ ] `?` shows the cheat sheet
- [ ] Shortcuts do not fire while typing in text fields
- [ ] Abort shortcut confirms or is hard-bound only when jobs are running (pick one; document)

**Out of scope:**
- Fully user-rebindable keymap editor
- Vim modes

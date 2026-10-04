---
title: First-run Ice HUD briefing overlay
labels: [enhancement]
depends_on: [003, 004, 025]
---

## Agent Brief

**Category:** enhancement  
**Summary:** On first launch, show a short operational briefing: drop files, pick alternative, outputs land in `_compressed`, app is offline-only.

**Current behavior:**  
Empty first screen with no guidance.

**Desired behavior:**  
One-time overlay (3–4 terse steps) dismissible via `ACKNOWLEDGE`. Persist “seen” in local settings. Re-openable from a `HELP` / `BRIEFING` control. No marketing carousel, no remote content.

**Key interfaces:**
- Setting `briefingSeen: boolean`
- Overlay copy in operational voice

**Acceptance criteria:**
- [ ] First launch shows the briefing once
- [ ] After ACK, it does not reappear unless user reopens help
- [ ] Copy states offline + `_compressed` behavior accurately
- [ ] Overlay matches Ice HUD framing

**Out of scope:**
- Interactive product tour with spotlights on every button
- Localized translations (unless already in project)

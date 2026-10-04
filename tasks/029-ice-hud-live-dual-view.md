---
title: Ice HUD live dual view (file tree + topology graph)
labels: [enhancement]
depends_on: [012, 013]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Upgrade the ops surface to the Ice HUD live dual view: monospace file tree + Three.js topology graph sharing one asset list and selection.

**Current behavior:**  
Progress surface is list/meters oriented.

**Desired behavior:**  
Implement the layout and behaviors from `.cursor/skills/ice-hud/live-surface.md`: shared `Asset` list (path, kind, bytes, status), tree | graph grid, kind colors, selection sync, sparse preview/inspect overlays. Nodes stay flat billboards with bounded screen size. Still offline; no remote textures.

**Key interfaces:**
- Single React store feeding tree + graph
- Kind theme map for image/audio/video/pdf/unsupported
- Selection drives inspect panel (path, preset, bytes in/out)

**Acceptance criteria:**
- [ ] Tree and graph always show the same staged/completed assets
- [ ] Selecting in either view selects in both
- [ ] Kind colors/glyphs are consistent
- [ ] Viewport-locked ops layout matches Ice HUD live grid chrome
- [ ] Graph remains usable with dozens of assets (instancing / flat billboards)

**Out of scope:**
- Editing the filesystem from the graph
- Physics simulations / heavy meshes

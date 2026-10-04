---
title: Apply Ice HUD shell and design tokens to the app UI
labels: [enhancement]
depends_on: [001]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Restyle the app chrome using the Ice HUD system (tokens, typography, frames, atmosphere).

**Current behavior:**  
Scaffold UI is unstyled or default Vite/React.

**Desired behavior:**  
The first viewport reads as an Ice HUD instrument panel: cool near-black atmosphere, ice accent, square `.hud-frame` chrome, Exo 2 + JetBrains Mono (bundled), micro uppercase labels, brand-mark for the product name. Follow the project Ice HUD skill (`.cursor/skills/ice-hud/`) — load/merge `tokens.css`, use patterns from `patterns.md`.

**Key interfaces:**
- Global CSS variables from Ice HUD `tokens.css`
- App shell layout: brand + primary work surface ready for drop zone / ops panels
- No purple SaaS, glow blooms, rounded pills, or soft card stacks

**Acceptance criteria:**
- [ ] Ice HUD CSS variables are the only palette in use for chrome
- [ ] Exo 2 and JetBrains Mono are loaded from local assets
- [ ] Product name appears as a hero-level brand-mark on the main screen
- [ ] Panels use square frames / corner ticks per Ice HUD patterns
- [ ] Default Vite scaffolding styles are removed or overridden

**Out of scope:**
- Drag-drop interaction (next task)
- 3D topology graph (optional later; only if a live file set warrants it)
- Compression logic

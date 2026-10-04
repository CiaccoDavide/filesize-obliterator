---
title: Keyboard focus, contrast, and screen-reader basics for HUD UI
labels: [enhancement]
depends_on: [003, 011, 026]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Make primary flows usable via keyboard and assistive tech without abandoning Ice HUD aesthetics.

**Current behavior:**  
HUD UI may lack focus rings, labels, and roles.

**Desired behavior:**  
Visible focus states (ice accent outline, square). Icon-only controls have `aria-label`. Live status regions announce job completion. Tab order follows drop → presets → start → queue. Do not rely on color alone for success/fail (include text status). Keep offline; no third-party a11y SaaS.

**Key interfaces:**
- Focus styles in CSS tokens
- ARIA on drop zone, buttons, listbox/options for presets

**Acceptance criteria:**
- [ ] Full compress of a staged file is possible keyboard-only
- [ ] Focus is always visible on interactive elements
- [ ] Success/fail distinguishable without color alone
- [ ] Drop zone and primary actions have accessible names

**Out of scope:**
- Full WCAG audit certification
- High-contrast theme marketplace

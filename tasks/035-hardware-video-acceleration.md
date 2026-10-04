---
title: Optional hardware-accelerated video encode when available
labels: [enhancement]
depends_on: [009, 025]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Use platform hardware encoders when present to speed video jobs, with a software fallback.

**Current behavior:**  
Video encode is CPU-only (or unspecified).

**Desired behavior:**  
Detect available HW encoders (VideoToolbox / NVENC / QSV / AMF as applicable via the bundled toolchain). Setting: `Prefer hardware`. If HW init fails, fall back to software and log `HW FALLBACK`. Quality presets remain the user-facing alternatives; HW is an acceleration path, not a separate quality product.

**Key interfaces:**
- Capability probe command for UI status (`HW: READY | UNAVAILABLE`)
- Encoder args selection in the video pipeline
- Setting persistence

**Acceptance criteria:**
- [ ] On a machine with HW encode, prefer-hardware completes a smoke MP4 faster or at least successfully via HW path
- [ ] On machines without HW, software path still works
- [ ] Fallback is visible in the log/status stream
- [ ] Still offline

**Out of scope:**
- Guaranteeing bit-exact parity with software encodes
- Overclocking / power management UI

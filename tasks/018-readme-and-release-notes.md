---
title: README, usage docs, and first-release checklist
labels: [enhancement]
depends_on: [016]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Write user-facing and contributor docs for installing, using offline, and cutting a first desktop release.

**Current behavior:**  
Minimal run instructions may exist from scaffold; product usage is undocumented.

**Desired behavior:**  
Root README covers: what the app does, offline guarantee, supported file kinds, `_compressed` output behavior, preset overview, platform install links/instructions, dev setup, and architecture sketch (React UI ↔ Tauri ↔ Rust jobs). Include a short first-release checklist (version bump, changelog, build artifacts, manual smoke on each OS). Voice can be clearer than Ice HUD UI copy but stay concise.

**Key interfaces:**
- `README.md`
- Optional `docs/usage.md` if README would exceed a readable length
- Changelog or Releases notes template

**Acceptance criteria:**
- [ ] A new user can install and compress a sample image from the docs alone
- [ ] Offline + `_compressed` behavior is explicit
- [ ] Dev setup matches the actual toolchain
- [ ] First-release checklist is actionable
- [ ] No references to online compression services

**Out of scope:**
- Marketing site
- Localized docs
- Video tutorials

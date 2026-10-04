---
title: Multiplatform desktop packaging (macOS, Windows, Linux)
labels: [enhancement]
depends_on: [002, 014, 015]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Produce installable offline desktop bundles for macOS, Windows, and Linux that include required local codecs/tools.

**Current behavior:**  
`tauri build` may not yet bundle sidecars or be documented per OS.

**Desired behavior:**  
Documented build commands produce platform artifacts (DMG/app, MSI/NSIS, AppImage/deb as appropriate for Tauri defaults). Bundles include whatever local encoder sidecars the media pipelines need so a clean machine with no network can compress after install. App id, icons, and product name are set. Code signing/notarization may be documented as optional maintainer steps when secrets are unavailable.

**Key interfaces:**
- Tauri bundle configuration
- Sidecar/resource install paths resolved at runtime offline
- Per-OS notes in docs

**Acceptance criteria:**
- [ ] macOS, Windows, and Linux build instructions exist and match the config
- [ ] Built app runs compression smoke for at least images without network
- [ ] Bundled tools are found by the Rust layer without developer-only PATH hacks
- [ ] Icons and product metadata are present
- [ ] Offline constraint preserved in release builds

**Out of scope:**
- App Store / Microsoft Store submission
- Auto-update channels
- Mobile

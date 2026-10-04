---
title: Enforce offline-only runtime (no network, no online services)
labels: [enhancement]
depends_on: [001]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Guarantee the app never requires or uses internet connectivity or online services at runtime.

**Current behavior:**  
A scaffolded Tauri app may still allow webview network access, remote font CDNs, auto-updaters, or analytics by default.

**Desired behavior:**  
The shipped and development app works with network interfaces disabled. No requests leave the device for app features. Fonts, WASM, codecs, and assets are local. Updaters and telemetry are disabled or absent. CSP and Tauri security capabilities deny outbound network for the webview unless strictly required for `tauri://` / asset protocol.

**Key interfaces:**
- Content Security Policy / Tauri capabilities that block remote HTTP(S)
- Bundled fonts (Ice HUD uses Exo 2 + JetBrains Mono — must be local files, not Google Fonts CDN)
- Explicit “offline” product constraint documented for contributors
- No cloud compression APIs, no license phone-home, no crash reporters that need network

**Acceptance criteria:**
- [ ] App UI and compression flows function with the machine offline
- [ ] No runtime dependency on remote CDNs for fonts, scripts, or styles
- [ ] Auto-update / remote plugin endpoints are disabled or not configured
- [ ] CSP (or equivalent) blocks unexpected remote fetches from the webview
- [ ] README states the offline-only product constraint

**Out of scope:**
- Offline packaging of every optional codec binary (covered per media task)
- Air-gapped CI runners
- Blocking the OS from all process network at kernel level

---
title: Offline before/after image preview for compressed stills
labels: [enhancement]
depends_on: [007, 012]
---

## Agent Brief

**Category:** enhancement  
**Summary:** After (or during) image compression, show an Ice HUD compare view of original vs output without network.

**Current behavior:**  
Users only see paths and byte counts for images.

**Desired behavior:**  
Selecting a completed image job opens a local preview: original and compressed side-by-side or with a wipe slider. Loads via Tauri asset/convert-file-src from disk paths. Shows dimensions and bytes under each pane. No remote image hosts.

**Key interfaces:**
- Preview panel keyed by `sourcePath` + `outputPath`
- Safe local URL conversion for webview
- Keyboard/escape to dismiss overlay

**Acceptance criteria:**
- [ ] User can visually compare original vs compressed for a successful image job
- [ ] Preview works offline from filesystem paths
- [ ] Overlay uses Ice HUD framing (not a soft marketing lightbox)
- [ ] Closing preview returns to the ops surface without losing queue state

**Out of scope:**
- Video scrubbing previews
- PDF page raster compare (optional later)

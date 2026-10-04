---
title: Skip or warn when a source was already compressed to `_compressed`
labels: [enhancement]
depends_on: [006, 013]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Detect re-drops of the same source and avoid useless duplicate work via content/path awareness.

**Current behavior:**  
Re-compressing the same file always creates another collided filename.

**Desired behavior:**  
Before enqueue, detect existing outputs for the same source+preset (by deterministic naming and/or content hash sidecar). Options: skip (default), force re-encode. UI marks skipped items as `SKIPPED` with reason. Still offline; no cloud dedupe.

**Key interfaces:**
- Lookup helper: `(source, presetId) -> existingOutput | none`
- Queue item status `skipped`
- User control: `Force` on selection

**Acceptance criteria:**
- [ ] Re-running the same source+preset skips by default when output exists
- [ ] Force mode creates a new file per collision policy
- [ ] Skipped items appear in the batch summary
- [ ] Behavior documented in README/usage notes

**Out of scope:**
- Cross-machine sync of hashes
- Deduping visually similar photos

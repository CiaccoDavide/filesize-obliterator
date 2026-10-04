---
title: Auto-save outputs into `_compressed` beside the original file
labels: [enhancement]
depends_on: [005]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Always write compressed outputs into a `_compressed` directory in the original file’s parent path, without prompting for a save location.

**Current behavior:**  
Job IPC exists without a fixed output path convention.

**Desired behavior:**  
For source `/path/to/Photo.JPG`, outputs land under `/path/to/_compressed/` (create directory if missing). Filename strategy: preserve stem, use an extension appropriate to the chosen codec/preset, avoid silent overwrite (suffix `_2`, `_3`, … or include preset slug — pick one deterministic rule and document it). Never write into the source file in place. If `_compressed` cannot be created (permissions), fail the job with a clear error.

**Key interfaces:**
- Pure path helper (unit-testable): `(source_path, preset_or_ext) -> output_path`
- Directory creation on first write
- Collision policy documented and tested

**Acceptance criteria:**
- [ ] Successful jobs write only under `<parent>/_compressed/`
- [ ] Directory is created when absent
- [ ] Colliding names do not overwrite existing files
- [ ] Source file remains unchanged
- [ ] Unit tests cover nested paths, unicode names, and collisions

**Out of scope:**
- User-configurable output roots
- Cloud sync / watched folders
- Deleting originals

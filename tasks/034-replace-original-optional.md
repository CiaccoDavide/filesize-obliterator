---
title: Optional replace-original flow with safety confirm
labels: [enhancement]
depends_on: [006, 014, 021]
---

## Agent Brief

**Category:** enhancement  
**Summary:** After a successful compress, optionally replace the original with the compressed file via an explicit, safe confirmation path.

**Current behavior:**  
Originals are never modified; outputs only land in `_compressed`.

**Desired behavior:**  
Per-item or batch action `REPLACE ORIGINAL`: move/rename original to a trash-safe backup (or OS trash), move compressed into the original’s path/name when formats match, or keep extension change explicit. Default remains non-destructive. Require typed confirm or dual-confirm in HUD (`CONFIRM REPLACE`). Never replace on failed/skipped jobs.

**Key interfaces:**
- Command `replace_original(jobId)` with preconditions
- UI confirm gate
- Undo within session if backup kept (best-effort)

**Acceptance criteria:**
- [ ] Default compress path still never touches originals
- [ ] Replace requires explicit confirmation
- [ ] Failed jobs cannot replace
- [ ] Format mismatches are blocked or clearly handled (no silently corrupt extensions)
- [ ] Documented as advanced/destructive

**Out of scope:**
- Silent “optimize in place” default
- Time Machine / system-wide undelete guarantees

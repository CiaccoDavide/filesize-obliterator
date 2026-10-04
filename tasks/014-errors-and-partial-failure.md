---
title: Error handling and partial-failure UX for batch compress
labels: [enhancement]
depends_on: [013]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Make failures operationally clear when some files succeed and others fail; never leave the UI stuck.

**Current behavior:**  
Queue may surface raw errors inconsistently.

**Desired behavior:**  
Partial batch success is a first-class outcome: succeeded count, failed count, each failure with path + reason. Temp/partial output files from failed encodes are cleaned up or never promoted to final names. Permissions errors, missing codecs, and unsupported types have distinct terse messages. User can dismiss/retry failed items without restaging successes.

**Key interfaces:**
- Batch summary object on queue completion
- Retry-failed action
- Cleanup policy for incomplete outputs

**Acceptance criteria:**
- [ ] A mixed success/failure batch shows both counts and per-item reasons
- [ ] Failed items can be retried
- [ ] No stuck `COMPRESSING` state after process/encoder crash (timeout or detection)
- [ ] Incomplete outputs are not presented as success paths
- [ ] Messages fit Ice HUD operational tone

**Out of scope:**
- Automatic bug reporting to a server
- Undo/delete of successful compressions

---
title: Disk space preflight before large video/PDF batches
labels: [enhancement]
depends_on: [009, 013, 019]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Refuse or warn when free disk space on the output volume is likely insufficient for the batch.

**Current behavior:**  
Encodes can fail mid-write with opaque OS errors.

**Desired behavior:**  
Before starting, estimate worst-case write needs (conservative multiple of sources or dry-run estimates) and compare to free space on the destination volume. If insufficient: block start with `DISK LOW` status and numbers. If tight: warn but allow override. Offline syscalls only.

**Key interfaces:**
- Free-space query for a path’s volume
- Preflight result `{ ok, freeBytes, neededBytes, mode: "block" | "warn" | "ok" }`

**Acceptance criteria:**
- [ ] Starting a batch on a nearly-full volume surfaces a clear disk warning/block
- [ ] Successful preflight does not materially delay small image batches
- [ ] Override path exists for warn mode
- [ ] Messages include free vs needed bytes

**Out of scope:**
- Quotas on network shares beyond what the OS reports
- Automatic cleanup of old `_compressed` files

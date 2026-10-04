---
title: Compression job model and Tauri IPC (commands + progress events)
labels: [enhancement]
depends_on: [001]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Define the Rust-owned compression job lifecycle and typed IPC so the UI can start jobs and observe progress offline.

**Current behavior:**  
Only a scaffold ping command exists (or equivalent).

**Desired behavior:**  
Rust owns long-running compress work. Frontend invokes commands to enqueue/start/cancel and subscribes to typed events for progress, logs, completion, and failure. Jobs are identifiable; progress includes percent or bytes-processed when knowable. Cancellation is cooperative and safe (no half-written final output left as the success path).

**Key interfaces:**
- Commands such as: `compress_start`, `compress_cancel`, `compress_list` (names flexible; contracts clear)
- Payload includes source path, media kind, chosen preset/alternative id, options
- Events: `progress` | `log` | `complete` | `failed` (or a single tagged event stream)
- Result on complete: output path(s), original bytes, result bytes, duration

**Acceptance criteria:**
- [ ] Frontend can start a job and receive progress events without polling HTTP
- [ ] Completion event includes output path and size stats
- [ ] Failure event includes a user-facing error string (terse, operational)
- [ ] Cancel stops further work for that job id
- [ ] IPC types are shared or mirrored so TS and Rust stay aligned

**Out of scope:**
- Concrete encoder implementations per media type
- UI polish for the live surface
- Persistence of job history across app restarts

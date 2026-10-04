---
title: Live Ice HUD progress surface for compression jobs
labels: [enhancement]
depends_on: [003, 005]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Show live operational status for running compress jobs (meters, status text, per-file state) in Ice HUD voice.

**Current behavior:**  
Jobs emit events; UI may not visualize them.

**Desired behavior:**  
Ops strip or panel shows job state: `AWAITING` / `COMPRESSING` / `COMPLETE` / `FAILED` / `ABORTING`. Per-file rows update from event stream. Monospace for paths and byte meters. Sparse motion (status tick, abort spinner) — no neon pulse. Optional: tree of staged/output paths sharing selection with a simple list if a full Three.js graph is overkill for v1; prefer list + meters unless the Ice HUD live-surface dual view is a natural fit.

**Key interfaces:**
- Subscribe to existing progress/complete/failed events
- Single source of truth for file/job rows in React state
- Abort control wired to cancel command

**Acceptance criteria:**
- [ ] Progress updates appear during a long job without refresh
- [ ] Completion shows output path and size delta when available
- [ ] Failures show terse error text
- [ ] Abort control transitions status to `ABORTING` then terminal state
- [ ] Copy voice stays operational (Ice HUD)

**Out of scope:**
- Historical analytics dashboards
- Full 3D topology graph unless already justified by staged asset volume

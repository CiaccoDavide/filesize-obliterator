---
title: Batch queue for multi-file compression
labels: [enhancement]
depends_on: [005, 011, 012]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Process multiple staged files as a queue with bounded concurrency, per-file presets, and aggregate progress.

**Current behavior:**  
Single-job start may exist; multi-file orchestration is undefined.

**Desired behavior:**  
User stages many files and starts compression once. Queue runs with a small concurrency limit (configurable constant, e.g. 1–2 for video-heavy workloads). Each item uses its preset. Aggregate meter reflects completed/total. Clearing the queue does not delete already written `_compressed` outputs. Re-adding the same source after success is allowed and follows collision rules for new outputs.

**Key interfaces:**
- Queue model: ordered items with job ids
- Start-all / cancel-all / cancel-one
- Concurrency limit enforced in Rust (preferred) or carefully in the frontend

**Acceptance criteria:**
- [ ] Multiple files compress in one user action
- [ ] Concurrency is bounded (never unbounded parallel ffmpeg storms)
- [ ] Per-file success/failure does not block unrelated items (unless explicitly sequential mode)
- [ ] Live surface reflects queue state
- [ ] Cancel-all stops outstanding work

**Out of scope:**
- Priority scheduling UI
- Distributed workers

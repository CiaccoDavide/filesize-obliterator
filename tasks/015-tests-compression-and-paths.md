---
title: Automated tests for path rules and compression pipelines
labels: [enhancement]
depends_on: [006, 007, 008, 009, 010]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Add automated tests that lock `_compressed` path behavior and smoke-test each media pipeline with small fixtures.

**Current behavior:**  
Features exist with little or no automated coverage.

**Desired behavior:**  
Rust unit tests cover output path helper and collision policy. Integration/smoke tests (Rust and/or TS) run offline against tiny fixture files for image, audio, video, and PDF presets (skip video smoke in environments missing the encoder with an explicit ignore reason). Frontend tests optional for staging model if cheap. Do not delete or weaken existing tests.

**Key interfaces:**
- Fixture directory of small sample media (license-compatible)
- Test commands documented in package/`cargo` scripts
- CI-friendly skips when optional native tools are absent

**Acceptance criteria:**
- [ ] Path helper tests cover collision and directory creation assumptions
- [ ] At least one automated smoke per media kind that is supported in the default dev setup
- [ ] Tests run offline
- [ ] `test` script(s) documented at repo root
- [ ] No flaky dependence on machine-specific absolute paths outside temp dirs

**Out of scope:**
- Full visual regression / screenshot suites
- Performance benchmarking gates

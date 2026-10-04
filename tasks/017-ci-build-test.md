---
title: CI pipeline for test and desktop build matrix
labels: [enhancement]
depends_on: [001, 015, 016]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Add CI that runs tests and verifies builds on the supported desktop platforms (as far as the host allows).

**Current behavior:**  
No CI config.

**Desired behavior:**  
On pull request / main: install toolchain, run lint/typecheck/tests offline-friendly, and build (or at least compile) the Tauri app for the runner OS. Prefer GitHub Actions. Cache Rust/Node dependencies. Optional matrix for macOS/Windows/Linux if secrets/minutes allow; minimum is one platform full build + `cargo test` / frontend tests. No deployment to online app services.

**Key interfaces:**
- Workflow file(s) under `.github/workflows/`
- Scripts reused from local `package.json` / `cargo` commands
- Clear skip rules for optional encoder-heavy jobs

**Acceptance criteria:**
- [ ] CI runs on PR and default branch pushes
- [ ] Unit/smoke tests execute in CI
- [ ] At least one desktop build or `tauri build` compile job succeeds on CI
- [ ] Workflow does not call third-party compression SaaS
- [ ] README links to CI status or documents how to read failures

**Out of scope:**
- Publishing artifacts to GitHub Releases automation (can be a follow-up)
- Signed release pipelines with store credentials

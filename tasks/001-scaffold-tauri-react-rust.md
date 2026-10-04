---
title: Scaffold Tauri 2 + React 19 + TypeScript + Vite + Rust app
labels: [enhancement]
depends_on: []
---

## Agent Brief

**Category:** enhancement  
**Summary:** Bootstrap the desktop app shell with Tauri 2, React 19, TypeScript, Vite, and a Rust backend crate ready for compression commands.

**Current behavior:**  
The repository has Ice HUD design assets under `.cursor/skills/ice-hud/` but no runnable application.

**Desired behavior:**  
A developer can install dependencies and launch a native window that loads a minimal React UI. The Rust side exposes at least one health/ping command callable from the frontend. Project tooling (package manager scripts, `cargo` workspace or Tauri src-tauri layout) is consistent and documented in the root README at a minimal “how to run” level.

**Key interfaces:**
- Tauri 2 app with React + TS + Vite frontend
- Rust command surface for future jobs (e.g. `ping` / `app_info` returning version)
- Dev scripts: `dev` (Tauri + Vite) and `build` (production bundle entrypoint)
- Product working title: **Filesize Obliterator** (or keep repo name if already branded)

**Acceptance criteria:**
- [ ] `npm`/`pnpm`/`bun` (pick one and stick to it) + `cargo` can start the app in development mode without manual environment hacks beyond documented Rust/Node prerequisites
- [ ] A native window opens showing a minimal React screen with the product name
- [ ] Frontend can invoke a Rust command and display the result
- [ ] TypeScript strict mode is enabled
- [ ] Repo has a clear frontend/backend layout suitable for Tauri 2

**Out of scope:**
- Compression features
- Ice HUD full visual system (follows in a later task)
- CI, installers, code signing
- Mobile targets

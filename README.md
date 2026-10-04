# Filesize Obliterator

Desktop app shell for local media compression. Stack: **Tauri 2**, **React 19**, **TypeScript**, **Vite**, and a **Rust** backend.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ (npm included)
- [Rust](https://www.rust-lang.org/tools/install) stable toolchain (`rustc` / `cargo`)
- Platform deps for Tauri 2: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Setup

```bash
npm install
```

## Develop

Starts the Vite frontend and opens the native Tauri window:

```bash
npm run dev
```

## Build

Production frontend + native bundle:

```bash
npm run build
```

## Useful checks

```bash
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Layout

| Path | Role |
|------|------|
| `src/` | React + TypeScript UI (Vite) |
| `src-tauri/` | Rust / Tauri backend (`ping`, `app_info` commands) |
| `tasks/` | Implementation task briefs |

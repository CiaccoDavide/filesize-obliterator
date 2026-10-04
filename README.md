# Filesize Obliterator

Desktop app shell for local media compression. Stack: **Tauri 2**, **React 19**, **TypeScript**, **Vite**, and a **Rust** backend.

## Offline-only runtime

This product is **offline-only**: the shipped app does not require internet connectivity and must not call online services at runtime. Fonts, scripts, and styles are bundled locally (no CDNs). Auto-update and telemetry endpoints are not configured. The webview Content Security Policy blocks remote HTTP(S); contributors must not add remote asset URLs, cloud compression APIs, license phone-home, or network-dependent crash reporters.

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

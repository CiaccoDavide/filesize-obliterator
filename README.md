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
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Folder drops expand one level of immediate files (nested directories are ignored).

## Image compression (offline)

Still images are compressed locally with Rust codecs (no cloud APIs). Built-in presets:

| Id | Label | Output | Notes |
|----|-------|--------|-------|
| `image-high` | High | `.jpg` | Quality-first (~q90); may not shrink already-optimized JPEGs |
| `image-balanced` | Balanced | `.webp` | Default tradeoff (~q75) |
| `image-small` | Small | `.webp` | Size-first (~q45) |

Supported inputs: JPEG, PNG, WebP. **HEIC/HEIF** is not supported in this build (no offline decoder bundled). Outputs land beside the source under `_compressed/`.

## Audio compression (offline)

Audio is decoded with Symphonia (pure Rust) and re-encoded to MP3 via a vendored LAME build — no cloud APIs and no ffmpeg runtime dependency. Built-in presets:

| Id | Label | Output | Notes |
|----|-------|--------|-------|
| `audio-high` | High | `.mp3` | 320 kbps CBR; quality-first |
| `audio-balanced` | Balanced | `.mp3` | 192 kbps CBR; default tradeoff |
| `audio-small` | Small | `.mp3` | 128 kbps CBR; size-first |

Supported inputs: MP3, WAV, AAC, M4A, FLAC. Job errors distinguish **missing codec** (encoder init failure) from **unsupported or corrupt** input. Work runs on a background Rust thread (UI stays responsive). Outputs land beside the source under `_compressed/`.

## Video compression (offline)

Video is re-encoded locally with **ffmpeg** (H.264 + AAC → `.mp4`). The binary is resolved from `FFMPEG_PATH`, a sidecar next to the app bundle, or `PATH`. Missing ffmpeg fails with a clear **missing tool** error (no network download). Built-in presets:

| Id | Label | Output | Notes |
|----|-------|--------|-------|
| `video-high` | High | `.mp4` | CRF 18; quality-first |
| `video-balanced` | Balanced | `.mp4` | CRF 23, ≤1080p; default tradeoff |
| `video-small` | Social small | `.mp4` | CRF 28, ≤720p; size-first for sharing |

**Supported input containers:** MP4, WebM, MKV, MOV, M4V (demuxers permitting). AVI/MPEG/WMV are rejected as unsupported in this build. Long encodes emit progress during the run; cancel cooperatively stops ffmpeg. Outputs land beside the source under `_compressed/`; the source file is never modified.

## Layout

| Path | Role |
|------|------|
| `src/` | React + TypeScript UI (Vite) |
| `src-tauri/` | Rust / Tauri backend (`ping`, `app_info` commands) |
| `tasks/` | Implementation task briefs |

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
npm test                 # Vitest (frontend unit tests)
npm run test:rust        # cargo test -- --nocapture in src-tauri
npm run test:all         # frontend + Rust
cargo check --manifest-path src-tauri/Cargo.toml
```

### Tests

- **Frontend:** `npm test` (Vitest). Offline; no network.
- **Rust:** `npm run test:rust` (`cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`). Covers `_compressed` path rules and a smoke encode per media kind against fixtures under `src-tauri/tests/fixtures/`. `--nocapture` keeps soft-skip reasons visible on stderr.
- **Optional tools:** Video smoke needs a local `ffmpeg`; PDF smoke needs Ghostscript (`gs`). When either is missing, those tests print `ignoring test: missing tool…` on stderr and soft-skip (they do not fail CI). Image and audio smokes use pure-Rust codecs and always run.
- Paths under test use temp dirs only — never machine-specific absolute paths outside of temp.

Folder drops expand one level of immediate files (nested directories are ignored).

## Image compression (offline)

Still images are compressed locally with Rust codecs (no cloud APIs). Built-in presets:

| Id | Label | Output | Notes |
|----|-------|--------|-------|
| `image-high` | High | `.jpg` | Quality-first (~q90); may not shrink already-optimized JPEGs |
| `image-balanced` | Balanced | `.webp` | Default tradeoff (~q75) |
| `image-small` | Small | `.webp` | Size-first (~q45) |

### Supported formats (offline)

| Kind | Supported inputs | Notes |
|------|------------------|-------|
| Image | JPEG, PNG, WebP, GIF, TIFF, BMP | Animated **GIF → animated WebP** (not MP4). Still GIF/TIFF/BMP use the selected image preset. |
| Image (platform) | HEIC/HEIF | **macOS:** decoded offline via `sips` / ImageIO when present. **Windows/Linux:** clear unsupported error (no libheif bundle). |
| Image (rejected) | AVIF | Clear unsupported error (no offline decoder). |
| Audio | MP3, WAV, AAC, M4A, FLAC | See audio section. |
| Video | MP4, WebM, MKV, MOV, M4V, 3GP, 3G2, MPEG-TS (`.ts` / `.mts` / `.m2ts`) | Demuxers permitting via local ffmpeg. AVI/MPEG/WMV/FLV rejected clearly. |
| PDF | PDF | See PDF section. |

Outputs land beside the source under `_compressed/`.

### Skip already-compressed (`force`)

Re-running the same **source path + preset** skips by default when a prior successful encode left a matching offline sidecar under `_compressed/.fo-already/` and the output file still exists with the same source content hash. Skipped queue rows show as **SKIPPED** with reason `already compressed for this preset` and count toward the batch **Skip** meter.

Turn on HUD **Force** (`compress_start.force=true`) to re-encode anyway; the new file follows the usual collision policy (`Photo.webp`, then `Photo_2.webp`, …). Detection is local only — no cloud dedupe.

### Disk space preflight

Before a batch starts, the app estimates write need and compares it to free space on each output volume (offline `statvfs` / `GetDiskFreeSpaceExW` only — one syscall per volume, so small image batches stay snappy).

| Constant | Value | Role |
|----------|-------|------|
| Headroom | 64 MiB per volume | Slack for temp files / FS overhead |
| Missing-estimate multiplier | 1.1 × source size | Used when PREVIEW estimate is absent |
| Warn ratio | 1.25 × needed | Tight free space → warn; **COMPRESS ANYWAY** overrides |

- **Block** when `freeBytes < neededBytes` → `DISK LOW — free … / need …` (start refused)
- **Warn** when `freeBytes < neededBytes × 1.25` → same status with override allowed
- `neededBytes` = sum of `compress_estimate` (or 1.1× source) + headroom, per volume

### Metadata (`stripMetadata`)

Job option `stripMetadata` (default **true**, HUD: **Strip metadata**):

| Kind | Strip on | Strip off |
|------|----------|-----------|
| Image (JPEG) | Bake orientation into pixels; drop EXIF/GPS | Keep EXIF including Orientation (and GPS if present) |
| Image (WebP out) | Bake orientation; no EXIF written | Bake orientation; container EXIF not preserved |
| Audio | Re-encode drops tags (always) | Same — tag preserve not available |
| Video | ffmpeg `-map_metadata -1` | Container metadata may be copied |
| PDF | Soft **warn** log; no crash (strip not guaranteed) | No change |

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

**Supported input containers:** MP4, WebM, MKV, MOV, M4V, 3GP/3G2, MPEG-TS (`.ts` / `.mts` / `.m2ts`) where the local ffmpeg build demuxes them. AVI/MPEG/WMV/FLV are rejected as unsupported in this build. Long encodes emit progress during the run; cancel cooperatively stops ffmpeg. Outputs land beside the source under `_compressed/`; the source file is never modified.

## PDF compression (offline)

PDFs are recompressed locally with **Ghostscript** (`pdfwrite` + `PDFSETTINGS`). The binary is resolved from `GS_PATH`, a sidecar next to the app bundle, or `PATH` (`gs` / `gswin64c`). Missing Ghostscript fails with a clear **missing tool** error (no network download). Built-in presets:

| Id | Label | Output | Notes |
|----|-------|--------|-------|
| `pdf-print` | Print | `.pdf` | ~300 dpi; quality-first (may not shrink already-optimized PDFs) |
| `pdf-ebook` | Ebook | `.pdf` | ~150 dpi; default tradeoff |
| `pdf-screen` | Screen | `.pdf` | ~72 dpi; size-first — typical image-heavy PDFs shrink vs print |

**Encrypted / password-protected PDFs** fail clearly (no password UI in this build). Invalid inputs fail without crashing. Outputs remain valid PDFs under `_compressed/` beside the source; the source file is never modified.

## Layout

| Path | Role |
|------|------|
| `src/` | React + TypeScript UI (Vite) |
| `src-tauri/` | Rust / Tauri backend (`ping`, `app_info` commands) |
| `tasks/` | Implementation task briefs |

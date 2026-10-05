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
./scripts/fetch-sidecars.sh          # download relocatable ffmpeg for this host
# or: ./scripts/fetch-sidecars.sh --stubs   # placeholders so cargo/tauri-build can run
```

`tauri build` / `tauri dev` / `cargo test` expect a triple-suffixed **ffmpeg** under `src-tauri/binaries/` (`bundle.externalBin`). Image/audio compress work without ffmpeg at runtime, but the Tauri build script still needs the file present. **Ghostscript is not bundled** (AGPL) — install `gs` / `gswin64c` on PATH (or set `GS_PATH`) for PDF compress.

## Develop

Starts the Vite frontend and opens the native Tauri window:

```bash
npm run dev
```

## Build

Production frontend + native bundle (requires ffmpeg sidecar — see **Desktop packaging**):

```bash
./scripts/fetch-sidecars.sh   # stage relocatable ffmpeg into src-tauri/binaries/
npm run build                 # tauri build → DMG/app, MSI/NSIS, AppImage/deb (per OS)
```

`tauri.conf.json` sets `productName` **Filesize Obliterator**, identifier `com.filesizeobliterator.desktop`, icons under `src-tauri/icons/`, and `bundle.externalBin` for `binaries/ffmpeg` only. Release apps stay offline-only (CSP / no updater) — see `src-tauri/tests/offline_policy.rs`.

## Desktop packaging

Installable offline bundles for **macOS**, **Windows**, and **Linux** (Tauri 2 defaults). The ffmpeg sidecar is **not** committed; fetch before every release build / cargo test.

| Step | Command |
|------|---------|
| Stage relocatable ffmpeg | `./scripts/fetch-sidecars.sh` or `npm run fetch:sidecars` |
| Placeholders for cargo/tauri-build | `./scripts/fetch-sidecars.sh --stubs` |
| PATH copy (dev fallback only) | `./scripts/fetch-sidecars.sh --from-path` |
| Best-effort multi-OS downloads | `./scripts/fetch-sidecars.sh --all` |
| Build installer | `npm run build` |

### Per-OS notes

| OS | Artifacts (Tauri `bundle.targets: all`) | Sidecars | Signing |
|----|----------------------------------------|----------|---------|
| **macOS** | `.app` + `.dmg` | Fetch downloads a **static/single-file** ffmpeg (`eugeneware/ffmpeg-static`) into `src-tauri/binaries/ffmpeg-<triple>`. Avoid `--from-path` Homebrew copies for release — they are dylib-linked and not relocatable offline. Ghostscript: install via Homebrew for PATH-only PDF (not bundled). | Optional maintainer notarization when Apple secrets exist — not required for local/CI artifacts. |
| **Windows** | `.msi` and/or NSIS `.exe` | Fetch downloads a single-file ffmpeg into `ffmpeg-<triple>.exe`. Ghostscript: install separately for PATH / `GS_PATH` (not bundled). | Optional Authenticode — maintainer-only. |
| **Linux** | `.AppImage`, `.deb` (and other enabled Tauri targets) | Fetch prefers johnvansickle **static** ffmpeg. Ghostscript via `apt` for PATH-only PDF. | None by default. |

Rust resolves **bundled ffmpeg** beside the executable / under `resources` / `binaries` **without** developer PATH hacks (`compress::sidecar`). Ghostscript resolves from `GS_PATH` or PATH only. Licenses: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

### Offline smoke checklist

After a local or CI build, verify offline behavior (no network):

1. **Config wiring:** `bundle.externalBin` lists only `binaries/ffmpeg` (no `gs`). `scripts/fetch-sidecars.sh` stages ffmpeg; leftover `binaries/gs-*` must not exist.
2. **Unit path resolution:** `FO_REQUIRE_ENCODERS=1 npm run test:rust` — ffmpeg resolves from staged sidecar or PATH; Ghostscript from PATH; soft-skips are disabled.
3. **Image smoke:** compress a JPEG/PNG in the built app (no ffmpeg/gs required).
4. **Video smoke (optional):** with staged/real ffmpeg, compress a short MP4 offline.
5. **PDF smoke (optional):** with host Ghostscript on PATH, compress a PDF offline.
6. **Clean-machine ffmpeg:** on a host without Homebrew/apt ffmpeg, the bundled sidecar still answers `ffmpeg -version` (release builds must use the download path, not `--from-path`).

### CI

GitHub Actions (`.github/workflows/ci.yml`) runs a **macOS / Windows / Linux** matrix: stage ffmpeg (download, stubs fallback) → typecheck → Vitest → `FO_REQUIRE_ENCODERS=1` cargo test → download relocatable ffmpeg → `tauri build`. OS packages supply PATH Ghostscript for PDF tests. Failures show under the Checks tab on the PR.

## Useful checks

```bash
./scripts/fetch-sidecars.sh --stubs   # or full download before cargo test
npm run typecheck
npm test                 # Vitest (frontend unit tests)
npm run test:rust        # cargo test -- --nocapture in src-tauri
FO_REQUIRE_ENCODERS=1 npm run test:rust   # fail hard if ffmpeg/gs missing
npm run test:all         # frontend + Rust
cargo check --manifest-path src-tauri/Cargo.toml
```

### Tests

- **Frontend:** `npm test` (Vitest). Offline; no network.
- **Rust:** `npm run test:rust` (`cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`). Covers `_compressed` path rules and a smoke encode per media kind against fixtures under `src-tauri/tests/fixtures/`. `--nocapture` keeps soft-skip reasons visible on stderr.
- **Optional tools:** Video smoke needs a working `ffmpeg` (staged sidecar or PATH); PDF smoke needs Ghostscript on PATH. When either is missing, those tests print `ignoring test: missing tool…` on stderr and soft-skip **unless** `FO_REQUIRE_ENCODERS=1` (CI). Image and audio smokes use pure-Rust codecs and always run.
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

Video is re-encoded locally with **ffmpeg** (H.264 + AAC → `.mp4`). Release bundles vendor ffmpeg via Tauri `externalBin`; at runtime the binary is resolved from `FFMPEG_PATH`, the bundled sidecar beside the app, or `PATH` (dev). Missing ffmpeg fails with a clear **missing tool** error (no network download). Built-in presets:

| Id | Label | Output | Notes |
|----|-------|--------|-------|
| `video-high` | High | `.mp4` | CRF 18; quality-first |
| `video-balanced` | Balanced | `.mp4` | CRF 23, ≤1080p; default tradeoff |
| `video-small` | Social small | `.mp4` | CRF 28, ≤720p; size-first for sharing |

**Supported input containers:** MP4, WebM, MKV, MOV, M4V, 3GP/3G2, MPEG-TS (`.ts` / `.mts` / `.m2ts`) where the local ffmpeg build demuxes them. AVI/MPEG/WMV/FLV are rejected as unsupported in this build. Long encodes emit progress during the run; cancel cooperatively stops ffmpeg. Outputs land beside the source under `_compressed/`; the source file is never modified.

## PDF compression (offline)

PDFs are recompressed locally with **Ghostscript** (`pdfwrite` + `PDFSETTINGS`). Ghostscript is **not** redistributed in the installer (AGPL — PATH-only exception; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)). At runtime the binary is resolved from `GS_PATH` or host `PATH` (`gs` / `gswin64c`). Missing Ghostscript fails with a clear **missing tool** error (no network download). Built-in presets:

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
| `src-tauri/binaries/` | Fetched ffmpeg sidecars (gitignored blobs; see `scripts/fetch-sidecars.sh`) |
| `scripts/fetch-sidecars.sh` | Stage relocatable ffmpeg for `bundle.externalBin` (Ghostscript not staged) |
| `THIRD_PARTY_NOTICES.md` | Licenses for vendored tools |
| `tasks/` | Implementation task briefs |

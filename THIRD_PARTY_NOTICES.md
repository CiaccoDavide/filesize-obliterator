# Third-party notices — Filesize Obliterator

This desktop app is **offline-only**. Release bundles vendor a **relocatable ffmpeg**
sidecar via Tauri `bundle.externalBin` (`src-tauri/binaries/`). Binary blobs are
**not** committed to git; maintainers and CI run `scripts/fetch-sidecars.sh`
before `tauri build` / `cargo test`.

This product redistributes only **permissive / LGPL-friendly** encoder binaries
(prefer LGPL/MIT/BSD/Apache ffmpeg builds). **AGPL Ghostscript is not redistributed**
in the installer.

## FFmpeg

- **Purpose:** offline video compress (H.264 / AAC → MP4)
- **Bundling:** `binaries/ffmpeg-<target-triple>[.exe]` → Tauri externalBin `binaries/ffmpeg`
- **Sources used by the fetch script (static / single-file, relocatable offline):**
  - [johnvansickle.com static builds](https://johnvansickle.com/ffmpeg/) (Linux amd64/arm64)
  - [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) single-file gzip builds (macOS x64/arm64, Windows x64)
  - Host `PATH` copy (`--from-path`) only as a **dev/CI fallback** — Homebrew/dylib-linked copies are **not** suitable for clean-machine offline releases
- **License:** FFmpeg is licensed under the **LGPL** and/or **GPL** depending on the
  build configuration and enabled libraries. Prefer **LGPL** builds for redistribution.
  Upstream: https://ffmpeg.org/legal.html

## Ghostscript (Artifex) — PATH-only exception

- **Purpose:** offline PDF recompress (`pdfwrite` / `PDFSETTINGS`)
- **Bundling:** **None.** `gs` is **not** listed in `bundle.externalBin` and must not be
  copied into `src-tauri/binaries/` for redistribution.
- **Runtime:** resolve via `GS_PATH` or host `PATH` (`gs` / `gswin64c` / `gswin32c`).
  End users who need PDF compress install Ghostscript themselves (or set `GS_PATH`).
- **Why PATH-only:** Artifex Ghostscript is **AGPL-3.0**. This project does not redistribute
  AGPL binaries in the installer. No permissive drop-in currently replaces the existing
  `pdfwrite` pipeline without a full PDF-stack rewrite, so Ghostscript remains a
  **documented PATH-only dependency** (bundling not possible due to license).
- **License reference:** https://www.ghostscript.com/licensing/index.html

## Other runtime codecs

- **Images:** Rust crates (`image`, `webp`) — see `src-tauri/Cargo.lock` for crate licenses
- **Audio:** Symphonia + vendored LAME (`mp3lame-encoder`) — no ffmpeg runtime dependency

## Fonts

Bundled UI fonts under `src/assets/fonts/` retain their SIL Open Font License texts
(`OFL-*.txt`).

## Contact

If a notice is incomplete for a binary you redistribute, update this file in the
same PR that changes `scripts/fetch-sidecars.sh` or `bundle.externalBin`.

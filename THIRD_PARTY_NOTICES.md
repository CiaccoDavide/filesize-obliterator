# Third-party notices — Filesize Obliterator

This desktop app is **offline-only** and vendors local encoder tools into release
bundles via Tauri `bundle.externalBin` (`src-tauri/binaries/`). Binary blobs are
**not** committed to git; maintainers and CI run `scripts/fetch-sidecars.sh`
before `tauri build`.

This product is **not sold**. Keep redistributed tools limited to the licenses
below (prefer LGPL/MIT/BSD/Apache for ffmpeg builds; Ghostscript is AGPL).

## FFmpeg

- **Purpose:** offline video compress (H.264 / AAC → MP4)
- **Bundling:** `binaries/ffmpeg-<target-triple>[.exe]` → Tauri externalBin `binaries/ffmpeg`
- **Typical sources used by the fetch script:**
  - [johnvansickle.com static builds](https://johnvansickle.com/ffmpeg/) (Linux)
  - [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) LGPL shared Windows packages when downloaded
  - Host package manager / PATH copy (`--from-path`) on macOS and other hosts without a pinned URL
- **License:** FFmpeg is licensed under the **LGPL** and/or **GPL** depending on the
  build configuration and enabled libraries. Prefer **LGPL** builds for redistribution.
  Upstream: https://ffmpeg.org/legal.html

## Ghostscript (Artifex)

- **Purpose:** offline PDF recompress (`pdfwrite` / `PDFSETTINGS`)
- **Bundling:** `binaries/gs-<target-triple>[.exe]` → Tauri externalBin `binaries/gs`
  (Windows installs often expose `gswin64c.exe`; the fetch script copies it as `gs-…`)
- **Typical sources:** system package (`apt` / `brew` / Windows installer) copied by
  `scripts/fetch-sidecars.sh`
- **License:** **AGPL-3.0** (Artifex Ghostscript). Because this app is not sold and
  source is available, AGPL redistribution of the sidecar is intentional. Review
  Artifex terms before any commercial distribution change:
  https://www.ghostscript.com/licensing/index.html

## Other runtime codecs

- **Images:** Rust crates (`image`, `webp`) — see `src-tauri/Cargo.lock` for crate licenses
- **Audio:** Symphonia + vendored LAME (`mp3lame-encoder`) — no ffmpeg runtime dependency

## Fonts

Bundled UI fonts under `src/assets/fonts/` retain their SIL Open Font License texts
(`OFL-*.txt`).

## Contact

If a notice is incomplete for a binary you redistribute, update this file in the
same PR that changes `scripts/fetch-sidecars.sh` or `bundle.externalBin`.

# Sidecar binaries (gitignored)

Place platform-specific encoder tools here before `tauri build`.

| Tool | Config name (`bundle.externalBin`) | On-disk fetch name |
|------|------------------------------------|--------------------|
| ffmpeg | `binaries/ffmpeg` | `ffmpeg-<target-triple>` (+ `.exe` on Windows) |
| Ghostscript | `binaries/gs` | `gs-<target-triple>` (+ `.exe` on Windows; copy of `gswin64c` is fine) |

```bash
./scripts/fetch-sidecars.sh          # current host triple
./scripts/fetch-sidecars.sh --all    # best-effort multi-OS downloads (where URLs exist)
```

Rust resolves bundled copies beside the app binary (and under `binaries/` / `resources/`) without PATH hacks. See `compress::sidecar`.

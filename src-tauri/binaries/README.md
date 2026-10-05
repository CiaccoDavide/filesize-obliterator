# Sidecar binaries (gitignored)

Place platform-specific **ffmpeg** here before `tauri build` / `cargo test`.

| Tool | Config name (`bundle.externalBin`) | On-disk fetch name |
|------|------------------------------------|--------------------|
| ffmpeg | `binaries/ffmpeg` | `ffmpeg-<target-triple>` (+ `.exe` on Windows) |
| Ghostscript | *(not bundled — AGPL)* | PATH / `GS_PATH` only |

```bash
./scripts/fetch-sidecars.sh          # download static/relocatable ffmpeg for this host
./scripts/fetch-sidecars.sh --stubs  # placeholders so cargo/tauri-build can run without download
./scripts/fetch-sidecars.sh --all    # best-effort multi-OS downloads
```

Rust resolves bundled ffmpeg beside the app binary (and under `binaries/` / `resources/`)
without PATH hacks. Ghostscript is resolved from `GS_PATH` or PATH only — see
`THIRD_PARTY_NOTICES.md` and `compress::sidecar`.

# Tasks — Filesize Obliterator

Agent-ready specs for an offline, multiplatform compress app (React + Rust + Tauri 2, Ice HUD).

## How to use

1. Create a GitHub repo and push this project.
2. Ensure labels exist: `ready-for-agent`, `needs-triage`, `needs-human`.
3. Open each task below as a GitHub issue; paste the file body; apply `ready-for-agent` only when dependencies are merged (or open scaffold first alone).
4. Run `/ship-ready` to implement and merge.

## Recommended order

| ID | File | Depends on | Notes |
|----|------|------------|--------|
| 001 | [001-scaffold-tauri-react-rust.md](001-scaffold-tauri-react-rust.md) | — | Foundation; do first alone |
| 002 | [002-offline-network-policy.md](002-offline-network-policy.md) | 001 | Hard offline guarantees |
| 003 | [003-ice-hud-shell.md](003-ice-hud-shell.md) | 001 | Design system shell |
| 004 | [004-drag-drop-intake.md](004-drag-drop-intake.md) | 003 | File intake UI |
| 005 | [005-compression-job-ipc.md](005-compression-job-ipc.md) | 001 | Rust job model + events |
| 006 | [006-compressed-output-path.md](006-compressed-output-path.md) | 005 | `_compressed` folder rules |
| 007 | [007-image-compression.md](007-image-compression.md) | 005, 006 | Images |
| 008 | [008-audio-compression.md](008-audio-compression.md) | 005, 006 | Audio |
| 009 | [009-video-compression.md](009-video-compression.md) | 005, 006 | Video |
| 010 | [010-pdf-compression.md](010-pdf-compression.md) | 005, 006 | PDF |
| 011 | [011-compression-alternatives-ui.md](011-compression-alternatives-ui.md) | 003, 005, 007–010 | Preset picker |
| 012 | [012-live-progress-surface.md](012-live-progress-surface.md) | 003, 005 | Live meters / queue |
| 013 | [013-batch-queue.md](013-batch-queue.md) | 005, 011, 012 | Multi-file queue |
| 014 | [014-errors-and-partial-failure.md](014-errors-and-partial-failure.md) | 013 | Failure UX |
| 015 | [015-tests-compression-and-paths.md](015-tests-compression-and-paths.md) | 006–010 | Automated tests |
| 016 | [016-desktop-packaging.md](016-desktop-packaging.md) | 002, 014, 015 | macOS / Windows / Linux bundles |
| 017 | [017-ci-build-test.md](017-ci-build-test.md) | 001, 015, 016 | CI |
| 018 | [018-readme-and-release-notes.md](018-readme-and-release-notes.md) | 016 | Docs + first release checklist |

Media compressors (007–010) can ship in parallel after 005+006. UI tasks 011–013 should wait until at least one media pipeline exists.

## Enhancements (after core ship)

Ship these once 001–018 are substantially done (or earlier when dependencies allow). High leverage for daily use, trust, and speed.

| ID | File | Depends on | Why it matters |
|----|------|------------|----------------|
| 019 | [019-dry-run-size-estimate.md](019-dry-run-size-estimate.md) | 011, 013 | Decide before you encode |
| 020 | [020-savings-meters-and-session-stats.md](020-savings-meters-and-session-stats.md) | 012, 013 | Instant payoff feedback |
| 021 | [021-image-before-after-preview.md](021-image-before-after-preview.md) | 007, 012 | Trust quality visually |
| 022 | [022-metadata-privacy-controls.md](022-metadata-privacy-controls.md) | 007–009 | Strip GPS/EXIF on demand |
| 023 | [023-skip-already-compressed.md](023-skip-already-compressed.md) | 006, 013 | No duplicate work |
| 024 | [024-reveal-in-file-manager.md](024-reveal-in-file-manager.md) | 006, 012 | Jump to outputs |
| 025 | [025-local-settings-persistence.md](025-local-settings-persistence.md) | 011, 013 | Remember defaults |
| 026 | [026-keyboard-shortcuts.md](026-keyboard-shortcuts.md) | 004, 013, 014 | Faster ops |
| 027 | [027-native-completion-notification.md](027-native-completion-notification.md) | 013, 014 | Unfocused batch done |
| 028 | [028-disk-space-preflight.md](028-disk-space-preflight.md) | 009, 013, 019 | Avoid mid-encode disk fails |
| 029 | [029-ice-hud-live-dual-view.md](029-ice-hud-live-dual-view.md) | 012, 013 | Full Ice HUD live stage |
| 030 | [030-first-run-hud-briefing.md](030-first-run-hud-briefing.md) | 003, 004, 025 | Teach `_compressed` + offline |
| 031 | [031-extended-format-coverage.md](031-extended-format-coverage.md) | 007–009 | HEIC / GIF / more real files |
| 032 | [032-custom-preset-builder.md](032-custom-preset-builder.md) | 011, 025 | Power-user presets |
| 033 | [033-watch-folder-mode.md](033-watch-folder-mode.md) | 013, 025, 023 | Auto-compress a folder |
| 034 | [034-replace-original-optional.md](034-replace-original-optional.md) | 006, 014, 021 | Opt-in in-place replace |
| 035 | [035-hardware-video-acceleration.md](035-hardware-video-acceleration.md) | 009, 025 | Faster video when HW exists |
| 036 | [036-accessibility-and-focus.md](036-accessibility-and-focus.md) | 003, 011, 026 | Keyboard + a11y basics |

Suggested enhancement waves: **019–024** (trust & clarity) → **025–028** (ops polish) → **029–030** (HUD identity) → **031–035** (power) → **036** (a11y).

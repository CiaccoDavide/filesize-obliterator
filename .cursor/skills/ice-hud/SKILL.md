---
name: ice-hud
description: >-
  Ice HUD UI system — cool dark tactical interface (Oblivion / Westworld instrument
  panel). Use when building or restyling frontend UI, screens, dashboards, forms,
  panels, buttons, live status surfaces, file trees, topology graphs, or Three.js
  node visualizations so the look and interaction model match this design language.
---

# Ice HUD

Cool, dark, instrument-panel UI. Calm tech — not neon cyberpunk, not purple SaaS, not cream editorial.

**Load [`tokens.css`](tokens.css)** (copy or merge `:root` vars). Read [`patterns.md`](patterns.md) for chrome recipes. Read [`live-surface.md`](live-surface.md) when building the **file tree + topology graph** live stage.

## Preferred stack

Default to this stack unless the host project already dictates otherwise:

| Layer | Choice |
|-------|--------|
| Desktop shell | **Tauri 2** (`@tauri-apps/api`, dialog/opener plugins) |
| Native / IO | **Rust** + Tokio; emit progress over Tauri events/commands |
| UI | **React 19** + **TypeScript** + **Vite** |
| 3D topology | **Three.js** + `OrbitControls` (instanced flat billboards, not Points for shaped nodes) |
| Motion (chrome) | Sparse CSS; Framer Motion only if already in-tree |
| Fonts | **Exo 2** (HUD) + **JetBrains Mono** (paths / meters / logs) |

IPC pattern: Rust owns the long job; React subscribes to typed events (`progress`, `asset`, `log`, `complete`) and keeps a live asset list that feeds **both** the tree and the graph from one source of truth.

## Hard rules

1. **Palette**: only the CSS variables in `tokens.css`. Accent is ice-blue `#7eb6ff` on near-black `#07090c`. Text is cool grey-ice. Danger/warn sparingly.
2. **Type**: Exo 2 for HUD chrome / labels / buttons. JetBrains Mono for URLs, paths, meters, logs, code-ish values. No Inter / Roboto / system-ui as the brand face.
3. **Shape language**: square corners (`border-radius: 0`). Hairline borders (`1px solid var(--line)`). Corner tick marks via `.hud-frame` (L-brackets on opposite corners). No soft cards, no multi-layer drop shadows, no glow blooms, no rounded-full pills.
4. **Labels**: micro uppercase tracking — `font-size ~0.62rem`, `letter-spacing: 0.14em–0.18em`, `text-transform: uppercase`, color `var(--muted)`.
5. **Brand**: when the product name appears, treat it as a hero signal (`brand-mark`: wide letter-spacing, ice color, uppercase). Tagline is quieter than the brand.
6. **Atmosphere**: faint grid + soft top radial wash (`.grid-bg`). Full-viewport shell; content sits above it (`z-index`).
7. **Buttons**: transparent / ice outline; primary = faint accent fill + accent border; danger = muted red outline. Uppercase micro type. Hover = border/text shift to accent — no big fill jumps.
8. **Motion**: sparse and purposeful — status tick blink, abort spinner, fade on transient overlays. No bounce, no parallax noise, no endless neon pulse on everything.
9. **Density**: instrument panels are tight (`gap ~0.4rem`). Live/ops screens lock to viewport height and clip; setup/marketing can breathe more.
10. **Copy voice**: terse, operational. Prefer `AWAITING`, `MIRRORING`, `ABORTING`, `PREVIEW` over chatty marketing on live surfaces.
11. **Live dual view**: when showing a growing file set, pair a **monospace tree** (structure) with a **3D topology graph** (spatial) sharing selection + kind colors — see [`live-surface.md`](live-surface.md).

## Anti-defaults (steer clear)

Purple-on-white / indigo gradients · warm cream + terracotta serif · broadsheet dense columns · dark mode with purple glow · emoji ornament · glassmorphism stacks · oversized rounded cards in the hero · fat 3D meshes that explode in size when zooming · preview popups that chase moving nodes during download.

## Layout instincts

- **Setup**: centered narrow column (~680px), brand block then form — both in `.hud-frame`.
- **Live / ops**: top identity + meters strip; main grid = tree | graph; bottom stream/stats. Panels are frames, not floating cards.
- **Overlays**: absolute HUD cards; download previews freeze at spawn screen position; inspect may track selection.

## Completion check

Tokens in use · Exo 2 + JetBrains Mono loaded · square frames with corner ticks · micro uppercase labels · no purple/glow/pill defaults · brand strongest on branded first viewport · if live file UI: tree + graph share data/selection/kind theme · graph nodes flat billboards with low max size and constant screen size on zoom.

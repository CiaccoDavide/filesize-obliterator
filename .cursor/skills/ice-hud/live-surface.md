# Ice HUD — live surface (file tree + topology graph)

How the **live ops** stage pairs a file tree with a Three.js graph. Implement both when the product streams a growing set of path-addressable assets.

Shared inputs:

```ts
type Asset = {
  localPath: string;   // e.g. "css/app.css"
  kind: string;        // html | css | js | image | font | other
  bytes: number;
  // plus preview payload as needed (url, mime, snippet…)
};
```

One asset list → tree + graph. Shared `selectedPath` / `onSelect`. Shared kind theme (hex + rgb + sizeMul + glyph + flat shape).

---

## Live grid chrome

```
┌─────────────────────────────────────────────┐
│ BRAND   ● STATUS          [meters…] [ABORT] │
├──────────┬──────────────────────────────────┤
│ TREE     │ GRAPH (orbit / zoom / select)    │
│ (mono)   │ + transient PREVIEW cards        │
│          │ + pinned INSPECT on selection    │
├──────────┴──────────────────────────────────┤
│ STREAM / LOGS          │ STATS (donuts…)    │
└─────────────────────────────────────────────┘
```

CSS sketch: `grid-template-columns: minmax(160px, 0.22fr) minmax(0, 0.78fr)`; `grid-template-rows: 1fr ~150px`; each cell `.hud-frame` + `.panel-label`. Viewport lock: `height:100vh; overflow:hidden; min-height:0` on flex/grid children.

---

## File tree

**Feel**: terminal tree inside a HUD panel — not a Finder sidebar.

### Behaviour

1. Build a nested dir/file map from `localPath` segments (`buildTree`).
2. Sort: directories before files, then locale name.
3. Render ASCII branches: `├──` / `└──` / `│` prefixes in muted mono.
4. Dirs: glyph `[+]` / `[-]`, name ends with `/`, toggle collapse.
5. Files: 3-letter kind glyph (`htm` `css` `js ` `img` `fnt` `bin`) + name + `formatBytes` trailing size.
6. Kind colors tint glyph + name (same theme as graph).
7. Selection: `.active` row (accent-tinted background / border); `scrollIntoView({ block: "nearest" })`.
8. On new asset: auto-expand ancestor dirs so the newborn path is visible.
9. Empty state: quiet mono hint (`awaiting first write…`).

### Row chrome

- Full-width button rows, zero radius, transparent bg.
- Hover: slight ice wash. Active: accent-dim fill.
- Prefix muted; size column muted mono, right-leaning.
- Dense line-height; panel scrolls independently.

### Kind glyphs

| kind  | glyph | note        |
|-------|-------|-------------|
| html  | htm   |             |
| css   | css   |             |
| js    | js␠   | pad to 3 ch |
| image | img   |             |
| font  | fnt   |             |
| dir   | dir / [±] | folders |
| other | bin   |             |

---

## Topology graph (Three.js)

**Feel**: calm constellation of flat HUD glyphs — orbit to inspect, not a flashy particle toy.

### Scene

- Transparent WebGL clear over the grid bg; optional `FogExp2` near `--bg-0`.
- `PerspectiveCamera` + **OrbitControls**: damping on, gentle `autoRotate`, pause on drag, resume after ~2.8s idle.
- Pan allowed; `minDistance` / `maxDistance` clamped.
- Cursor `grab` / `grabbing`. Clicks that moved >~6px are orbits, not selects.
- Raycast instanced meshes (not Points) for hit-testing.

### Nodes — shape by kind, size by bytes

Flat **ShapeGeometry / CircleGeometry** billboards (`quaternion.copy(camera.quaternion)` every frame). `MeshBasicMaterial`, double-sided, per-instance color.

| kind  | silhouette   |
|-------|--------------|
| html  | diamond (4)   |
| css   | triangle (3) |
| js    | hexagon (6)  |
| image | square       |
| font  | pentagon (5) |
| dir   | small square |
| other | circle       |

Size:

- `r = clamp(log10(bytes + 10) scaled, min, **low max ~2.8**)`
- Images get an extra shrink (large on disk ≠ large glyph); dirs small fixed.
- Multiply by kind `sizeMul` (images ~0.62).
- **Constant screen size while zooming**: `scale *= distanceToCamera / SIZE_REF_DIST` (ref ≈ initial camera distance).

### Edges + layout

- Parent/child path edges as `LineSegments`, ice stroke, opacity ~0.16.
- Force layout: repulsion + spring along tree edges + mild center gravity + soft bounds.
- Seed new nodes near parent (hash angle offset) so structure reads without a rigid tree layout.
- Cap node count (~280) — keep recent path neighborhoods if over budget.
- Recreate scene once; update instance matrices each frame from a sim ref (avoid React re-mount thrash).

### Selection + previews

- Hover tooltip: kind, path, bytes — mono/HUD micro type.
- Click file node → `onSelect(asset)`; pinned **INSPECT** card can track projected screen position.
- While job running: spawn up to ~5 **PREVIEW** cards for newest assets.
  - Position = node’s **screen projection at spawn time**, then **freeze** (do not chase the force sim).
  - TTL ~4.5s with fade in the last ~600ms.
- Empty: `AWAITING TOPOLOGY`.

### Abort UX (live chrome)

Danger **ABORT** → disabled + small border spinner + `ABORTING…` until backend reports complete/cancelled.

---

## Kind theme module

Keep one module (`kindTheme`) exporting `normalizeKind`, `kindColor`, `kindRgb`, `kindLabel`, `kindSizeMul`, `kindGlyph`, `kindShape` so tree, graph, and stats donuts never drift.

Cool distinct hues (not neon rainbow):

| kind  | hex     |
|-------|---------|
| html  | #e8eef5 |
| css   | #4ec4ff |
| js    | #e0b45c |
| image | #e08a9a |
| font  | #8b9fd4 |
| dir   | #6a7380 |
| other | #9aa3ad |

---

## Stats companion (optional)

Bottom-right dual SVG donuts: count-by-kind + bytes-by-kind, same colors, mono legends. One job per panel.

---

## Done when

Tree and graph update from the same asset stream; selecting in either highlights consistently; kinds share colors/glyphs/shapes; graph stays orbitable with flat constant-size nodes; download previews stay put; live stage remains viewport-locked Ice HUD chrome.

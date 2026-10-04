# Ice HUD — patterns

Recipes for common surfaces. Always keep [`tokens.css`](tokens.css) as the source of truth for variables and primitives.

For the **file tree + Three.js topology graph** live stage, read [`live-surface.md`](live-surface.md) (authoritative).

## Fonts

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

## Shell

```html
<div class="app-shell">
  <div class="grid-bg" aria-hidden="true"></div>
  <main style="position:relative;z-index:2"><!-- screens --></main>
</div>
```

## Setup / branded entry

One composition: brand block (name >> tagline >> one sub line) then a framed form. Max width ~680px, vertically centered.

```html
<section class="setup" style="max-width:680px;margin:0 auto;…">
  <header class="hud-frame" style="padding:1.5rem 1.6rem">
    <p class="brand-mark">PRODUCT NAME</p>
    <h1 class="brand-tagline">One clear job statement.</h1>
    <p class="brand-sub">Short supporting sentence. No feature laundry list.</p>
  </header>
  <form class="hud-frame" style="padding:1.25rem 1.4rem;display:flex;flex-direction:column;gap:1rem">
    <label class="field">
      <span>TARGET</span>
      <input type="url" placeholder="https://…" />
    </label>
    <button type="submit" class="btn primary">ENGAGE</button>
  </form>
</section>
```

## Live / ops header

Compact identity + status + meters. Meters use mono values; labels are micro uppercase.

```html
<div class="live-top" style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem">
  <div style="display:flex;align-items:center;gap:1rem">
    <span class="brand-mark compact">PRODUCT</span>
    <p style="margin:0;color:var(--accent);font-size:0.65rem;letter-spacing:0.16em;display:flex;align-items:center;gap:0.45rem">
      <span class="hud-tick"></span> MIRRORING
    </p>
  </div>
  <div style="display:flex;gap:0.4rem">
    <div class="meter"><span class="meter-label">FILES</span><span class="meter-value">128</span></div>
    <div class="meter"><span class="meter-label">BYTES</span><span class="meter-value">4.2 MB</span></div>
  </div>
</div>
```

## Panel grid

Tight gaps (`0.4rem`). Each region is a `.hud-frame` with a `.panel-label`. Viewport-locked live screens: `height:100vh; overflow:hidden; min-height:0` on flex/grid children.

Typical live body: **tree | graph** on the main row, **log | stats** below — details in [`live-surface.md`](live-surface.md).

## Motion budget

| Signal | Treatment |
|--------|-----------|
| System alive | 6×6 accent `.hud-tick` step blink |
| Destructive in progress | 10px border spinner on danger button + `ABORTING` copy |
| Transient preview | opacity fade in last ~600ms of TTL |
| Orbit / idle viz | gentle auto-rotate; pause while user drags |

## Copy

Operational, short, uppercase for chrome. Examples: `TARGET URL`, `OUTPUT`, `RESPECT ROBOTS.TXT`, `START MIRROR`, `INSPECT`, `PREVIEW`, `AWAITING TOPOLOGY`.

## What “done” looks like

A stranger should read the first viewport as an instrument panel for one product — ice on charcoal, square frames, wide-tracked brand — not a generic dashboard template.

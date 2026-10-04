# Ice HUD — portable agent UX pack

Give AI coding agents the **same cool dark instrument-panel UI** used by Website Cloner (Oblivion / Westworld-adjacent HUD: ice on charcoal, square frames, Exo 2 + JetBrains Mono), including the **preferred stack** and the **file tree + topology graph** live surface.

## Contents

| File | Role |
|------|------|
| [`SKILL.md`](SKILL.md) | Agent skill — stack, hard rules, when to apply |
| [`tokens.css`](tokens.css) | Drop-in CSS variables + primitive classes |
| [`patterns.md`](patterns.md) | Shell / setup / header recipes |
| [`live-surface.md`](live-surface.md) | File tree + Three.js graph behaviour |

## Install for Cursor (pick one)

### A. Personal skill (all your projects)

```bash
cp -R agent-ux/ice-hud ~/.cursor/skills/ice-hud
# or:
cp -R agent-ux/ice-hud ~/.agents/skills/ice-hud
```

### B. Per-repo skill

```bash
mkdir -p .cursor/skills
cp -R /path/to/agent-ux/ice-hud .cursor/skills/ice-hud
```

### C. Point from `AGENTS.md` / `CLAUDE.md`

```markdown
## UI
Frontend UI follows **Ice HUD**: read `agent-ux/ice-hud/SKILL.md`.
Live file/topology UIs follow `agent-ux/ice-hud/live-surface.md`; use `tokens.css`.
```

## Wire into a new app

1. Prefer **Tauri 2 + React 19 + TS + Vite + Three.js** (see skill stack table).
2. Load Google fonts (see `patterns.md`).
3. Import `tokens.css` globally.
4. Wrap the app in `.app-shell` + `.grid-bg`.
5. Tell the agent: “use Ice HUD” / “match ice-hud skill” / “live tree + graph like ice-hud”.

## Origin

Extracted from Website Cloner (`src/styles/app.css`, `FileTree`, `SiteGraph`, `kindTheme`, Tauri/React/Three stack).

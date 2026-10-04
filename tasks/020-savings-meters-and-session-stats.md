---
title: Session savings meters and operational stats strip
labels: [enhancement]
depends_on: [012, 013]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Surface bytes saved, average ratio, and counts for the current session in Ice HUD meters.

**Current behavior:**  
Per-job stats may exist on completion; session-level meters are weak or absent.

**Desired behavior:**  
Top or bottom HUD strip shows: files done, files failed, bytes in, bytes out, bytes saved, save %. Updates live as jobs complete. Monospace for numeric meters. Reset when the user clears the session/queue (not on every app focus).

**Key interfaces:**
- Derived selectors from completed job results
- Meter components using Ice HUD tokens (no chart library required)

**Acceptance criteria:**
- [ ] After a successful batch, meters reflect true aggregates from job results
- [ ] Failed jobs do not count as savings
- [ ] Numbers use consistent human units (KiB/MiB) in monospace
- [ ] Strip matches Ice HUD density and labeling

**Out of scope:**
- Persisted lifetime analytics across months
- Uploading stats anywhere

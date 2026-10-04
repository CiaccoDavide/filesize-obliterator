---
title: Native OS notification when a batch completes (offline)
labels: [enhancement]
depends_on: [013, 014]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Notify the user via the OS notification center when a batch finishes while the window is unfocused.

**Current behavior:**  
Completion is visible only inside the app.

**Desired behavior:**  
On batch terminal state, show a local notification: succeeded/failed counts and bytes saved when available. Respect an in-app toggle (default on). No push services, no network. Clicking the notification focuses the app when the platform allows.

**Key interfaces:**
- Tauri notification plugin configured for local use
- Setting `notifyOnComplete: boolean`

**Acceptance criteria:**
- [ ] Completing a batch while unfocused shows a native notification (permission permitting)
- [ ] Toggle can disable notifications
- [ ] Notification body stays terse and accurate
- [ ] Works without internet

**Out of scope:**
- Mobile push
- Email/Slack integrations

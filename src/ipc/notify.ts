import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { NotificationHost } from "../notify/completionNotification";

/** Tauri local notification host — no network / no push. */
export const tauriNotificationHost: NotificationHost = {
  isPermissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
  sendNotification: (options) => sendNotification(options),
};

/**
 * Best-effort: focus the main window when the operator acts on a notification.
 * Desktop OSes often focus the app natively; this covers platforms that emit
 * plugin action events.
 */
export async function listenNotificationFocus(): Promise<() => void> {
  try {
    const listener = await onAction(async () => {
      try {
        await getCurrentWindow().setFocus();
      } catch {
        // Vite-only / platform without focus — ignore.
      }
    });
    return () => {
      void listener.unregister();
    };
  } catch {
    return () => {
      /* no-op */
    };
  }
}

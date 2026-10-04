import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../settings/schema";
import { parseSettings } from "../settings/schema";

/** Load settings from the local app config dir (never networked). */
export async function settingsLoad(): Promise<AppSettings> {
  try {
    const raw = await invoke<unknown>("settings_load");
    return parseSettings(raw);
  } catch {
    return parseSettings(null);
  }
}

/** Persist settings to the local app config dir and apply concurrency. */
export async function settingsSave(
  settings: AppSettings,
): Promise<AppSettings> {
  try {
    const raw = await invoke<unknown>("settings_save", { settings });
    return parseSettings(raw);
  } catch {
    return parseSettings(settings);
  }
}

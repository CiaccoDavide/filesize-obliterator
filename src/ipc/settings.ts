import { invoke } from "@tauri-apps/api/core";
import {
  clampConcurrency,
  parseSettings,
  type AppSettings,
} from "../settings/schema";

/** Load settings from the local app config dir (never networked). */
export async function settingsLoad(): Promise<AppSettings> {
  const raw = await invoke<unknown>("settings_load");
  return parseSettings(raw);
}

/** Persist settings to the local app config dir and apply concurrency. */
export async function settingsSave(
  settings: AppSettings,
): Promise<AppSettings> {
  const raw = await invoke<unknown>("settings_save", { settings });
  return parseSettings(raw);
}

/** Apply queue concurrency immediately (does not wait for debounced save). */
export async function settingsSetConcurrency(
  concurrency: number,
): Promise<void> {
  await invoke("settings_set_concurrency", {
    concurrency: clampConcurrency(concurrency),
  });
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  settingsLoad,
  settingsSave,
  settingsSetConcurrency,
} from "./settings";
import { defaultSettings } from "../settings/schema";

describe("settings ipc", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("rethrows settingsLoad invoke failures", async () => {
    invoke.mockRejectedValue(new Error("ipc down"));
    await expect(settingsLoad()).rejects.toThrow("ipc down");
  });

  it("rethrows settingsSave invoke failures", async () => {
    invoke.mockRejectedValue(new Error("write failed"));
    await expect(settingsSave(defaultSettings())).rejects.toThrow(
      "write failed",
    );
  });

  it("applies concurrency via settings_set_concurrency", async () => {
    invoke.mockResolvedValue(undefined);
    await settingsSetConcurrency(3);
    expect(invoke).toHaveBeenCalledWith("settings_set_concurrency", {
      concurrency: 3,
    });
  });

  it("clamps concurrency before invoke", async () => {
    invoke.mockResolvedValue(undefined);
    await settingsSetConcurrency(99);
    expect(invoke).toHaveBeenCalledWith("settings_set_concurrency", {
      concurrency: 4,
    });
  });
});

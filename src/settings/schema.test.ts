import { describe, expect, it } from "vitest";
import {
  SETTINGS_VERSION,
  clampConcurrency,
  defaultSettings,
  parseSettings,
  serializeSettings,
} from "./schema";

describe("defaultSettings", () => {
  it("returns a versioned local-only baseline", () => {
    const s = defaultSettings();
    expect(s.version).toBe(SETTINGS_VERSION);
    expect(s.concurrency).toBe(2);
    expect(s.stripMetadata).toBe(true);
    expect(s.preferHardware).toBe(true);
    expect(s.uiDensity).toBe("compact");
    expect(s.defaultPresets).toEqual({});
    expect(s.windowSize).toBeNull();
    expect(s.briefingSeen).toBe(false);
    expect(s.notifyOnComplete).toBe(true);
  });
});

describe("parseSettings", () => {
  it("accepts a valid settings object", () => {
    const parsed = parseSettings({
      version: 1,
      concurrency: 1,
      stripMetadata: false,
      preferHardware: false,
      uiDensity: "regular",
      defaultPresets: { image: "image-small", pdf: "pdf-screen" },
      windowSize: { width: 960, height: 720 },
      briefingSeen: true,
      notifyOnComplete: false,
    });
    expect(parsed).toEqual({
      version: 1,
      concurrency: 1,
      stripMetadata: false,
      preferHardware: false,
      uiDensity: "regular",
      defaultPresets: { image: "image-small", pdf: "pdf-screen" },
      windowSize: { width: 960, height: 720 },
      briefingSeen: true,
      notifyOnComplete: false,
    });
  });

  it("defaults missing briefingSeen to false (additive)", () => {
    expect(parseSettings({ version: 1 }).briefingSeen).toBe(false);
  });

  it("defaults missing preferHardware to true (additive)", () => {
    expect(parseSettings({ version: 1 }).preferHardware).toBe(true);
  });

  it("defaults missing notifyOnComplete to true (additive)", () => {
    expect(parseSettings({ version: 1 }).notifyOnComplete).toBe(true);
  });

  it("recovers to defaults for corrupt JSON text", () => {
    expect(parseSettings("not-json{{{")).toEqual(defaultSettings());
  });

  it("recovers to defaults for null / non-objects", () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings(42)).toEqual(defaultSettings());
    expect(parseSettings([])).toEqual(defaultSettings());
  });

  it("clamps concurrency into the safe range", () => {
    expect(parseSettings({ version: 1, concurrency: 0 }).concurrency).toBe(1);
    expect(parseSettings({ version: 1, concurrency: 99 }).concurrency).toBe(4);
    expect(parseSettings({ version: 1, concurrency: 1.7 }).concurrency).toBe(2);
  });

  it("ignores unknown preset kinds and empty ids", () => {
    const parsed = parseSettings({
      version: 1,
      defaultPresets: {
        image: "image-high",
        bogus: "x",
        audio: "",
        video: "  video-small  ",
      },
    });
    expect(parsed.defaultPresets).toEqual({
      image: "image-high",
      video: "video-small",
    });
  });

  it("fills missing fields from defaults without crashing", () => {
    const parsed = parseSettings({ version: 1 });
    expect(parsed.concurrency).toBe(2);
    expect(parsed.stripMetadata).toBe(true);
    expect(parsed.preferHardware).toBe(true);
    expect(parsed.uiDensity).toBe("compact");
    expect(parsed.windowSize).toBeNull();
  });

  it("drops invalid window sizes", () => {
    expect(
      parseSettings({ version: 1, windowSize: { width: -1, height: 100 } })
        .windowSize,
    ).toBeNull();
    expect(
      parseSettings({ version: 1, windowSize: { width: 10, height: 10 } })
        .windowSize,
    ).toBeNull();
  });
});

describe("serializeSettings", () => {
  it("round-trips through JSON without network fields", () => {
    const original = parseSettings({
      version: 1,
      concurrency: 3,
      stripMetadata: false,
      preferHardware: false,
      uiDensity: "regular",
      defaultPresets: { image: "image-high" },
      windowSize: { width: 800, height: 600 },
    });
    const again = parseSettings(serializeSettings(original));
    expect(again).toEqual(original);
    expect(serializeSettings(original)).not.toMatch(/https?:\/\//);
  });
});

describe("clampConcurrency", () => {
  it("bounds values to 1..=4", () => {
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(2)).toBe(2);
    expect(clampConcurrency(4)).toBe(4);
    expect(clampConcurrency(8)).toBe(4);
  });
});

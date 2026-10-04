import { describe, expect, it } from "vitest";
import { formatBytes } from "../intake/formatBytes";
import {
  DISK_HEADROOM_BYTES,
  DISK_MISSING_ESTIMATE_MULTIPLIER,
  DISK_WARN_RATIO,
  buildDiskPreflightItems,
  classifyDiskPreflight,
  computeNeededBytes,
  formatDiskPreflightMessage,
  type DiskPreflightItem,
} from "./diskPreflight";

describe("computeNeededBytes", () => {
  it("sums estimates and adds batch headroom", () => {
    const items: DiskPreflightItem[] = [
      { originalBytes: 10_000, estimatedBytes: 4_000 },
      { originalBytes: 20_000, estimatedBytes: 8_000 },
    ];
    expect(computeNeededBytes(items)).toBe(12_000 + DISK_HEADROOM_BYTES);
  });

  it("uses conservative source multiple when estimate is missing", () => {
    const items: DiskPreflightItem[] = [
      { originalBytes: 1_000 },
      { originalBytes: 2_000, estimatedBytes: undefined },
    ];
    const expected =
      Math.ceil(1_000 * DISK_MISSING_ESTIMATE_MULTIPLIER) +
      Math.ceil(2_000 * DISK_MISSING_ESTIMATE_MULTIPLIER) +
      DISK_HEADROOM_BYTES;
    expect(computeNeededBytes(items)).toBe(expected);
  });

  it("ignores non-finite or negative estimates and falls back", () => {
    const items: DiskPreflightItem[] = [
      { originalBytes: 1_000, estimatedBytes: Number.NaN },
      { originalBytes: 1_000, estimatedBytes: -5 },
    ];
    const per =
      Math.ceil(1_000 * DISK_MISSING_ESTIMATE_MULTIPLIER) * 2 +
      DISK_HEADROOM_BYTES;
    expect(computeNeededBytes(items)).toBe(per);
  });

  it("returns only headroom for an empty batch", () => {
    expect(computeNeededBytes([])).toBe(DISK_HEADROOM_BYTES);
  });
});

describe("classifyDiskPreflight", () => {
  it("blocks when free space is below needed", () => {
    expect(classifyDiskPreflight(100, 200)).toEqual({
      ok: false,
      freeBytes: 100,
      neededBytes: 200,
      mode: "block",
    });
  });

  it("warns when free is below needed * warn ratio but still enough to write", () => {
    const needed = 100;
    const free = Math.floor(needed * DISK_WARN_RATIO) - 1;
    expect(classifyDiskPreflight(free, needed)).toEqual({
      ok: true,
      freeBytes: free,
      neededBytes: needed,
      mode: "warn",
    });
  });

  it("is ok when free meets the warn threshold", () => {
    const needed = 100;
    const free = Math.ceil(needed * DISK_WARN_RATIO);
    expect(classifyDiskPreflight(free, needed)).toEqual({
      ok: true,
      freeBytes: free,
      neededBytes: needed,
      mode: "ok",
    });
  });

  it("treats equal free and needed as warn (tight, override allowed)", () => {
    // free === needed is enough to write, but not the 1.25× comfort band.
    expect(classifyDiskPreflight(100, 100).mode).toBe("warn");
  });
});

describe("formatDiskPreflightMessage", () => {
  it("includes DISK LOW and free vs needed bytes", () => {
    const msg = formatDiskPreflightMessage({
      freeBytes: 1024,
      neededBytes: 2048,
      mode: "block",
    });
    expect(msg).toMatch(/^DISK LOW/);
    expect(msg).toContain(formatBytes(1024));
    expect(msg).toContain(formatBytes(2048));
  });
});

describe("buildDiskPreflightItems", () => {
  it("joins matching path+preset estimates and skips files without presets", () => {
    const estimates = new Map([
      [
        "/a.png",
        {
          path: "/a.png",
          presetId: "image-balanced",
          estimatedBytes: 400,
          confidence: "approximate" as const,
          originalBytes: 1000,
        },
      ],
    ]);
    const items = buildDiskPreflightItems(
      [
        { path: "/a.png", bytes: 1000, presetId: "image-balanced" },
        { path: "/b.png", bytes: 2000, presetId: "image-small" },
        { path: "/c.png", bytes: 3000, presetId: "" },
      ],
      estimates,
    );
    expect(items).toEqual([
      {
        sourcePath: "/a.png",
        originalBytes: 1000,
        estimatedBytes: 400,
      },
      {
        sourcePath: "/b.png",
        originalBytes: 2000,
      },
    ]);
  });
});

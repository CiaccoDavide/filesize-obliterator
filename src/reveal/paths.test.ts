import { describe, expect, it } from "vitest";
import { compressedDirForSource } from "./paths";

describe("compressedDirForSource", () => {
  it("nests _compressed beside the source parent", () => {
    expect(compressedDirForSource("/path/to/Photo.JPG")).toBe(
      "/path/to/_compressed",
    );
  });

  it("handles Windows-style paths", () => {
    expect(compressedDirForSource("C:\\photos\\shot.png")).toBe(
      "C:\\photos\\_compressed",
    );
  });

  it("returns null for empty or placeholder paths", () => {
    expect(compressedDirForSource("")).toBeNull();
    expect(compressedDirForSource("   ")).toBeNull();
    expect(compressedDirForSource("—")).toBeNull();
  });

  it("returns null when there is no parent directory", () => {
    expect(compressedDirForSource("Photo.JPG")).toBeNull();
  });
});

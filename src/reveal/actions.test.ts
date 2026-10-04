import { describe, expect, it } from "vitest";
import {
  resolveRevealPath,
  revealActionEnabled,
  type RevealTargets,
} from "./actions";

const staged: RevealTargets = {
  sourcePath: "/photos/Holiday.jpg",
};

const complete: RevealTargets = {
  sourcePath: "/photos/Holiday.jpg",
  outputPath: "/photos/_compressed/Holiday.webp",
};

describe("resolveRevealPath", () => {
  it("resolves source for staged rows", () => {
    expect(resolveRevealPath("source", staged)).toBe("/photos/Holiday.jpg");
  });

  it("resolves output only when present", () => {
    expect(resolveRevealPath("output", staged)).toBeNull();
    expect(resolveRevealPath("output", complete)).toBe(
      "/photos/_compressed/Holiday.webp",
    );
  });

  it("resolves _compressed beside the source parent", () => {
    expect(resolveRevealPath("compressed", staged)).toBe(
      "/photos/_compressed",
    );
  });
});

describe("revealActionEnabled", () => {
  it("disables reveal output when path missing", () => {
    expect(revealActionEnabled("output", staged)).toBe(false);
    expect(revealActionEnabled("output", complete)).toBe(true);
  });

  it("disables source when placeholder", () => {
    expect(revealActionEnabled("source", { sourcePath: "—" })).toBe(false);
  });
});

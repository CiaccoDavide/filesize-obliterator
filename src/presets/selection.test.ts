import { describe, expect, it } from "vitest";
import type { StagedFile } from "../intake/types";
import {
  applyKindPreset,
  kindsPresent,
  withDefaultPresets,
} from "./selection";

const file = (
  path: string,
  kind: StagedFile["kind"],
  presetId = "",
): StagedFile => ({
  id: path,
  path,
  name: path.split("/").pop()!,
  kind,
  bytes: 10,
  status: "staged",
  presetId,
});

describe("kindsPresent", () => {
  it("lists unique kinds in stable order", () => {
    expect(
      kindsPresent([
        file("/a.mp3", "audio"),
        file("/b.png", "image"),
        file("/c.jpg", "image"),
        file("/d.pdf", "pdf"),
      ]),
    ).toEqual(["image", "audio", "pdf"]);
  });

  it("returns empty for empty staging", () => {
    expect(kindsPresent([])).toEqual([]);
  });
});

describe("applyKindPreset", () => {
  it("updates presetId only for the matching kind", () => {
    const next = applyKindPreset(
      [file("/a.png", "image", "image-balanced"), file("/b.mp3", "audio", "audio-balanced")],
      "image",
      "image-small",
    );
    expect(next[0].presetId).toBe("image-small");
    expect(next[1].presetId).toBe("audio-balanced");
  });
});

describe("withDefaultPresets", () => {
  it("assigns per-kind defaults and leaves existing presetIds alone", () => {
    const defaults = {
      image: "image-balanced",
      audio: "audio-balanced",
      video: "video-balanced",
      pdf: "pdf-ebook",
    };
    const next = withDefaultPresets(
      [
        file("/a.png", "image"),
        file("/b.mp3", "audio", "audio-high"),
      ],
      defaults,
    );
    expect(next[0].presetId).toBe("image-balanced");
    expect(next[1].presetId).toBe("audio-high");
  });
});

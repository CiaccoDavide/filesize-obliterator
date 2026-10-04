import { describe, expect, it } from "vitest";
import { detectKind } from "./kinds";

describe("detectKind", () => {
  it("classifies common image extensions", () => {
    expect(detectKind("/tmp/shot.PNG")).toBe("image");
    expect(detectKind("C:\\photos\\a.webp")).toBe("image");
  });

  it("classifies audio, video, and pdf", () => {
    expect(detectKind("/a/track.mp3")).toBe("audio");
    expect(detectKind("/a/clip.mkv")).toBe("video");
    expect(detectKind("/a/doc.PDF")).toBe("pdf");
  });

  it("rejects unknown extensions", () => {
    expect(detectKind("/a/notes.txt")).toBe("unsupported");
    expect(detectKind("/a/archive.zip")).toBe("unsupported");
  });

  it("prefers MIME when provided", () => {
    expect(detectKind("/a/mystery.bin", "image/png")).toBe("image");
    expect(detectKind("/a/file.png", "application/pdf")).toBe("pdf");
    expect(detectKind("/a/file.png", "text/plain")).toBe("unsupported");
  });

  it("falls back to extension when MIME empty", () => {
    expect(detectKind("/a/song.flac", "")).toBe("audio");
    expect(detectKind("/a/song.flac", null)).toBe("audio");
  });
});

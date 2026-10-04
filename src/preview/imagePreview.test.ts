import { describe, expect, it } from "vitest";
import type { ProgressRow } from "../compress/progressState";
import {
  formatImageMeta,
  isImagePreviewable,
  localAssetUrl,
  previewKey,
} from "./imagePreview";

function row(
  partial: Partial<ProgressRow> & Pick<ProgressRow, "jobId" | "phase">,
): ProgressRow {
  return {
    sourcePath: partial.sourcePath ?? "/in/photo.jpg",
    mediaKind: partial.mediaKind ?? "image",
    presetId: partial.presetId ?? "image-balanced",
    percent: partial.percent ?? (partial.phase === "COMPLETE" ? 100 : 0),
    ...partial,
  };
}

describe("isImagePreviewable", () => {
  it("allows a completed image job with source and output paths", () => {
    expect(
      isImagePreviewable(
        row({
          jobId: "1",
          phase: "COMPLETE",
          outputPath: "/out/photo.jpg",
          originalBytes: 1000,
          resultBytes: 400,
        }),
      ),
    ).toBe(true);
  });

  it("rejects non-image media even when complete", () => {
    expect(
      isImagePreviewable(
        row({
          jobId: "2",
          phase: "COMPLETE",
          mediaKind: "video",
          outputPath: "/out/clip.mp4",
        }),
      ),
    ).toBe(false);
  });

  it("rejects incomplete or pathless image jobs", () => {
    expect(
      isImagePreviewable(
        row({ jobId: "3", phase: "COMPRESSING", outputPath: "/out/a.jpg" }),
      ),
    ).toBe(false);
    expect(
      isImagePreviewable(
        row({
          jobId: "4",
          phase: "COMPLETE",
          sourcePath: "",
          outputPath: "/out/a.jpg",
        }),
      ),
    ).toBe(false);
    expect(
      isImagePreviewable(row({ jobId: "5", phase: "COMPLETE" })),
    ).toBe(false);
  });
});

describe("previewKey", () => {
  it("keys preview by source and output paths", () => {
    expect(previewKey("/a.jpg", "/b.jpg")).toBe("/a.jpg\0/b.jpg");
  });
});

describe("localAssetUrl", () => {
  it("converts filesystem paths through the provided converter", () => {
    const convert = (path: string) => `asset://localhost/${encodeURIComponent(path)}`;
    expect(localAssetUrl("/Users/me/pic.png", convert)).toBe(
      "asset://localhost/%2FUsers%2Fme%2Fpic.png",
    );
    expect(localAssetUrl("C:\\Users\\me\\pic.png", convert)).toBe(
      "asset://localhost/C%3A%5CUsers%5Cme%5Cpic.png",
    );
  });

  it("rejects empty paths", () => {
    expect(() => localAssetUrl("", () => "x")).toThrow(/path/i);
    expect(() => localAssetUrl("   ", () => "x")).toThrow(/path/i);
  });

  it("rejects relative paths, URI schemes, and parent traversal", () => {
    expect(() => localAssetUrl("pic.png", () => "x")).toThrow(/absolute/i);
    expect(() => localAssetUrl("https://evil.example/a.png", () => "x")).toThrow(
      /scheme/i,
    );
    expect(() => localAssetUrl("asset://localhost/x", () => "x")).toThrow(/scheme/i);
    expect(() => localAssetUrl("file:///tmp/a.png", () => "x")).toThrow(/scheme/i);
    expect(() => localAssetUrl("/Users/me/../secret/pic.png", () => "x")).toThrow(
      /traversal/i,
    );
  });
});

describe("formatImageMeta", () => {
  it("shows dimensions and bytes when both known", () => {
    expect(formatImageMeta(1920, 1080, 2048, (n) => `${n} B`)).toBe(
      "1920×1080 · 2048 B",
    );
  });

  it("falls back when dimensions unknown", () => {
    expect(formatImageMeta(null, null, 512, (n) => `${n} B`)).toBe("512 B");
  });
});

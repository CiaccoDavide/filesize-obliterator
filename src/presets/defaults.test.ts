import { describe, expect, it } from "vitest";
import type { PresetInfo } from "../ipc/compress";
import { pickDefaultPresetId } from "./defaults";

const imagePresets: PresetInfo[] = [
  {
    id: "image-high",
    label: "High",
    kind: "image",
    description: "q90",
  },
  {
    id: "image-balanced",
    label: "Balanced",
    kind: "image",
    description: "q75",
  },
  {
    id: "image-small",
    label: "Small",
    kind: "image",
    description: "q45",
  },
];

const pdfPresets: PresetInfo[] = [
  {
    id: "pdf-print",
    label: "Print",
    kind: "pdf",
    description: "300dpi",
  },
  {
    id: "pdf-ebook",
    label: "Ebook",
    kind: "pdf",
    description: "150dpi",
  },
  {
    id: "pdf-screen",
    label: "Screen",
    kind: "pdf",
    description: "72dpi",
  },
];

describe("pickDefaultPresetId", () => {
  it("prefers the balanced preset when present", () => {
    expect(pickDefaultPresetId(imagePresets)).toBe("image-balanced");
  });

  it("prefers ebook as the balanced PDF default", () => {
    expect(pickDefaultPresetId(pdfPresets)).toBe("pdf-ebook");
  });

  it("returns null when the kind has no presets", () => {
    expect(pickDefaultPresetId([])).toBeNull();
  });

  it("falls back to the first preset when no balanced/ebook id exists", () => {
    expect(
      pickDefaultPresetId([
        {
          id: "image-high",
          label: "High",
          kind: "image",
          description: "q90",
        },
      ]),
    ).toBe("image-high");
  });
});

// @vitest-environment happy-dom
import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresetInfo } from "../ipc/compress";
import { accessibleName, tabbableInOrder } from "../a11y/tabbable";
import { PresetPicker } from "./PresetPicker";

const imagePresets: PresetInfo[] = [
  {
    id: "img-small",
    label: "Small",
    description: "Smaller images",
    kind: "image",
  },
  {
    id: "img-balanced",
    label: "Balanced",
    description: "Balanced images",
    kind: "image",
  },
  {
    id: "img-large",
    label: "Large",
    description: "Larger images",
    kind: "image",
  },
];

describe("PresetPicker listbox", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(ui: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(ui);
    });
  }

  it("exposes one tab stop per kind via roving tabindex options", () => {
    render(
      <PresetPicker
        kinds={["image"]}
        byKind={{ image: imagePresets, audio: [], video: [], pdf: [] }}
        selected={{ image: "img-balanced" }}
        onSelect={() => {}}
      />,
    );
    const listbox = host.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox!.getAttribute("aria-label")).toBe("image preset");

    const options = Array.from(host.querySelectorAll('[role="option"]'));
    expect(options).toHaveLength(3);
    expect(options.every((o) => o.tagName !== "BUTTON")).toBe(true);

    const tabStops = tabbableInOrder(host);
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]!.getAttribute("role")).toBe("option");
    expect(tabStops[0]!.getAttribute("aria-selected")).toBe("true");
    expect(accessibleName(tabStops[0]!)).toBe("Balanced");
  });

  it("moves selection with arrow keys", () => {
    const onSelect = vi.fn();
    render(
      <PresetPicker
        kinds={["image"]}
        byKind={{ image: imagePresets, audio: [], video: [], pdf: [] }}
        selected={{ image: "img-balanced" }}
        onSelect={onSelect}
      />,
    );
    const selected = host.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    )!;
    act(() => {
      selected.focus();
      selected.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(onSelect).toHaveBeenCalledWith("image", "img-large");
  });
});

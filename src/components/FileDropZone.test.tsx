// @vitest-environment happy-dom
import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileDropZone } from "./FileDropZone";

describe("FileDropZone", () => {
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

  it("exposes a named region that is not a tab stop or button", () => {
    render(<FileDropZone dragActive={false} onPick={() => {}} />);
    const zone = host.querySelector('[data-testid="drop-zone"]');
    expect(zone).not.toBeNull();
    expect(zone!.getAttribute("role")).toBe("region");
    expect(zone!.getAttribute("aria-label")).toBe("File intake drop zone");
    expect(zone!.getAttribute("tabindex")).toBeNull();
    expect((zone as HTMLElement).tabIndex).toBe(-1);
  });

  it("activates via Browse button with an accessible name", () => {
    const onPick = vi.fn();
    render(<FileDropZone dragActive={false} onPick={onPick} />);
    const browse = host.querySelector<HTMLButtonElement>("[data-drop-browse]");
    expect(browse).not.toBeNull();
    expect(browse!.getAttribute("aria-label")).toBe("Browse files to stage");
    act(() => {
      browse!.click();
    });
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("exposes WATCH toggle that reports pressed while watching", () => {
    const onToggle = vi.fn();
    render(
      <FileDropZone
        dragActive={false}
        onPick={() => {}}
        watching
        onToggleWatch={onToggle}
      />,
    );
    const watchBtn = host.querySelector<HTMLButtonElement>(
      '[data-testid="watch-toggle"]',
    );
    expect(watchBtn).not.toBeNull();
    expect(watchBtn!.getAttribute("aria-pressed")).toBe("true");
    expect(watchBtn!.textContent).toBe("WATCHING");
    act(() => {
      watchBtn!.click();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

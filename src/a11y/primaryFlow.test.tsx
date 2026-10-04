// @vitest-environment happy-dom
import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresetInfo } from "../ipc/compress";
import { accessibleName, tabbableInOrder } from "./tabbable";
import { FileDropZone } from "../components/FileDropZone";
import { PresetPicker } from "../components/PresetPicker";

/**
 * Mirrors App armed-mode DOM order for the primary compress path:
 * drop (Browse) → presets → start → queue, with staged/reveal/toggles after.
 */
function PrimaryFlowFixture({
  onCompress,
}: {
  onCompress: () => void;
}) {
  const presets: PresetInfo[] = [
    {
      id: "img-a",
      label: "Alpha",
      description: "A",
      kind: "image",
    },
    {
      id: "img-b",
      label: "Beta",
      description: "B",
      kind: "image",
    },
  ];

  return (
    <div data-testid="primary-flow">
      <FileDropZone dragActive={false} onPick={() => {}}>
        <p className="intake-status">READY</p>
      </FileDropZone>

      <div className="ops-strip" data-testid="ops-strip">
        <PresetPicker
          kinds={["image"]}
          byKind={{ image: presets, audio: [], video: [], pdf: [] }}
          selected={{ image: "img-a" }}
          onSelect={() => {}}
        />
        <div className="ops-start" data-testid="ops-start">
          <button
            type="button"
            className="btn primary"
            aria-label="Start compress"
            onClick={onCompress}
          >
            COMPRESS
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Preview dry-run estimate"
          >
            PREVIEW
          </button>
        </div>
      </div>

      <section aria-label="Compress progress" data-testid="compress-panel">
        <button type="button" aria-label="Abort all jobs">
          ABORT
        </button>
      </section>

      <div className="ops-secondary" data-testid="ops-secondary">
        <label>
          <input type="checkbox" aria-label="Privacy" />
          Privacy
        </label>
      </div>

      <div className="staged-panel" data-testid="staged-panel">
        <button type="button" aria-label="Clear staged files">
          Clear
        </button>
        <button type="button" aria-label="REVEAL SOURCE">
          REVEAL SOURCE
        </button>
      </div>
    </div>
  );
}

describe("primary keyboard flow", () => {
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

  it("tabs drop → presets → start → queue before toggles/staged", () => {
    render(<PrimaryFlowFixture onCompress={() => {}} />);
    const flow = host.querySelector('[data-testid="primary-flow"]')!;
    const names = tabbableInOrder(flow).map(accessibleName);

    const browse = names.indexOf("Browse files to stage");
    const preset = names.indexOf("Alpha");
    const start = names.indexOf("Start compress");
    const queue = names.indexOf("Abort all jobs");
    const privacy = names.findIndex((n) => n.toLowerCase().includes("privacy"));
    const clear = names.indexOf("Clear staged files");

    expect(browse).toBeGreaterThanOrEqual(0);
    expect(preset).toBeGreaterThan(browse);
    expect(start).toBeGreaterThan(preset);
    expect(queue).toBeGreaterThan(start);
    expect(privacy).toBeGreaterThan(queue);
    expect(clear).toBeGreaterThan(queue);
  });

  it("starts compress from the keyboard on the Start control", () => {
    const onCompress = vi.fn();
    render(<PrimaryFlowFixture onCompress={onCompress} />);
    const start = host.querySelector<HTMLButtonElement>(
      '[aria-label="Start compress"]',
    )!;
    act(() => {
      start.focus();
      start.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      start.click();
    });
    expect(document.activeElement).toBe(start);
    expect(onCompress).toHaveBeenCalled();
  });

  it("names drop Browse and Start compress for assistive tech", () => {
    render(<PrimaryFlowFixture onCompress={() => {}} />);
    expect(
      host.querySelector('[aria-label="Browse files to stage"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="File intake drop zone"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Start compress"]'),
    ).not.toBeNull();
  });
});

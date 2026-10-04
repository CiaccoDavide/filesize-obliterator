// @vitest-environment happy-dom
import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProgressRow } from "../compress/progressState";
import { CompressProgressPanel } from "./CompressProgressPanel";

const row = (over: Partial<ProgressRow> = {}): ProgressRow => ({
  jobId: "job-1",
  sourcePath: "/tmp/a.png",
  mediaKind: "image",
  presetId: "stub",
  phase: "AWAITING",
  percent: 0,
  bytesTotal: 1000,
  originalBytes: 1000,
  ...over,
});

describe("CompressProgressPanel motion hooks", () => {
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

  const baseProps = {
    batchSummary: null,
    error: null,
    canAbort: true,
    aborting: false,
    canRetryFailed: false,
    canDismissFailed: false,
    onAbort: vi.fn(),
    onCancelOne: vi.fn(),
    onClearFinished: vi.fn(),
    onRetryFailed: vi.fn(),
    onDismissFailed: vi.fn(),
  };

  it("marks session meters complete for one-shot flash on COMPLETE", () => {
    render(
      <CompressProgressPanel
        {...baseProps}
        rows={[row({ phase: "COMPLETE", percent: 100, resultBytes: 400 })]}
        phase="COMPLETE"
        canAbort={false}
      />,
    );
    const meters = host.querySelector('[data-testid="session-meters"]');
    expect(meters).not.toBeNull();
    expect(meters!.classList.contains("meters-complete")).toBe(true);
    expect(host.querySelector(".compress-row.is-complete")).not.toBeNull();
  });

  it("shows abort spinner language while ABORTING", () => {
    render(
      <CompressProgressPanel
        {...baseProps}
        rows={[row({ phase: "ABORTING", percent: 40 })]}
        phase="ABORTING"
        aborting
      />,
    );
    expect(host.querySelector(".abort-spinner")).not.toBeNull();
    expect(host.querySelector(".compress-row.is-aborting")).not.toBeNull();
    expect(host.textContent).toContain("ABORTING");
  });

  it("keeps running fill class while COMPRESSING", () => {
    render(
      <CompressProgressPanel
        {...baseProps}
        rows={[row({ phase: "COMPRESSING", percent: 55 })]}
        phase="COMPRESSING"
      />,
    );
    expect(host.querySelector(".compress-bar-fill.is-running")).not.toBeNull();
    expect(host.querySelector(".hud-tick")).not.toBeNull();
  });
});

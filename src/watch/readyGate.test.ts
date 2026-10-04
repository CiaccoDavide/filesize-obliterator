import { describe, expect, it } from "vitest";
import { createWatchReadyGate } from "./readyGate";

describe("createWatchReadyGate", () => {
  it("rejects ready until armed", () => {
    const gate = createWatchReadyGate();
    expect(gate.shouldHandleReady()).toBe(false);
  });

  it("accepts ready while armed", () => {
    const gate = createWatchReadyGate();
    gate.arm();
    expect(gate.shouldHandleReady()).toBe(true);
  });

  it("rejects ready after disarm so post-stop queued ready cannot enqueue", () => {
    const gate = createWatchReadyGate();
    gate.arm();
    gate.disarm();
    expect(gate.shouldHandleReady()).toBe(false);
  });

  it("re-arms for a new watch session after disarm", () => {
    const gate = createWatchReadyGate();
    gate.arm();
    gate.disarm();
    gate.arm();
    expect(gate.shouldHandleReady()).toBe(true);
  });
});

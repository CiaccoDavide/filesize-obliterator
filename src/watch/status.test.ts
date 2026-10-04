import { describe, expect, it } from "vitest";
import { WATCHING_STATUS, watchHudStatus } from "./status";

describe("watchHudStatus", () => {
  it("returns WATCHING while a folder watch is active", () => {
    expect(
      watchHudStatus({ watching: true, path: "/tmp/inbox" }),
    ).toBe(WATCHING_STATUS);
  });

  it("returns null when watch is off", () => {
    expect(watchHudStatus({ watching: false })).toBeNull();
  });
});

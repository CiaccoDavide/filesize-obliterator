import { describe, expect, it } from "vitest";
import { BRIEFING_STEPS, isBriefingOpen } from "./briefing";

describe("BRIEFING_STEPS", () => {
  it("states offline and _compressed behavior in 3–4 steps", () => {
    expect(BRIEFING_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(BRIEFING_STEPS.length).toBeLessThanOrEqual(4);
    const joined = BRIEFING_STEPS.join(" ");
    expect(joined).toMatch(/_compressed/);
    expect(joined.toLowerCase()).toMatch(/offline/);
  });
});

describe("isBriefingOpen", () => {
  it("stays closed until settings have loaded", () => {
    expect(
      isBriefingOpen({
        settingsLoaded: false,
        briefingSeen: false,
        helpRequested: false,
      }),
    ).toBe(false);
  });

  it("opens on first launch when briefingSeen is false", () => {
    expect(
      isBriefingOpen({
        settingsLoaded: true,
        briefingSeen: false,
        helpRequested: false,
      }),
    ).toBe(true);
  });

  it("stays closed after ACK unless HELP reopens it", () => {
    expect(
      isBriefingOpen({
        settingsLoaded: true,
        briefingSeen: true,
        helpRequested: false,
      }),
    ).toBe(false);
    expect(
      isBriefingOpen({
        settingsLoaded: true,
        briefingSeen: true,
        helpRequested: true,
      }),
    ).toBe(true);
  });
});

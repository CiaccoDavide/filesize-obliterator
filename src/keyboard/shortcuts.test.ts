import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  detectPlatform,
  formatChord,
  isTypingTarget,
  matchShortcut,
  type KeyEventLike,
} from "./shortcuts";

function ev(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    key: partial.key,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    altKey: partial.altKey ?? false,
    shiftKey: partial.shiftKey ?? false,
  };
}

describe("detectPlatform", () => {
  it("treats Mac and iOS as mac", () => {
    expect(detectPlatform("MacIntel")).toBe("mac");
    expect(detectPlatform("iPhone")).toBe("mac");
  });

  it("treats Windows and Linux as win (Ctrl modifier)", () => {
    expect(detectPlatform("Win32")).toBe("win");
    expect(detectPlatform("Linux x86_64")).toBe("win");
  });
});

describe("isTypingTarget", () => {
  it("ignores shortcuts in text-entry controls", () => {
    expect(isTypingTarget({ tagName: "INPUT", isContentEditable: false })).toBe(
      true,
    );
    expect(
      isTypingTarget({
        tagName: "INPUT",
        isContentEditable: false,
        inputType: "text",
      }),
    ).toBe(true);
    expect(
      isTypingTarget({ tagName: "TEXTAREA", isContentEditable: false }),
    ).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT", isContentEditable: false })).toBe(
      true,
    );
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
  });

  it("allows shortcuts on non-text inputs and ordinary elements", () => {
    expect(
      isTypingTarget({
        tagName: "INPUT",
        isContentEditable: false,
        inputType: "range",
      }),
    ).toBe(false);
    expect(
      isTypingTarget({
        tagName: "INPUT",
        isContentEditable: false,
        inputType: "checkbox",
      }),
    ).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON", isContentEditable: false })).toBe(
      false,
    );
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: false })).toBe(
      false,
    );
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("matchShortcut", () => {
  it("maps Cmd+O on mac and Ctrl+O on win to pickFiles", () => {
    expect(matchShortcut(ev({ key: "o", metaKey: true }), "mac")).toBe(
      "pickFiles",
    );
    expect(matchShortcut(ev({ key: "o", ctrlKey: true }), "win")).toBe(
      "pickFiles",
    );
    expect(matchShortcut(ev({ key: "o", ctrlKey: true }), "mac")).toBe(null);
  });

  it("maps mod+Enter to startCompress", () => {
    expect(matchShortcut(ev({ key: "Enter", metaKey: true }), "mac")).toBe(
      "startCompress",
    );
    expect(matchShortcut(ev({ key: "Enter", ctrlKey: true }), "win")).toBe(
      "startCompress",
    );
  });

  it("maps Escape to abortAll (gated by caller via canAbort)", () => {
    expect(matchShortcut(ev({ key: "Escape" }), "mac")).toBe("abortAll");
    expect(matchShortcut(ev({ key: "Escape" }), "win")).toBe("abortAll");
  });

  it("maps mod+Backspace to clearFinished", () => {
    expect(matchShortcut(ev({ key: "Backspace", metaKey: true }), "mac")).toBe(
      "clearFinished",
    );
    expect(matchShortcut(ev({ key: "Backspace", ctrlKey: true }), "win")).toBe(
      "clearFinished",
    );
  });

  it("maps mod+Shift+D to focusDropZone", () => {
    expect(
      matchShortcut(ev({ key: "d", metaKey: true, shiftKey: true }), "mac"),
    ).toBe("focusDropZone");
    expect(
      matchShortcut(ev({ key: "D", ctrlKey: true, shiftKey: true }), "win"),
    ).toBe("focusDropZone");
  });

  it("maps mod+, to openSettings", () => {
    expect(matchShortcut(ev({ key: ",", metaKey: true }), "mac")).toBe(
      "openSettings",
    );
    expect(matchShortcut(ev({ key: ",", ctrlKey: true }), "win")).toBe(
      "openSettings",
    );
  });

  it("maps ? to toggleHelp without requiring mod", () => {
    expect(matchShortcut(ev({ key: "?", shiftKey: true }), "mac")).toBe(
      "toggleHelp",
    );
    expect(matchShortcut(ev({ key: "?" }), "win")).toBe("toggleHelp");
  });

  it("returns null for unmatched chords", () => {
    expect(matchShortcut(ev({ key: "x" }), "mac")).toBe(null);
    expect(matchShortcut(ev({ key: "o", metaKey: true, altKey: true }), "mac")).toBe(
      null,
    );
  });
});

describe("SHORTCUTS / formatChord", () => {
  it("lists every action with platform labels", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids).toEqual([
      "pickFiles",
      "startCompress",
      "abortAll",
      "clearFinished",
      "focusDropZone",
      "openSettings",
      "toggleHelp",
    ]);
    for (const s of SHORTCUTS) {
      expect(formatChord(s, "mac").length).toBeGreaterThan(0);
      expect(formatChord(s, "win").length).toBeGreaterThan(0);
    }
  });

  it("documents abort as hard-bound only while jobs run", () => {
    const abort = SHORTCUTS.find((s) => s.id === "abortAll");
    expect(abort?.note).toMatch(/only while jobs are running/i);
  });
});

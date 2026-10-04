import { describe, expect, it, vi } from "vitest";
import { runRevealAction } from "./runReveal";

describe("runRevealAction", () => {
  it("reveals the source file via opener", async () => {
    const revealItemInDir = vi.fn().mockResolvedValue(undefined);
    const openPath = vi.fn().mockResolvedValue(undefined);

    const result = await runRevealAction(
      "source",
      { sourcePath: "/a/b.jpg" },
      { revealItemInDir, openPath },
    );

    expect(result).toEqual({ ok: true, status: "REVEALED SOURCE" });
    expect(revealItemInDir).toHaveBeenCalledWith("/a/b.jpg");
    expect(openPath).not.toHaveBeenCalled();
  });

  it("reveals output after a successful job", async () => {
    const revealItemInDir = vi.fn().mockResolvedValue(undefined);
    const openPath = vi.fn().mockResolvedValue(undefined);

    const result = await runRevealAction(
      "output",
      {
        sourcePath: "/a/b.jpg",
        outputPath: "/a/_compressed/b.webp",
      },
      { revealItemInDir, openPath },
    );

    expect(result).toEqual({ ok: true, status: "REVEALED OUTPUT" });
    expect(revealItemInDir).toHaveBeenCalledWith("/a/_compressed/b.webp");
  });

  it("opens the _compressed directory for the item parent", async () => {
    const revealItemInDir = vi.fn().mockResolvedValue(undefined);
    const openPath = vi.fn().mockResolvedValue(undefined);

    const result = await runRevealAction(
      "compressed",
      { sourcePath: "/a/b.jpg" },
      { revealItemInDir, openPath },
    );

    expect(result).toEqual({ ok: true, status: "OPENED _COMPRESSED" });
    expect(openPath).toHaveBeenCalledWith("/a/_compressed");
    expect(revealItemInDir).not.toHaveBeenCalled();
  });

  it("returns PATH MISSING without calling opener when path absent", async () => {
    const revealItemInDir = vi.fn();
    const openPath = vi.fn();

    const result = await runRevealAction(
      "output",
      { sourcePath: "/a/b.jpg" },
      { revealItemInDir, openPath },
    );

    expect(result).toEqual({ ok: false, status: "PATH MISSING" });
    expect(revealItemInDir).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("maps opener failures to a terse status instead of throwing", async () => {
    const revealItemInDir = vi
      .fn()
      .mockRejectedValue(new Error("path does not exist"));
    const openPath = vi.fn();

    const result = await runRevealAction(
      "source",
      { sourcePath: "/gone.jpg" },
      { revealItemInDir, openPath },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe("PATH MISSING");
  });
});

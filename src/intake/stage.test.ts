import { describe, expect, it } from "vitest";
import { stageResolvedPaths } from "./stage";
import type { ResolvedPath, StagedFile } from "./types";

const probe = (
  path: string,
  bytes = 100,
  fromDirectory = false,
): ResolvedPath => ({
  path,
  name: path.split("/").pop()!,
  bytes,
  fromDirectory,
});

describe("stageResolvedPaths", () => {
  it("stages supported files with path kind and size", () => {
    const { staged, status } = stageResolvedPaths(
      [],
      [probe("/tmp/a.png", 2048), probe("/tmp/b.mp3", 4096)],
    );
    expect(staged).toHaveLength(2);
    expect(staged[0]).toMatchObject({
      path: "/tmp/a.png",
      kind: "image",
      bytes: 2048,
      status: "staged",
    });
    expect(staged[1].kind).toBe("audio");
    expect(status).toContain("STAGED 2");
  });

  it("does not stage unsupported files and reports terse reject status", () => {
    const { staged, status } = stageResolvedPaths([], [probe("/tmp/notes.txt")]);
    expect(staged).toHaveLength(0);
    expect(status).toBe("REJECTED — unsupported · notes.txt");
  });

  it("skips duplicates by absolute path", () => {
    const existing: StagedFile[] = [
      {
        id: "/tmp/a.png",
        path: "/tmp/a.png",
        name: "a.png",
        kind: "image",
        bytes: 10,
        status: "staged",
      },
    ];
    const { staged, status } = stageResolvedPaths(existing, [
      probe("/tmp/a.png", 99),
    ]);
    expect(staged).toHaveLength(1);
    expect(staged[0].bytes).toBe(10);
    expect(status).toBe("ALREADY STAGED");
  });

  it("stages files that came from a one-level directory expand", () => {
    const { staged } = stageResolvedPaths(
      [],
      [
        probe("/folder/a.jpg", 1, true),
        probe("/folder/skip.txt", 1, true),
      ],
    );
    expect(staged.map((f) => f.path)).toEqual(["/folder/a.jpg"]);
  });
});

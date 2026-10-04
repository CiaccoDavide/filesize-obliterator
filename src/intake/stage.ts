import { detectKind } from "./kinds";
import type { ResolvedPath, StagedFile } from "./types";

export type StageResult = {
  staged: StagedFile[];
  /** Terse HUD status line for the batch. */
  status: string;
};

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function makeId(path: string): string {
  return path;
}

/**
 * Stage supported files from resolved path probes.
 * Unsupported paths are not staged. Folder expansion is done by `intake_resolve`
 * (one level of immediate files); this only filters and merges.
 */
export function stageResolvedPaths(
  existing: StagedFile[],
  resolved: ResolvedPath[],
  mimeByPath: Record<string, string> = {},
): StageResult {
  const byPath = new Map(existing.map((f) => [f.path, f]));
  let added = 0;
  let rejected = 0;
  let duplicates = 0;
  let lastRejectName = "";

  for (const item of resolved) {
    const kind = detectKind(item.path, mimeByPath[item.path]);
    if (kind === "unsupported") {
      rejected += 1;
      lastRejectName = item.name || basename(item.path);
      continue;
    }
    if (byPath.has(item.path)) {
      duplicates += 1;
      continue;
    }
    const entry: StagedFile = {
      id: makeId(item.path),
      path: item.path,
      name: item.name || basename(item.path),
      kind,
      bytes: item.bytes,
      status: "staged",
    };
    byPath.set(item.path, entry);
    added += 1;
  }

  const staged = Array.from(byPath.values());
  return { staged, status: statusLine({ added, rejected, duplicates, lastRejectName, total: staged.length }) };
}

function statusLine(stats: {
  added: number;
  rejected: number;
  duplicates: number;
  lastRejectName: string;
  total: number;
}): string {
  if (stats.added === 0 && stats.rejected > 0 && stats.duplicates === 0) {
    if (stats.rejected === 1) {
      return `REJECTED — unsupported · ${stats.lastRejectName}`;
    }
    return `REJECTED — ${stats.rejected} unsupported`;
  }
  if (stats.added === 0 && stats.duplicates > 0 && stats.rejected === 0) {
    return "ALREADY STAGED";
  }
  if (stats.added === 0) {
    return "NO CHANGE";
  }
  const parts = [`STAGED ${stats.added}`];
  if (stats.rejected > 0) parts.push(`${stats.rejected} rejected`);
  if (stats.duplicates > 0) parts.push(`${stats.duplicates} dup`);
  parts.push(`${stats.total} total`);
  return parts.join(" · ");
}

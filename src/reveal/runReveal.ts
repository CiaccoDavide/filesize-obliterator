import {
  resolveRevealPath,
  type RevealAction,
  type RevealTargets,
} from "./actions";

/** Platform opener seam — defaults to Tauri plugin-opener (local paths only). */
export type RevealOpener = {
  revealItemInDir: (path: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
};

export type RevealResult = {
  ok: boolean;
  status: string;
};

function terseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.trim();
  if (!msg) return "PATH MISSING";
  if (/not found|does not exist|no such file|path missing/i.test(msg)) {
    return "PATH MISSING";
  }
  // Keep HUD status terse.
  const clipped = msg.length > 80 ? `${msg.slice(0, 77)}…` : msg;
  return `REVEAL FAILED — ${clipped}`;
}

/**
 * Reveal a file in the OS file manager, or open a directory.
 * Missing/unresolved paths return a terse status without throwing.
 */
export async function runRevealAction(
  action: RevealAction,
  targets: RevealTargets,
  opener: RevealOpener,
): Promise<RevealResult> {
  const path = resolveRevealPath(action, targets);
  if (!path) {
    return { ok: false, status: "PATH MISSING" };
  }

  try {
    if (action === "compressed") {
      await opener.openPath(path);
      return { ok: true, status: "OPENED _COMPRESSED" };
    }
    await opener.revealItemInDir(path);
    return {
      ok: true,
      status: action === "output" ? "REVEALED OUTPUT" : "REVEALED SOURCE",
    };
  } catch (err: unknown) {
    return { ok: false, status: terseError(err) };
  }
}

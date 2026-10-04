import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  runRevealAction,
  type RevealResult,
} from "../reveal/runReveal";
import type { RevealAction, RevealTargets } from "../reveal/actions";

const tauriOpener = {
  revealItemInDir: (path: string) => revealItemInDir(path),
  openPath: (path: string) => openPath(path),
};

/** Reveal/open via Tauri opener plugin (local paths only — never URLs). */
export function revealInFileManager(
  action: RevealAction,
  targets: RevealTargets,
): Promise<RevealResult> {
  return runRevealAction(action, targets, tauriOpener);
}

export type { RevealAction, RevealTargets, RevealResult };

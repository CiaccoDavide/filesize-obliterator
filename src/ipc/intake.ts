import { invoke } from "@tauri-apps/api/core";
import type { ResolvedPath } from "../intake/types";

export function intakeResolve(paths: string[]): Promise<ResolvedPath[]> {
  return invoke<ResolvedPath[]>("intake_resolve", { paths });
}

/** Kind detection for intake — includes reject bucket. */
export type IntakeKind = "image" | "audio" | "video" | "pdf" | "unsupported";

/** Staged for compression (unsupported never lands here). */
export type StagedFile = {
  id: string;
  path: string;
  name: string;
  kind: Exclude<IntakeKind, "unsupported">;
  bytes: number;
  status: "staged";
  /** Backend preset id from `compress_list_presets` (empty until assigned). */
  presetId: string;
};

/** Path probe result from Rust `intake_resolve`. */
export type ResolvedPath = {
  path: string;
  name: string;
  bytes: number;
  /** True when the path was a directory before one-level expand. */
  fromDirectory: boolean;
};

/**
 * Generation gate so abort-all can invalidate an in-flight sequential admit loop
 * even when no job rows exist yet (still awaiting compress_start).
 */
export function createBatchAdmissionController() {
  let generation = 0;
  return {
    begin(): number {
      return generation;
    },
    abort(): void {
      generation += 1;
    },
    isCurrent(token: number): boolean {
      return token === generation;
    },
  };
}

export type SequentialAdmitHandlers<TFile, TJob> = {
  isCurrent: () => boolean;
  start: (file: TFile) => Promise<TJob>;
  onAdmitted: (job: TJob) => void;
  /** Job returned from start after abort — caller should cancel it. */
  onLateAdmit: (job: TJob) => void | Promise<void>;
  /** Per-file start failure — caller may record/surface; admission continues. */
  onStartError?: (file: TFile, error: unknown) => void | Promise<void>;
};

/** Sequentially start jobs, checking the admission gate between files. */
export async function runSequentialAdmit<TFile, TJob>(
  files: TFile[],
  handlers: SequentialAdmitHandlers<TFile, TJob>,
): Promise<void> {
  for (const file of files) {
    if (!handlers.isCurrent()) return;

    let job: TJob;
    try {
      job = await handlers.start(file);
    } catch (err) {
      await handlers.onStartError?.(file, err);
      continue;
    }

    if (!handlers.isCurrent()) {
      await handlers.onLateAdmit(job);
      return;
    }

    handlers.onAdmitted(job);

    // Re-check after upsert: abortAll may have bumped the generation in the
    // window between the post-start check and onAdmitted (often with empty
    // rows), leaving a running job that was never cancelled.
    if (!handlers.isCurrent()) {
      await handlers.onLateAdmit(job);
      return;
    }
  }
}

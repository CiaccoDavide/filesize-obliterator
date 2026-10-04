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
};

/** Sequentially start jobs, checking the admission gate between files. */
export async function runSequentialAdmit<TFile, TJob>(
  files: TFile[],
  handlers: SequentialAdmitHandlers<TFile, TJob>,
): Promise<void> {
  for (const file of files) {
    if (!handlers.isCurrent()) return;
    const job = await handlers.start(file);
    if (!handlers.isCurrent()) {
      await handlers.onLateAdmit(job);
      return;
    }
    handlers.onAdmitted(job);
  }
}

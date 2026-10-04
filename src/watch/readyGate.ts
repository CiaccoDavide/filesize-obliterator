/**
 * Session gate for watch-event `ready` delivery.
 *
 * Disarm before awaiting `watch_stop` so a Ready already queued on the
 * event channel cannot enqueue/compress after the operator disables watch.
 */
export function createWatchReadyGate() {
  let generation = 0;
  let armedGeneration: number | null = null;

  return {
    /** Accept ready events for this watch session. */
    arm() {
      generation += 1;
      armedGeneration = generation;
    },
    /** Stop accepting ready events (call at the start of disable/stop). */
    disarm() {
      generation += 1;
      armedGeneration = null;
    },
    shouldHandleReady(): boolean {
      return armedGeneration !== null && armedGeneration === generation;
    },
  };
}

export type WatchReadyGate = ReturnType<typeof createWatchReadyGate>;

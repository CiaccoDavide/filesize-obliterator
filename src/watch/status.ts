/** Terse HUD status while a folder watch is active. */
export const WATCHING_STATUS = "WATCHING";

export function watchHudStatus(input: {
  watching: boolean;
  path?: string | null;
}): string | null {
  if (!input.watching) return null;
  return WATCHING_STATUS;
}

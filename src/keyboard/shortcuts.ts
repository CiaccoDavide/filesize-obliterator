/** Platform for modifier display / matching. Linux uses win (Ctrl). */
export type Platform = "mac" | "win";

export type ShortcutId =
  | "pickFiles"
  | "startCompress"
  | "abortAll"
  | "clearFinished"
  | "focusDropZone"
  | "openSettings"
  | "toggleHelp";

export type KeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type TypingTargetLike = {
  tagName: string;
  isContentEditable: boolean;
  /** HTMLInputElement.type when tagName is INPUT */
  inputType?: string;
} | null;

type Chord = {
  key: string;
  /** Primary mod: ⌘ on mac, Ctrl on win/linux */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export type ShortcutDef = {
  id: ShortcutId;
  label: string;
  /** Shown in KEYS overlay; abort documents hard-bind gate. */
  note?: string;
  chord: Chord;
};

export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: "pickFiles",
    label: "Open file picker",
    chord: { key: "o", mod: true },
  },
  {
    id: "startCompress",
    label: "Start compress",
    chord: { key: "Enter", mod: true },
  },
  {
    id: "abortAll",
    label: "Abort all",
    note: "Hard-bound only while jobs are running",
    chord: { key: "Escape" },
  },
  {
    id: "clearFinished",
    label: "Clear completed",
    chord: { key: "Backspace", mod: true },
  },
  {
    id: "focusDropZone",
    label: "Focus drop zone",
    chord: { key: "d", mod: true, shift: true },
  },
  {
    id: "openSettings",
    label: "Open settings",
    chord: { key: ",", mod: true },
  },
  {
    id: "toggleHelp",
    label: "Toggle KEYS overlay",
    chord: { key: "?" },
  },
] as const;

export function detectPlatform(navPlatform: string): Platform {
  return /Mac|iPhone|iPod|iPad/i.test(navPlatform) ? "mac" : "win";
}

const NON_TEXT_INPUT = new Set([
  "button",
  "checkbox",
  "radio",
  "range",
  "file",
  "submit",
  "reset",
  "color",
  "image",
]);

export function isTypingTarget(target: TypingTargetLike): boolean {
  if (!target) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target.inputType ?? "text").toLowerCase();
    return !NON_TEXT_INPUT.has(type);
  }
  return target.isContentEditable;
}

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase();
  return key;
}

function chordMatches(
  chord: Chord,
  e: KeyEventLike,
  platform: Platform,
): boolean {
  if (normalizeKey(e.key) !== normalizeKey(chord.key)) return false;
  const wantMod = Boolean(chord.mod);
  const wantShift = Boolean(chord.shift);
  const wantAlt = Boolean(chord.alt);
  const hasMod =
    platform === "mac" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (wantMod !== hasMod) return false;
  if (!wantMod && (e.metaKey || e.ctrlKey)) return false;
  // "?" is usually typed with Shift; ignore shift unless the chord asks for it.
  const ignoreShift = chord.key === "?" && !wantShift;
  if (!ignoreShift && wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  return true;
}

export function matchShortcut(
  e: KeyEventLike,
  platform: Platform,
): ShortcutId | null {
  for (const s of SHORTCUTS) {
    if (chordMatches(s.chord, e, platform)) return s.id;
  }
  return null;
}

export function formatChord(def: ShortcutDef, platform: Platform): string {
  const parts: string[] = [];
  if (def.chord.mod) parts.push(platform === "mac" ? "⌘" : "Ctrl");
  if (def.chord.shift) parts.push(platform === "mac" ? "⇧" : "Shift");
  if (def.chord.alt) parts.push(platform === "mac" ? "⌥" : "Alt");
  const key = def.chord.key;
  if (key === "Enter") parts.push(platform === "mac" ? "⏎" : "Enter");
  else if (key === "Escape") parts.push("Esc");
  else if (key === "Backspace") parts.push(platform === "mac" ? "⌫" : "Backspace");
  else parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join(platform === "mac" ? "" : "+");
}

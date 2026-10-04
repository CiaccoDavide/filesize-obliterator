const NATIVE =
  "a[href],button,input,select,textarea,summary,[contenteditable]:not([contenteditable='false'])";

function explicitTabIndex(el: HTMLElement): number | null {
  const raw = el.getAttribute("tabindex");
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Approximate HTML tab order within `root` (positive tabindex first, then DOM). */
export function tabbableInOrder(root: ParentNode): HTMLElement[] {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>([NATIVE, "[tabindex]"].join(",")),
  );

  const positive: { el: HTMLElement; tabIndex: number; i: number }[] = [];
  const natural: { el: HTMLElement; i: number }[] = [];
  const seen = new Set<HTMLElement>();

  candidates.forEach((el, i) => {
    if (seen.has(el)) return;
    seen.add(el);
    if (el.matches(":disabled") || el.getAttribute("disabled") != null) return;
    if (el.getAttribute("aria-hidden") === "true") return;
    if (el.getAttribute("type") === "hidden") return;

    const explicit = explicitTabIndex(el);
    if (explicit === -1) return;
    if (explicit != null && explicit > 0) {
      positive.push({ el, tabIndex: explicit, i });
      return;
    }

    // Native controls and tabindex=0 (explicit or IDL).
    if (explicit === 0 || el.matches(NATIVE)) {
      natural.push({ el, i });
    }
  });

  positive.sort((a, b) => a.tabIndex - b.tabIndex || a.i - b.i);
  natural.sort((a, b) => a.i - b.i);
  return [...positive.map((x) => x.el), ...natural.map((x) => x.el)];
}

/** Accessible name from aria-label, or trimmed text content. */
export function accessibleName(el: Element): string {
  const labeled = el.getAttribute("aria-label")?.trim();
  if (labeled) return labeled;
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

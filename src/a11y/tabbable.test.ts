// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { accessibleName, tabbableInOrder } from "./tabbable";

describe("tabbableInOrder", () => {
  it("skips tabindex=-1 and disabled controls; keeps one roving option", () => {
    document.body.innerHTML = `
      <div id="root">
        <button type="button">One</button>
        <button type="button" tabindex="-1">Skip</button>
        <button type="button" disabled>Off</button>
        <div role="listbox" aria-label="image preset">
          <div role="option" tabindex="-1">A</div>
          <div role="option" tabindex="0">B</div>
        </div>
        <button type="button" aria-label="Start compress">Go</button>
      </div>
    `;
    const names = tabbableInOrder(document.getElementById("root")!).map(
      accessibleName,
    );
    expect(names).toEqual(["One", "B", "Start compress"]);
  });
});

describe("accessibleName", () => {
  it("prefers aria-label over text", () => {
    const el = document.createElement("button");
    el.setAttribute("aria-label", "Browse files to stage");
    el.textContent = "Browse";
    expect(accessibleName(el)).toBe("Browse files to stage");
  });
});

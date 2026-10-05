import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("focus-visible tokens", () => {
  it("defines ice accent square focus rings on :focus-visible", () => {
    const css = readFileSync(join(here, "../styles/ice-hud.css"), "utf8");
    expect(css).toMatch(/--focus-ring:\s*var\(--accent\)/);
    expect(css).toMatch(/--focus-offset:\s*2px/);
    expect(css).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*1px solid var\(--focus-ring\)/s,
    );
    expect(css).toMatch(/:focus-visible\s*\{[^}]*border-radius:\s*0/s);
  });
});

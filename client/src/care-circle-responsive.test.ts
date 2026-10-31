import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(import.meta.dirname, "care-circle.css"),
  "utf8"
);
const routes = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../public/manus-routes.json"),
    "utf8"
  )
) as { routes: Array<{ path: string }> };

describe("mobile layout contracts", () => {
  it("keeps the page within the viewport and makes form controls touch-friendly", () => {
    expect(css).toContain("overflow-x: hidden");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("font-size: 16px");
  });

  it("defines a small-screen layout and a vertically scrollable modal", () => {
    expect(css).toContain("@media (max-width: 680px)");
    expect(css).toContain("max-height: min(90vh, 820px)");
    expect(css).toContain("overflow-y: auto");
  });

  it("declares the public invitation route", () => {
    expect(routes.routes.map(route => route.path)).toContain("/invite/:token");
  });
});

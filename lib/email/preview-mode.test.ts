import { describe, expect, it } from "vitest";
import { forceColorScheme, hasDarkModeSupport } from "./preview-mode";

// Matches the template renderer's compact form (no space after the colon).
const TEMPLATE_STYLE =
  `<style>:root{color-scheme:light dark;}` +
  `@media (prefers-color-scheme:dark){body,.em-bg{background:#17181D !important;}}` +
  `</style>`;

// Matches the model-authored freeform form from prompts/email-design.ts
// (space after the colon).
const MODEL_STYLE =
  `<style>@media (prefers-color-scheme: dark){.em-heading{color:#F5F6F8 !important;}}</style>`;

describe("forceColorScheme", () => {
  it("returns the html untouched for auto", () => {
    expect(forceColorScheme(TEMPLATE_STYLE, "auto")).toBe(TEMPLATE_STYLE);
    expect(forceColorScheme(MODEL_STYLE, "auto")).toBe(MODEL_STYLE);
  });

  it("forces the dark block to always match for dark", () => {
    const forced = forceColorScheme(TEMPLATE_STYLE, "dark");
    expect(forced).toContain("@media screen");
    expect(forced).not.toContain("prefers-color-scheme");
    expect(forced).toContain("background:#17181D !important");
  });

  it("neutralizes the dark block for light", () => {
    const forced = forceColorScheme(TEMPLATE_STYLE, "light");
    expect(forced).toContain("@media (min-width: 100000px)");
    expect(forced).not.toContain("prefers-color-scheme");
  });

  it("handles the spaced (model-authored) media query too", () => {
    expect(forceColorScheme(MODEL_STYLE, "dark")).toContain("@media screen");
    expect(forceColorScheme(MODEL_STYLE, "light")).toContain(
      "@media (min-width: 100000px)",
    );
  });

  it("is a no-op on html with no dark-mode block", () => {
    const plain = "<html><body>Hello</body></html>";
    expect(forceColorScheme(plain, "light")).toBe(plain);
    expect(forceColorScheme(plain, "dark")).toBe(plain);
  });

  it("never touches region markup outside the style block", () => {
    const html =
      TEMPLATE_STYLE +
      `<div data-region="headline" style="color:#0F172A;">Hi</div>`;
    const forcedDark = forceColorScheme(html, "dark");
    const forcedLight = forceColorScheme(html, "light");
    const region = `<div data-region="headline" style="color:#0F172A;">Hi</div>`;
    expect(forcedDark).toContain(region);
    expect(forcedLight).toContain(region);
  });
});

describe("hasDarkModeSupport", () => {
  it("detects both the compact and spaced media-query forms", () => {
    expect(hasDarkModeSupport(TEMPLATE_STYLE)).toBe(true);
    expect(hasDarkModeSupport(MODEL_STYLE)).toBe(true);
  });

  it("returns false for html with no dark-mode block (the real-world case)", () => {
    expect(hasDarkModeSupport("<html><body>Hello</body></html>")).toBe(false);
  });

  it("gives a stable answer across repeated calls on the same input", () => {
    // Regression guard: an earlier version shared a single `g`-flagged RegExp
    // across calls, so repeated .test() calls flipped true/false/true due to
    // lastIndex carrying over between calls.
    for (let i = 0; i < 5; i++) {
      expect(hasDarkModeSupport(TEMPLATE_STYLE)).toBe(true);
    }
  });

  it("is unaffected by interleaved forceColorScheme calls", () => {
    expect(hasDarkModeSupport(TEMPLATE_STYLE)).toBe(true);
    forceColorScheme(TEMPLATE_STYLE, "dark");
    expect(hasDarkModeSupport(TEMPLATE_STYLE)).toBe(true);
  });
});

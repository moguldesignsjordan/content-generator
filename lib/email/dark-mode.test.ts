import { describe, expect, it } from "vitest";
import { DARK_FIX_STYLE_ID, ensureDarkModeReadability } from "./dark-mode";
import { forceColorScheme } from "./preview-mode";

// A representative model-designed email: dark-mode block covers the classed
// surfaces (like the prompt asks), but one body div and one link slipped
// through without a covered class — the exact bug where dark-mode readers get
// black text on a near-black card.
function doc(body: string, style = ""): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />` +
    `<style>:root{color-scheme:light dark;}` +
    `@media (prefers-color-scheme: dark){` +
    `body,.em-bg{background:#17181D !important;}` +
    `.em-card{background:#1F2026 !important;}` +
    `.em-heading{color:#F5F6F8 !important;}` +
    `.em-text,.em-text p{color:#D6D8DE !important;}` +
    `}</style>${style}</head>` +
    `<body class="em-bg" style="background:#EEF1F6;">` +
    `<table class="em-card"><tr><td>${body}</td></tr></table>` +
    `</body></html>`
  );
}

describe("ensureDarkModeReadability", () => {
  it("lightens dark inline text the email's own dark CSS misses", () => {
    const html = doc(`<div data-region="body" style="color:#222222;font-size:16px;">Hello</div>`);
    const fixed = ensureDarkModeReadability(html);

    expect(fixed).toContain(`id="${DARK_FIX_STYLE_ID}"`);
    expect(fixed).toMatch(/class="[^"]*em-dmfx-0/);
    // The repair lives inside a dark media query with !important.
    expect(fixed).toMatch(/@media \(prefers-color-scheme:dark\)\{\.em-dmfx-0\{color:#[0-9a-f]{6} !important;\}\}/);
    // The original inline style is untouched — light mode keeps the design.
    expect(fixed).toContain("color:#222222");
  });

  it("leaves elements alone when the dark CSS already covers them", () => {
    const html = doc(
      `<h1 class="em-heading" style="color:#111111;">Title</h1>` +
        `<div class="em-text"><p style="color:#333333;">Covered by .em-text p</p></div>`,
    );
    expect(ensureDarkModeReadability(html)).toBe(html);
  });

  it("leaves light text alone", () => {
    const html = doc(`<div style="color:#ffffff;">Already readable</div>`);
    expect(ensureDarkModeReadability(html)).toBe(html);
  });

  it("keeps dark text sitting on an uncovered light surface (button labels, callouts)", () => {
    const html = doc(
      `<div style="background:#FFF7E6;"><span style="color:#1a1a1a;">Callout copy</span></div>` +
        `<a style="background:#ffffff;color:#000000;">Button label</a>`,
    );
    expect(ensureDarkModeReadability(html)).toBe(html);
  });

  it("repairs text on a covered surface even when an ancestor sets a light background", () => {
    // The card's white background IS restyled by .em-card in dark mode, so
    // dark text on it must still be repaired.
    const html = doc(`<div style="color:rgb(20, 20, 20);">Body copy</div>`);
    const fixed = ensureDarkModeReadability(html);
    expect(fixed).toContain("em-dmfx-0");
  });

  it("preserves hue when lightening brand-colored links", () => {
    const html = doc(`<a href="#" style="color:#123a8a;">Read more</a>`);
    const fixed = ensureDarkModeReadability(html);
    const m = /\.em-dmfx-0\{color:(#[0-9a-f]{6})/.exec(fixed);
    expect(m).not.toBeNull();
    const [, hex] = m!;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Still blue-leaning, but now light.
    expect(b).toBeGreaterThan(r);
    expect((r + g + b) / 3).toBeGreaterThan(180);
  });

  it("is idempotent: a second run neither duplicates classes nor style blocks", () => {
    const html = doc(`<div style="color:#222222;">Hello</div>`);
    const once = ensureDarkModeReadability(html);
    const twice = ensureDarkModeReadability(once);
    expect(twice).toBe(once);
  });

  it("returns html without dark-mode CSS unchanged", () => {
    const html = `<!DOCTYPE html><html><head></head><body><p style="color:#000;">Hi</p></body></html>`;
    expect(ensureDarkModeReadability(html)).toBe(html);
  });

  it("keeps the {$unsubscribe} merge tag intact through the rewrite", () => {
    const html = doc(
      `<div style="color:#222222;">Hello</div>` +
        `<a href="{$unsubscribe}" style="color:#555555;">Unsubscribe</a>`,
    );
    const fixed = ensureDarkModeReadability(html);
    expect(fixed).toContain(`href="{$unsubscribe}"`);
  });

  it("plays with forceColorScheme: forcing light disables the repair rules too", () => {
    const html = doc(`<div style="color:#222222;">Hello</div>`);
    const fixed = ensureDarkModeReadability(html);
    const light = forceColorScheme(fixed, "light");
    // Both dark blocks (the model's and the repair's) are neutralized.
    expect(light).not.toMatch(/@media \(prefers-color-scheme:\s*dark\)/i);
  });
});

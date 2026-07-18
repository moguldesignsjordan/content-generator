import { describe, expect, it } from "vitest";
import { ensureBrandLogo } from "./footer-logo";
import type { BrandTokens } from "./templates/types";

const LOGO_URL = "https://cdn.example.com/logos/real-logo.png";

function tokens(overrides: Partial<BrandTokens> = {}): BrandTokens {
  return {
    logo_url: LOGO_URL,
    logo_alt: "Moguls",
    colors: {
      primary: "#000000",
      secondary: "#ffffff",
      accent: "#ff9d14",
      background: "#ffffff",
      text: "#000000",
      muted: "#9ca3af",
    },
    fonts: { heading: "Georgia, serif", body: "Inter, sans-serif" },
    footer: { website: "https://moguldesignagency.com" },
    sender_name: "Moguls",
    ...overrides,
  };
}

// Mirrors the real bug: a model-designed email whose header correctly used
// the real logo <img> (per the prompt), but whose footer typed the
// text-wordmark alternative it's shown for the no-logo case instead.
function docWithTextFooterWordmark(): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /></head><body>` +
    `<table><tr><td data-region="header">` +
    `<img src="${LOGO_URL}" alt="Moguls" style="max-width:170px;max-height:48px;" />` +
    `</td></tr></table>` +
    `<table><tr><td data-region="footer">` +
    `<p><a href="https://moguldesignagency.com" style="color:#000;">Moguls` +
    `<span style="color:#ff9d14;">.</span></a></p>` +
    `<p>moguldesignagency.com</p>` +
    `<p><a href="{$unsubscribe}">Unsubscribe</a></p>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

function extractRegion(html: string, region: string): string {
  const match = new RegExp(`data-region="${region}"[\\s\\S]*?</td>`, "i").exec(html);
  if (!match) throw new Error(`region ${region} not found`);
  return match[0];
}

describe("ensureBrandLogo", () => {
  it("swaps a text wordmark for the real logo image in the footer", () => {
    const fixed = ensureBrandLogo(docWithTextFooterWordmark(), tokens());
    const footer = extractRegion(fixed, "footer");

    expect(footer).toContain(`<img src="${LOGO_URL}"`);
    expect(footer).toContain("max-width:120px");
    expect(footer).toContain("max-height:28px");
    // The link wrapper survives; only its inner text wordmark was swapped.
    expect(footer).toContain(`href="https://moguldesignagency.com"`);
    // The rest of the footer (contact line, unsubscribe) is untouched.
    expect(footer).toContain("moguldesignagency.com");
    expect(footer).toContain("{$unsubscribe}");
  });

  it("leaves an already-correct header untouched (no duplicate logo)", () => {
    const fixed = ensureBrandLogo(docWithTextFooterWordmark(), tokens());
    const header = extractRegion(fixed, "header");

    expect(header.match(/<img/g)?.length).toBe(1);
    expect(header).toContain(`src="${LOGO_URL}"`);
  });

  it("is a no-op when the footer already uses the real logo image", () => {
    const already =
      `<!DOCTYPE html><html lang="en"><head></head><body>` +
      `<table><tr><td data-region="footer">` +
      `<img src="${LOGO_URL}" alt="Moguls" /></td></tr></table>` +
      `</body></html>`;
    const fixed = ensureBrandLogo(already, tokens());
    expect(fixed.match(/<img/g)?.length).toBe(1);
  });

  it("no-ops entirely when the brand has no uploaded logo", () => {
    const html = docWithTextFooterWordmark();
    const fixed = ensureBrandLogo(html, tokens({ logo_url: null }));
    expect(fixed).toBe(html);
  });
});

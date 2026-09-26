import { describe, expect, it } from "vitest";
import { removeHeroImage, spliceHeroImage } from "@/lib/email/hero-image";
import { productShowcase } from "./product-showcase";
import type { BrandTokens, ShowcaseProduct } from "./types";
import type { ContentImage, EmailCopy, EmailStyleId } from "@/lib/db/types";
import { EMAIL_STYLE_IDS } from "@/prompts/email-styles";

const TOKENS: BrandTokens = {
  logo_url: "https://cdn.example.com/logo.png",
  logo_alt: "Test Brand",
  colors: {
    primary: "#111111",
    secondary: "#4B5563",
    accent: "#FF9D14",
    background: "#FFFFFF",
    text: "#111111",
    muted: "#4B5563",
  },
  fonts: { heading: "Arial, sans-serif", body: "Arial, sans-serif" },
  footer: { website: "https://example.com", contact_email: "hi@example.com" },
  sender_name: "Test Brand",
};

const PRODUCT: ShowcaseProduct = {
  name: "1K Business Cards",
  price: "$45",
  details: ["16PT UV coated", "Shipping included"],
  url: "https://example.com/shop/cards",
};

const IMAGE: ContentImage = {
  url: "https://cdn.example.com/cards.png",
  alt: "Business cards",
  width: 1040,
  height: 700,
  style: "uploaded",
};

const COPY: EmailCopy = {
  subject: "Cards that mean business",
  preheader: "1,000 premium cards, shipped.",
  headline: "Cards That Mean Business.",
  body_sections: [
    { heading: "Business card package", body: "Everything your brand needs to look official." },
    { heading: "Look official from the first handshake.", body: "Premium stock, UV finish." },
    { heading: "Ready to hand out your brand?", body: "1,000 cards, shipping included." },
  ],
  cta_text: "Shop Business Cards",
};

describe("productShowcase", () => {
  const html = productShowcase.render({ copy: COPY, tokens: TOKENS, product: PRODUCT, image: IMAGE });

  it("carries the unsubscribe tag and dark-mode support", () => {
    expect(html).toContain(`href="{$unsubscribe}"`);
    expect(html).toContain("prefers-color-scheme:dark");
  });

  it("sets the headline's last word in the accent color", () => {
    expect(html).toContain(`Cards That Mean <span style="color:#FF9D14;">Business.</span>`);
  });

  it("fills the product panel from the product, not the copy", () => {
    expect(html).toContain("1K Business Cards");
    expect(html).toContain("$45 &middot; 16PT UV coated &middot; Shipping included");
    expect(html).toContain("Business card package");
  });

  it("maps the middle section to a benefit block and the last to the closing", () => {
    expect(html).toContain("border-left:4px solid #FF9D14");
    expect(html).toMatch(/<h2[^>]*>Ready to hand out your brand\?<\/h2>/);
  });

  it("links the CTA to the product when the copy has no URL", () => {
    expect(html).toContain(`href="https://example.com/shop/cards" target="_blank" class="sc-cta"`);
  });

  it("puts the image in its own row that the image editor can remove and re-place", () => {
    expect(html.indexOf("cards.png")).toBeGreaterThan(html.indexOf('data-region="headline"'));
    const without = removeHeroImage(html);
    expect(without).not.toContain("cards.png");
    expect(spliceHeroImage(without, IMAGE)).toContain("cards.png");
  });

  it("escapes copy so it can't inject markup", () => {
    const out = productShowcase.render({
      copy: { ...COPY, headline: "<script>x</script> now" },
      tokens: TOKENS,
    });
    expect(out).not.toContain("<script>x");
  });

  it("renders without a product, image, or closing section", () => {
    const out = productShowcase.render({
      copy: { ...COPY, body_sections: [{ body: "Just a hero line." }] },
      tokens: TOKENS,
    });
    expect(out).toContain("Just a hero line.");
    expect(out).not.toContain("<h2");
    expect(out).not.toContain('data-region="image"');
  });

  describe("looks", () => {
    const render = (styleId: EmailStyleId) =>
      productShowcase.render({ copy: COPY, tokens: TOKENS, product: PRODUCT, image: IMAGE, styleId });

    it("defaults to the original design (soft_card)", () => {
      expect(render("soft_card")).toBe(html);
    });

    it("gives every style a complete email with its own look", () => {
      const outputs = EMAIL_STYLE_IDS.map(render);
      for (const out of outputs) {
        expect(out).toContain(`href="{$unsubscribe}"`);
        expect(out).toContain("1K Business Cards");
        expect(out).toContain("cards.png");
        expect(out).toContain("Ready to hand out your brand?");
      }
      expect(new Set(outputs).size).toBe(EMAIL_STYLE_IDS.length);
    });

    it("moves the photo above the headline in photo-first looks", () => {
      const out = render("pill_modern");
      expect(out.indexOf("cards.png")).toBeLessThan(out.indexOf('data-region="headline"'));
    });

    it("keeps readable button text on an accent-colored panel", () => {
      const out = render("bold_accent_band");
      // #FF9D14 is light, so text on it goes near-black and the panel button inverts.
      expect(out).toContain("background:#FF9D14;border:none");
      expect(out).toContain("background:#111111;color:#FF9D14");
    });
  });
});

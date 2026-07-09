import { describe, expect, it } from "vitest";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { EmailTemplateId } from "@/lib/db/types";
import { buildEmailDesignBrief } from "./email-design";
import { EMAIL_STYLE_IDS, EMAIL_STYLES } from "./email-styles";

const TOKENS: BrandTokens = {
  logo_url: null,
  logo_alt: "Test Brand",
  colors: {
    primary: "#0F172A",
    secondary: "#475569",
    accent: "#2563EB",
    background: "#FFFFFF",
    text: "#0F172A",
    muted: "#64748B",
  },
  fonts: {
    heading: "Georgia, serif",
    body: "Inter, system-ui, sans-serif",
  },
  footer: { website: "https://example.com", contact_email: "hi@example.com" },
  sender_name: "Test Brand",
};

const ALL_LAYOUTS: EmailTemplateId[] = [
  "newsletter_tip",
  "newsletter_feature",
  "newsletter_howto",
  "promotional_bold",
  "announcement_banner",
  "product_spotlight",
  "digest",
];

describe("buildEmailDesignBrief", () => {
  it("embeds the chosen style's label and directive lines", () => {
    for (const styleId of EMAIL_STYLE_IDS) {
      const brief = buildEmailDesignBrief(TOKENS, "newsletter_tip", {
        style: EMAIL_STYLES[styleId],
      });
      expect(brief).toContain(EMAIL_STYLES[styleId].label);
      for (const line of EMAIL_STYLES[styleId].lines) {
        expect(brief).toContain(line);
      }
    }
  });

  it("defaults to the soft_card style when none is given", () => {
    const brief = buildEmailDesignBrief(TOKENS, "newsletter_tip");
    expect(brief).toContain(EMAIL_STYLES.soft_card.label);
  });

  it("embeds a layout-shape directive for every layout id", () => {
    for (const layout of ALL_LAYOUTS) {
      const brief = buildEmailDesignBrief(TOKENS, layout, {
        style: EMAIL_STYLES.soft_card,
      });
      expect(brief).toContain("LAYOUT FOR THIS EMAIL:");
      expect(brief.length).toBeGreaterThan(500);
    }
  });

  // No style variant, and no layout shape, may ever drop the invariants the
  // validator (validateModelEmailHtml + hasDarkModeSupport in
  // lib/pipeline/generate.ts) requires before a model-designed email is
  // trusted over the code-template fallback.
  describe("invariants present for every style x layout combination", () => {
    for (const styleId of EMAIL_STYLE_IDS) {
      for (const layout of ALL_LAYOUTS) {
        it(`${styleId} / ${layout}`, () => {
          const brief = buildEmailDesignBrief(TOKENS, layout, {
            style: EMAIL_STYLES[styleId],
          });
          // Dark mode block requirement.
          expect(brief).toMatch(/prefers-color-scheme:\s*dark/);
          // data-region anchors (click-to-edit): the REGIONS section names
          // every required anchor, literal data-region="..." for the ones
          // that repeat (header, body), the rest as the named region.
          expect(brief).toContain("REGIONS (required");
          expect(brief).toContain('data-region="header"');
          expect(brief).toContain('data-region="body"');
          expect(brief).toContain('"headline"');
          expect(brief).toContain('"cta"');
          expect(brief).toContain('"footer"');
          // Exactly one CTA, called out explicitly.
          expect(brief).toMatch(/ONE dominant call-to-action/i);
          // The literal unsubscribe merge tag.
          expect(brief).toContain("{$unsubscribe}");
          // No em/en dashes anywhere in the brief itself.
          expect(brief).not.toMatch(/[–—]/);
          // Never use em dashes rule is stated explicitly for the model too.
          expect(brief).toMatch(/NEVER use em dashes/i);
        });
      }
    }
  });

  it("includes a hero image placement block only when a hero image is given", () => {
    const withoutHero = buildEmailDesignBrief(TOKENS, "newsletter_tip", {
      style: EMAIL_STYLES.soft_card,
    });
    expect(withoutHero).not.toContain("IMAGE (this email has a generated hero image");

    const withHero = buildEmailDesignBrief(TOKENS, "newsletter_tip", {
      style: EMAIL_STYLES.soft_card,
      heroImage: {
        url: "https://example.com/hero.png",
        alt: "A hero image",
        width: 1024,
        height: 512,
        style: "illustration",
        placement: "top",
      },
    });
    expect(withHero).toContain("IMAGE (this email has a generated hero image");
    expect(withHero).toContain('data-region="image"');
  });
});

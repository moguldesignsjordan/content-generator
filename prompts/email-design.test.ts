import { describe, expect, it } from "vitest";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { EmailTemplateId, StyleReference } from "@/lib/db/types";
import { buildDesignReferenceBlock, buildEmailDesignBrief } from "./email-design";
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

  it("uses the default accent budget with no vibe or a sleek/premium vibe", () => {
    for (const vibe of [undefined, "sleek", "premium"] as const) {
      const brief = buildEmailDesignBrief(TOKENS, "newsletter_tip", { vibe });
      expect(brief).toContain("at most 2 to 3 places");
      expect(brief).not.toContain("loosened for this piece's punchy/playful vibe");
    }
  });

  it("loosens the accent budget for a punchy or playful vibe", () => {
    for (const vibe of ["punchy", "playful"] as const) {
      const brief = buildEmailDesignBrief(TOKENS, "newsletter_tip", { vibe });
      expect(brief).toContain("loosened for this piece's punchy/playful vibe");
      expect(brief).not.toContain("at most 2 to 3 places");
    }
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

  it("specs the social badge row only when the brand has social links", () => {
    const withSocial = buildEmailDesignBrief(
      {
        ...TOKENS,
        footer: {
          ...TOKENS.footer,
          social: { linkedin: "https://linkedin.com/company/x", youtube: "https://youtube.com/@x" },
        },
      },
      "newsletter_tip",
    );
    expect(withSocial).toContain("a social row");
    expect(withSocial).toContain("https://linkedin.com/company/x");
    expect(withSocial).toContain("https://youtube.com/@x");
    expect(withSocial).toMatch(/never an\s+external icon image/i);

    const withoutSocial = buildEmailDesignBrief(TOKENS, "newsletter_tip");
    expect(withoutSocial).not.toContain("a social row");
    // The unsubscribe guarantee is spec'd regardless.
    expect(withoutSocial).toContain("{$unsubscribe}");
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

describe("buildDesignReferenceBlock", () => {
  const makeRef = (over: Partial<StyleReference> = {}): StyleReference => ({
    id: "ref-1",
    brand_id: "brand-1",
    name: "Clean promo",
    image_url: "https://example.test/a.jpg",
    storage_path: "a.jpg",
    notes: null,
    created_at: "2026-07-13T00:00:00Z",
    kind: "email",
    mode: "recreate",
    design_profile: {
      summary: "Airy and photo-led, one big product shot over a lot of white.",
      layout: ["centered logo bar", "full-width hero image", "dark footer bar"],
      palette_notes: "Mostly white, one dark block at the bottom.",
      typography_notes: "Big light headline, small all-caps button label.",
    },
    ...over,
  });

  it("returns an empty string when the brand has no email designs", () => {
    expect(buildDesignReferenceBlock(undefined)).toBe("");
    expect(buildDesignReferenceBlock([])).toBe("");
  });

  it("tells the model to RECREATE the attached design, with its sections in order", () => {
    const block = buildDesignReferenceBlock([makeRef()]);
    expect(block).toContain("RECREATE");
    expect(block).toContain("ATTACHED TO THIS MESSAGE AS AN IMAGE");
    expect(block).toContain("1. centered logo bar");
    expect(block).toContain("2. full-width hero image");
    expect(block).toContain("3. dark footer bar");
    expect(block).toContain("Airy and photo-led");
    // The design system's hard rules must still outrank the reference.
    expect(block).toContain("{$unsubscribe}");
    expect(block).toContain("WIN on any");
  });

  it("softens to inspiration in style mode", () => {
    const block = buildDesignReferenceBlock([makeRef({ mode: "style" })]);
    expect(block).toContain("INSPIRATION");
    expect(block).not.toContain("RECREATE its");
    expect(block).toContain("inspiration");
  });

  it("defaults to recreate when the row predates the mode column", () => {
    const block = buildDesignReferenceBlock([makeRef({ mode: undefined })]);
    expect(block).toContain("RECREATE");
  });

  it("uses only the newest design, never a blend of two", () => {
    const block = buildDesignReferenceBlock([
      makeRef({ id: "newest", name: "Newest" }),
      makeRef({
        id: "older",
        design_profile: {
          summary: "Dense text-only digest.",
          layout: ["plain text header"],
        },
      }),
    ]);
    expect(block).toContain("Airy and photo-led");
    expect(block).not.toContain("Dense text-only digest.");
    expect(block).not.toContain("plain text header");
  });

  it("still instructs a recreate when the one-time design read failed", () => {
    const block = buildDesignReferenceBlock([makeRef({ design_profile: null })]);
    expect(block).toContain("RECREATE");
    expect(block).toContain("read the attached image directly");
  });
});

import { describe, expect, it } from "vitest";
import type { Brand, Icp } from "@/lib/db/types";
import type { ContentImageStyle, VisualVibe } from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import {
  IMAGE_STYLE_DESCRIPTIONS,
  IMAGE_STYLE_LABELS,
  VARIED_STYLE_POOL,
  VISUAL_VIBE_IMAGE_STYLE,
  brandLookDirective,
  buildFinalImagePrompt,
  buildImageBrandContext,
  buildImagePromptMessages,
  pickVariedImageStyle,
  resolveBrandPalette,
} from "./generate-image";
import { IMAGE_STYLE_CATALOG } from "@/lib/image-styles";

const TOKENS: BrandTokens = {
  logo_url: null,
  logo_alt: "Brand",
  colors: {
    primary: "#0F172A",
    secondary: "#475569",
    accent: "#2563EB",
    background: "#FFFFFF",
    text: "#0F172A",
    muted: "#64748B",
  },
  fonts: { heading: "Georgia, serif", body: "Inter, sans-serif" },
  footer: {},
  sender_name: "Brand",
};

describe("resolveBrandPalette", () => {
  it("defaults photo to none and every other style to accents", () => {
    expect(resolveBrandPalette("photo")).toBe("none");
    const others = IMAGE_STYLE_CATALOG.map((s) => s.id).filter(
      (id) => id !== "photo",
    );
    for (const style of others) {
      expect(resolveBrandPalette(style)).toBe("accents");
    }
  });

  it("lets the brand-level pref override the per-style default", () => {
    expect(resolveBrandPalette("photo", "always")).toBe("accents");
    expect(resolveBrandPalette("illustration", "never")).toBe("none");
    expect(resolveBrandPalette("photo", "auto")).toBe("none");
  });

  it("lets a per-image override win over everything", () => {
    expect(resolveBrandPalette("photo", "always", "none")).toBe("none");
    expect(resolveBrandPalette("illustration", "never", "accents")).toBe("accents");
  });
});

describe("buildFinalImagePrompt", () => {
  it("keeps the brand hex values out of a 'none' photo prompt", () => {
    const prompt = buildFinalImagePrompt("photo", "a desk", TOKENS, undefined, "none");
    expect(prompt).not.toContain(TOKENS.colors.accent);
    expect(prompt).not.toContain(TOKENS.colors.primary);
    expect(prompt.toLowerCase()).toContain("natural");
  });

  it("splices the brand hex values into an 'accents' prompt", () => {
    const prompt = buildFinalImagePrompt(
      "illustration",
      "a desk",
      TOKENS,
      undefined,
      "accents",
    );
    expect(prompt).toContain(TOKENS.colors.accent);
    expect(prompt).toContain(TOKENS.colors.primary);
  });

  it("uses the per-style default when no mode is passed", () => {
    const photoPrompt = buildFinalImagePrompt("photo", "a desk", TOKENS);
    expect(photoPrompt).not.toContain(TOKENS.colors.accent);

    const illustrationPrompt = buildFinalImagePrompt("illustration", "a desk", TOKENS);
    expect(illustrationPrompt).toContain(TOKENS.colors.accent);
  });

  it("never leaves the {SCENE} or {COLOR} placeholders unfilled, for every catalog style", () => {
    for (const { id: style } of IMAGE_STYLE_CATALOG) {
      for (const mode of ["accents", "none"] as const) {
        const prompt = buildFinalImagePrompt(style, "a desk", TOKENS, undefined, mode);
        expect(prompt).not.toContain("{SCENE}");
        expect(prompt).not.toContain("{COLOR}");
        expect(prompt).not.toContain("{PALETTE}");
      }
    }
  });
});

describe("buildFinalImagePrompt composition", () => {
  it("appends the composition after the scaffold, before the reference directive", () => {
    const prompt = buildFinalImagePrompt(
      "photo",
      "a desk",
      TOKENS,
      "subject",
      "none",
      "Subject on the left third, open space right.",
    );
    const comp = prompt.indexOf("Composition: Subject on the left third");
    expect(comp).toBeGreaterThan(prompt.indexOf("photograph of a desk"));
    expect(prompt.indexOf("A reference image is attached")).toBeGreaterThan(comp);
  });

  it("is unchanged when no composition is given", () => {
    expect(buildFinalImagePrompt("photo", "a desk", TOKENS)).not.toContain("Composition:");
    expect(buildFinalImagePrompt("photo", "a desk", TOKENS, undefined, undefined, "  ")).not.toContain(
      "Composition:",
    );
  });
});

describe("brandLookDirective", () => {
  it("names which images are the brand's when a subject comes first", () => {
    expect(brandLookDirective(2, true)).toMatch(/^The last 2 attached images are/);
    expect(brandLookDirective(1, true)).toMatch(/^The last attached image is/);
  });

  it("refers to all attachments when there is no subject reference", () => {
    expect(brandLookDirective(1, false)).toMatch(/^The attached image is/);
    expect(brandLookDirective(2, false)).toMatch(/^The attached images are/);
  });
});

describe("style catalog", () => {
  it("has a label and description for every style", () => {
    for (const { id } of IMAGE_STYLE_CATALOG) {
      expect(IMAGE_STYLE_LABELS[id]).toBeTruthy();
      expect(IMAGE_STYLE_DESCRIPTIONS[id]).toBeTruthy();
    }
  });
});

describe("pickVariedImageStyle", () => {
  it("always returns a style from the varied pool", () => {
    for (let i = 0; i < 20; i++) {
      expect(VARIED_STYLE_POOL).toContain(pickVariedImageStyle(`draft-${i}`));
    }
    expect(VARIED_STYLE_POOL).toContain(pickVariedImageStyle());
  });

  it("is deterministic for the same seed (a retried draft keeps its style)", () => {
    const seed = "11111111-2222-3333-4444-555555555555";
    expect(pickVariedImageStyle(seed)).toBe(pickVariedImageStyle(seed));
  });

  it("actually varies across different seeds", () => {
    const seen = new Set<ContentImageStyle>();
    for (let i = 0; i < 40; i++) {
      seen.add(pickVariedImageStyle(`seed-${i}-${i * 7}`));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("VISUAL_VIBE_IMAGE_STYLE", () => {
  it("has a mapped image style for every vibe", () => {
    const vibes: VisualVibe[] = ["punchy", "sleek", "playful", "premium"];
    for (const vibe of vibes) {
      expect(VISUAL_VIBE_IMAGE_STYLE[vibe]).toBeTruthy();
    }
  });
});

describe("buildImagePromptMessages", () => {
  it("includes the email type, tone, and vibe in the user message when given", () => {
    const { user } = buildImagePromptMessages({
      brandName: "Brand",
      topicTitle: "A launch",
      style: "collage",
      emailType: "product",
      tone: "witty",
      vibe: "punchy",
    });
    expect(user).toContain("EMAIL TYPE: product");
    expect(user).toContain("TONE: witty");
    expect(user).toContain("VIBE: punchy");
  });

  it("omits those lines when not given", () => {
    const { user } = buildImagePromptMessages({
      brandName: "Brand",
      topicTitle: "A launch",
      style: "illustration",
    });
    expect(user).not.toContain("EMAIL TYPE:");
    expect(user).not.toContain("TONE:");
    expect(user).not.toContain("VIBE:");
  });
});

describe("hero scenes know the business", () => {
  const brand = {
    name: "Mogul",
    positioning: { business_description: "Websites and brand design for local service businesses" },
  } as unknown as Brand;
  const icp = { label: "Home-service owners", profile: { demographics: "35-55, run 3-20 person crews" } } as Icp;

  it("states what the business does and who it serves", () => {
    const ctx = buildImageBrandContext(brand, icp);
    expect(ctx).toContain("WHAT THE BUSINESS DOES: Websites and brand design");
    expect(ctx).toContain("WHO IT SERVES: Home-service owners, 35-55");
    expect(buildImageBrandContext({ name: "x" } as Brand, null)).toBe("");
  });

  it("passes the context and key message, and bans stock metaphors", () => {
    const { system, user } = buildImagePromptMessages({
      brandName: "Mogul",
      topicTitle: "Care plans",
      style: "photo",
      brandContext: buildImageBrandContext(brand, icp),
      keyMessage: "Your site is watched 24/7",
    });
    expect(user).toContain("WHAT THE BUSINESS DOES");
    expect(user).toContain("THE POINT IT MAKES: Your site is watched 24/7");
    expect(system).toContain("Never a stock metaphor");
  });

  it("labels a blog post as a blog post, not an email", () => {
    const { user } = buildImagePromptMessages({
      brandName: "Mogul",
      topicTitle: "How to pick a web designer",
      headline: "Seven questions",
      style: "photo",
      kind: "blog",
    });
    expect(user).toContain("BLOG POST TOPIC: How to pick a web designer");
    expect(user).toContain("BLOG POST HEADLINE: Seven questions");
    expect(user).not.toContain("EMAIL TOPIC");
  });
});

describe("pickVariedImageStyle consistency", () => {
  it("gives a brand one style when seeded by the brand id", () => {
    const brandId = "brand-123";
    const picks = new Set(Array.from({ length: 10 }, () => pickVariedImageStyle(brandId)));
    expect(picks.size).toBe(1);
  });

  it("rotates only within the house styles", () => {
    for (let i = 0; i < 30; i++) {
      expect(["photo", "duotone"]).toContain(pickVariedImageStyle(`draft-${i}`, ["photo", "duotone"]));
    }
  });
});

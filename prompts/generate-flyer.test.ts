import { describe, expect, it } from "vitest";
import {
  DESIGN_RIFFS,
  DEFAULT_FLYER_ASPECT,
  FLYER_ASPECTS,
  FLYER_STYLE_DIRECTIONS,
  FLYER_VARIANT_COUNT,
  buildFlyerCopyMessages,
  buildFlyerDesignPrompt,
  buildFlyerImagePrompt,
  buildPlaceImagePrompt,
  flyerVariantsTool,
  isFlyerAspect,
  isFlyerStyle,
  parseFlyerVariants,
  pickFlyerStyleSet,
  resolveVariantStyles,
  type FlyerCopyOutput,
} from "./generate-flyer";
import { FLYER_STYLE_CATALOG } from "@/lib/design-styles";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { CompetitorReference, FlyerStyleId } from "@/lib/db/types";

const tokens: BrandTokens = {
  logo_url: null,
  logo_alt: "Mogul",
  colors: {
    primary: "#111827",
    secondary: "#475569",
    accent: "#7C3AED",
    background: "#FAFAFA",
    text: "#111827",
    muted: "#64748B",
  },
  fonts: {
    heading: "Sora, sans-serif",
    body: "Inter, sans-serif",
  },
  footer: {},
  sender_name: "Mogul Design Agency",
};

const copy: FlyerCopyOutput = {
  headline: "Your website is losing you clients",
  subtext: "We fix that in 14 days",
  cta: "Book a call",
  caption: "Slow, dated sites cost real money. We rebuild fast.",
  hashtags: ["#webdesign"],
  scene: "A sleek laptop on a clean desk with rising analytics shapes behind it.",
};

describe("isFlyerAspect", () => {
  it("accepts exactly the three presets", () => {
    expect(isFlyerAspect("1:1")).toBe(true);
    expect(isFlyerAspect("4:5")).toBe(true);
    expect(isFlyerAspect("9:16")).toBe(true);
    expect(isFlyerAspect("16:9")).toBe(false);
    expect(isFlyerAspect(undefined)).toBe(false);
  });

  it("has a default that is a real preset", () => {
    expect(isFlyerAspect(DEFAULT_FLYER_ASPECT)).toBe(true);
    expect(FLYER_ASPECTS[DEFAULT_FLYER_ASPECT].width).toBeGreaterThan(0);
  });
});

describe("buildFlyerImagePrompt", () => {
  it("keeps the copy out of the art prompt and forbids drawn text", () => {
    const prompt = buildFlyerImagePrompt(copy, tokens, "4:5", false);
    // Text is composed in code afterwards, so no copy string reaches the model.
    expect(prompt).not.toContain("Your website is losing you clients");
    expect(prompt).not.toContain("We fix that in 14 days");
    expect(prompt).not.toContain("Book a call");
    expect(prompt).toContain("Absolutely no text anywhere");
    expect(prompt).toContain("#111827");
    expect(prompt).toContain("#7C3AED");
    expect(prompt).toContain("portrait post (4:5)");
    expect(prompt).toContain(copy.scene.replace(/\.$/, ""));
    expect(prompt).not.toContain("attached");
  });

  it("asks for a calm zone where the text panel goes", () => {
    const bottom = buildFlyerImagePrompt(copy, tokens, "1:1", false, undefined, { quietZone: "bottom" });
    expect(bottom).toContain("lower 45% of the frame calm");
    const none = buildFlyerImagePrompt(copy, tokens, "1:1", false, undefined, { quietZone: "none" });
    expect(none).not.toContain("of the frame calm");
  });

  it("locks the product when its photo is attached, and orders the references", () => {
    const prompt = buildFlyerImagePrompt(copy, tokens, "1:1", true, undefined, { hasProduct: true });
    expect(prompt).toContain("first attached image is the real product");
    expect(prompt).toContain("unchanged");
    expect(prompt).toContain("The last attached image is a style reference");
  });

  it("appends the style-transfer directive only when a reference is attached", () => {
    const withRef = buildFlyerImagePrompt(copy, tokens, "1:1", true);
    expect(withRef).toContain("An attached image is a style reference");
  });

  it("splices the design-direction preset when one is chosen", () => {
    const prompt = buildFlyerImagePrompt(copy, tokens, "1:1", false, "retro_print");
    expect(prompt).toContain(FLYER_STYLE_DIRECTIONS.retro_print);
  });

  it("drops the preset when a reference is attached (the reference IS the style)", () => {
    const prompt = buildFlyerImagePrompt(copy, tokens, "1:1", true, "retro_print");
    expect(prompt).not.toContain(FLYER_STYLE_DIRECTIONS.retro_print);
    expect(prompt).toContain("style reference");
  });

  it("no preset direction asks the model to draw a headline", () => {
    for (const direction of Object.values(FLYER_STYLE_DIRECTIONS)) {
      expect(direction.toLowerCase()).not.toMatch(/typograph|headline is|every word|crisp type/);
    }
  });
});

describe("flyer style presets", () => {
  it("accepts every catalog id and rejects junk", () => {
    for (const { id } of FLYER_STYLE_CATALOG) {
      expect(isFlyerStyle(id)).toBe(true);
      expect(FLYER_STYLE_DIRECTIONS[id]).toBeTruthy();
    }
    expect(isFlyerStyle("vaporwave")).toBe(false);
    expect(isFlyerStyle(undefined)).toBe(false);
  });

  it("pickFlyerStyleSet returns distinct catalog styles, deterministic per seed", () => {
    const seed = "11111111-2222-3333-4444-555555555555";
    const set = pickFlyerStyleSet(seed, 4);
    expect(set).toEqual(pickFlyerStyleSet(seed, 4));
    expect(set).toHaveLength(4);
    expect(new Set(set).size).toBe(4);
    for (const id of set) expect(isFlyerStyle(id)).toBe(true);

    const firsts = new Set<FlyerStyleId>();
    for (let i = 0; i < 40; i++) firsts.add(pickFlyerStyleSet(`seed-${i}-${i * 7}`, 4)[0]);
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("pickFlyerStyleSet never repeats a style, even when asked for more than exist", () => {
    const set = pickFlyerStyleSet("x", 99);
    expect(set).toHaveLength(FLYER_STYLE_CATALOG.length);
    expect(new Set(set).size).toBe(FLYER_STYLE_CATALOG.length);
  });

  it("resolveVariantStyles: reference wins, then a fixed preset, then a distinct set", () => {
    expect(
      resolveVariantStyles("s", { fixedStyle: "minimal", hasReference: true }),
    ).toEqual(Array(FLYER_VARIANT_COUNT).fill(undefined));
    expect(
      resolveVariantStyles("s", { fixedStyle: "minimal", hasReference: false }),
    ).toEqual(Array(FLYER_VARIANT_COUNT).fill("minimal"));
    const rotated = resolveVariantStyles("s", { hasReference: false });
    expect(rotated).toHaveLength(FLYER_VARIANT_COUNT);
    expect(new Set(rotated).size).toBe(FLYER_VARIANT_COUNT);
  });
});

describe("parseFlyerVariants", () => {
  const good = {
    headline: "Fast sites win",
    caption: "Speed sells.",
    scene: "A stopwatch on a desk",
  };

  it("keeps short mockup lines and drops overlong ones", () => {
    const [v] = parseFlyerVariants(
      { variants: [{ ...good, mockup: ["Impact Sign Co", "x".repeat(60), "555-0142"] }] },
      1,
    );
    expect(v.mockup).toEqual(["Impact Sign Co", "555-0142"]);
  });

  it("keeps complete variants, drops incomplete ones, and caps at count", () => {
    const out = parseFlyerVariants(
      {
        variants: [
          good,
          { headline: "No caption", scene: "x" },
          { ...good, headline: "Second" },
          { ...good, headline: "Third" },
        ],
      },
      2,
    );
    expect(out.map((v) => v.headline)).toEqual(["Fast sites win", "Second"]);
  });

  it("cleans em dashes, markdown, and hashtags on every variant", () => {
    const [v] = parseFlyerVariants(
      {
        variants: [
          { ...good, headline: "**Fast** sites \u2014 win", hashtags: ["webdesign", "#seo"] },
        ],
      },
      4,
    );
    expect(v.headline).not.toContain("\u2014");
    expect(v.headline).not.toContain("*");
    expect(v.hashtags).toEqual(["#webdesign", "#seo"]);
  });

  it("returns an empty list for a malformed payload (the caller retries)", () => {
    expect(parseFlyerVariants(null, 4)).toEqual([]);
    expect(parseFlyerVariants({ variants: "nope" }, 4)).toEqual([]);
    expect(parseFlyerVariants({}, 4)).toEqual([]);
  });

  describe("ad format", () => {
    const ad = {
      primary_text: "Slow sites \u2014 lost clients. Fix it this week.",
      headline: "**Free** speed audit",
      description: "Takes 2 minutes",
      cta_button: "Get quote",
    };
    const goodAd = { headline: "Fast sites win", scene: "A stopwatch", ad };

    it("mirrors primary text into the caption and cleans every ad field", () => {
      const [v] = parseFlyerVariants({ variants: [goodAd] }, 4, "ad");
      expect(v.ad).toEqual({
        primary_text: expect.not.stringContaining("\u2014"),
        headline: "Free speed audit",
        description: "Takes 2 minutes",
        cta_button: "Get quote",
      });
      expect(v.caption).toBe(v.ad?.primary_text);
      expect(v.hashtags).toEqual([]);
    });

    it("drops variants missing primary text or headline, and defaults an unknown button", () => {
      const out = parseFlyerVariants(
        {
          variants: [
            { ...goodAd, ad: { ...ad, primary_text: "" } },
            { ...goodAd, ad: { ...ad, headline: undefined } },
            { ...goodAd, ad: { ...ad, cta_button: "Click here!!" } },
          ],
        },
        4,
        "ad",
      );
      expect(out).toHaveLength(1);
      expect(out[0].ad?.cta_button).toBe("Learn more");
    });

    it("ignores ad fields on a post-format parse", () => {
      const [v] = parseFlyerVariants({ variants: [{ ...good, ad }] }, 4);
      expect(v.ad).toBeUndefined();
    });
  });

  it("keeps clean extras and drops empty, duplicate, or overlong ones", () => {
    const [v] = parseFlyerVariants(
      {
        variants: [
          {
            headline: "Tax season prep",
            caption: "Join us.",
            scene: "A laptop.",
            extras: [
              { slot: "date pills", text: "Nov 2 | 8 PM" },
              { slot: "date pills", text: "again" },
              { slot: "footer", text: "" },
              { slot: "tagline", text: "x".repeat(91) },
            ],
          },
        ],
      },
      4,
    );
    expect(v.extras).toEqual([{ slot: "date pills", text: "Nov 2 | 8 PM" }]);
  });
});

describe("flyerVariantsTool", () => {
  type Items = { properties: Record<string, unknown>; required: string[] };
  const items = (format?: "post" | "ad") =>
    (flyerVariantsTool(format).input_schema.properties as { variants: { items: Items } })
      .variants.items;

  it("asks for a caption and hashtags on a post", () => {
    expect(items().required).toContain("caption");
    expect(items().properties).toHaveProperty("hashtags");
    expect(items().properties).not.toHaveProperty("ad");
  });

  it("swaps caption and hashtags for the ad fields on an ad", () => {
    expect(items("ad").required).toEqual(["headline", "ad", "scene"]);
    expect(items("ad").properties).not.toHaveProperty("caption");
    expect(items("ad").properties).not.toHaveProperty("hashtags");
    expect(items("ad").properties).toHaveProperty("headline");
  });

  it("offers extras only when the look has text spots", () => {
    const withExtras = (flyerVariantsTool("post", true).input_schema.properties as { variants: { items: Items } })
      .variants.items;
    expect(items().properties).not.toHaveProperty("extras");
    expect(withExtras.properties).toHaveProperty("extras");
  });
});

describe("buildFlyerCopyMessages", () => {
  const base = {
    brandName: "Mogul",
    voiceBlock: "BRAND: Mogul\nVOICE: direct",
    topicTitle: "Why slow sites lose clients",
    aspect: "1:1" as const,
    variants: { count: 4 },
  };

  it("includes the topic, shape, and voice block", () => {
    const { system, user } = buildFlyerCopyMessages(base);
    expect(system).toContain("save_flyer_variants");
    expect(system).toContain("exactly 4 variants");
    expect(system).toContain("NEVER use em dashes");
    expect(user).toContain("FLYER TOPIC: Why slow sites lose clients");
    expect(user).toContain("Square post (1:1)");
    expect(user).toContain("VOICE: direct");
    expect(user).not.toContain("EXISTING EMAIL");
  });

  const competitorRef: CompetitorReference = {
    id: "c1",
    brand_id: "b1",
    name: "VistaPrint: Holiday Cards | 10 from $8.56",
    input_kind: "image",
    content: "Primary text: Turn big ideas into bold moments.\nHeadline: Holiday Cards | 10 from $8.56",
    image_url: "https://example.supabase.co/a.jpg",
    storage_path: "a.jpg",
    source_url: "https://www.facebook.com/ads/library/?id=1",
    competitor_profile: {
      summary: "Leads with a seasonal product and a low entry price.",
      hook_type: "product + price anchor",
      angle: "seasonal urgency",
      structure: ["product headline", "price anchor", "shop CTA"],
      cta_style: "short imperative",
      visual_notes: "Product photo fills the frame; headline in a heavy sans across the top.",
    },
    created_at: "2026-10-11T00:00:00Z",
  };

  it("adds the competitor strategy and layout idea, never its words or name", () => {
    const { user } = buildFlyerCopyMessages({ ...base, competitorRef });
    expect(user).toContain("COMPETITOR REFERENCE (strategy only, DO NOT COPY)");
    expect(user).toContain("Hook type: product + price anchor");
    expect(user).toContain("Layout idea: Product photo fills the frame");
    expect(user).toContain("inspiration, not a template");
    expect(user).not.toContain("Turn big ideas");
    expect(user).not.toContain("Holiday Cards");
    expect(user).not.toContain("$8.56");
  });

  it("adds no competitor lines without a reference or a distilled profile", () => {
    expect(buildFlyerCopyMessages(base).user).not.toContain("COMPETITOR REFERENCE");
    const { user } = buildFlyerCopyMessages({
      ...base,
      competitorRef: { ...competitorRef, competitor_profile: null },
    });
    expect(user).not.toContain("COMPETITOR REFERENCE");
    expect(user).not.toContain("inspiration, not a template");
  });

  it("writes ad rules instead of caption rules in ad format", () => {
    const post = buildFlyerCopyMessages(base).system;
    const ad = buildFlyerCopyMessages({ ...base, format: "ad" }).system;
    expect(post).toContain("- caption:");
    expect(ad).not.toContain("- caption:");
    expect(ad).toContain("ad.primary_text");
    expect(ad).toContain("ad.cta_button");
  });

  it("forbids invented prices, promises, and stats in both formats", () => {
    for (const format of ["post", "ad"] as const) {
      const { system } = buildFlyerCopyMessages({ ...base, format });
      expect(system).toContain("- facts:");
      expect(system).toContain("never invent one");
    }
  });

  it("fills extra spots with printed words only, skipping ones that need a missing fact", () => {
    const { user } = buildFlyerCopyMessages({
      ...base,
      textSlots: ["price callout with strikethrough original price"],
    });
    expect(user).toContain("an original price\nto strike through");
    expect(user).toContain("never a description of how they look");
  });

  it("distills the source email when emailCopy is provided", () => {
    const { user } = buildFlyerCopyMessages({
      ...base,
      emailCopy: {
        subject: "Stop losing leads",
        preheader: "p",
        headline: "Your site is a leaky bucket",
        body_sections: [{ body: "Every second of load time costs 7%." }],
        cta_text: "Get the audit",
      },
    });
    expect(user).toContain("EXISTING EMAIL");
    expect(user).toContain("Stop losing leads");
    expect(user).toContain("Your site is a leaky bucket");
    expect(user).toContain("Get the audit");
  });

  it("threads the user's creative brief into the prompt", () => {
    const { user } = buildFlyerCopyMessages({
      ...base,
      brief: "Announce our summer discount, urgent tone",
    });
    expect(user).toContain("CREATIVE BRIEF FROM THE USER");
    expect(user).toContain("summer discount");
  });

  it("tells the copy call the design direction so the scene fits it", () => {
    const { user } = buildFlyerCopyMessages({ ...base, style: "minimal" });
    expect(user).toContain("DESIGN DIRECTION");
    expect(user).toContain(FLYER_STYLE_DIRECTIONS.minimal);
    const { user: without } = buildFlyerCopyMessages(base);
    expect(without).not.toContain("DESIGN DIRECTION");
  });

  it("gives each variant its own direction when the styles differ", () => {
    const styles: FlyerStyleId[] = ["bold_type", "minimal", "collage", "elegant"];
    const { user } = buildFlyerCopyMessages({ ...base, variants: { count: 4, styles } });
    expect(user).toContain("DESIGN DIRECTION PER VARIANT");
    styles.forEach((id, i) => {
      expect(user).toContain(`Variant ${i + 1}: ${FLYER_STYLE_DIRECTIONS[id]}`);
    });
  });

  it("uses the single shared direction when every variant has the same style", () => {
    const { user } = buildFlyerCopyMessages({
      ...base,
      style: "minimal",
      variants: { count: 4, styles: Array(4).fill("minimal") },
    });
    expect(user).not.toContain("PER VARIANT");
    expect(user).toContain(FLYER_STYLE_DIRECTIONS.minimal);
  });

  it("lists the look's extra text spots, filled only from real facts", () => {
    const { user } = buildFlyerCopyMessages({ ...base, textSlots: ["date and time in two pills"] });
    expect(user).toContain("EXTRA TEXT SPOTS");
    expect(user).toContain("  - date and time in two pills");
    expect(user).toContain("Leave a spot out when the brief has nothing true");
    expect(buildFlyerCopyMessages(base).user).not.toContain("EXTRA TEXT SPOTS");
  });
});

describe("buildFlyerDesignPrompt", () => {
  const profile = {
    summary: "Punchy print-shop ads.",
    layout: "product centered on a flat field",
    text_placement: "headline top",
    text_amount: "minimal" as const,
    headline_treatment: "huge condensed sans",
    color_roles: { background: "dark" as const, accent_usage: "only on the button" },
    imagery: "studio product shot",
    cta_style: "pill" as const,
    logo_placement: "top-right" as const,
    mood: ["bold"],
  };
  const roles = { background: "#08080A", text: "#FAFAF8", accent: "#FFAE3C" };

  it("typesets the exact copy, follows the examples, and maps brand colors", () => {
    const prompt = buildFlyerDesignPrompt(copy, tokens, "4:5", { profile, exampleCount: 3, roles }, { logoCorner: "top-right" });
    expect(prompt).toContain('"Your website is losing you clients"');
    expect(prompt).toContain('"Book a call"');
    expect(prompt).toContain("Images 1 to 3 are the design examples to match.");
    expect(prompt).toContain("#08080A");
    expect(prompt).toContain("#FFAE3C as the one accent (only on the button)");
    expect(prompt).toContain("Keep the top-right corner completely empty");
    expect(prompt).toContain("no placeholder text anywhere");
    expect(prompt).toContain("Never copy their words, logos, brand names, products, or people");
  });

  it("prints sample text on a showcased item and keeps everything else blank", () => {
    const withMockup = { ...copy, mockup: ["Impact Sign Co", "555-0142"] };
    const prompt = buildFlyerDesignPrompt(withMockup, tokens, "1:1", { profile, exampleCount: 1, roles });
    expect(prompt).toContain('exactly this text printed on it and nothing else: "Impact Sign Co", "555-0142"');
    expect(prompt).toContain("Every other printed item, screen, sign, and package in the scene stays blank");
    expect(prompt).not.toContain("Printed items, screens, signs, and packaging in the scene stay blank");
  });

  it("designs from a preset direction when there are no examples", () => {
    const prompt = buildFlyerDesignPrompt(copy, tokens, "1:1", { profile: null, exampleCount: 0, roles, style: "bold_type" });
    expect(prompt).toContain(FLYER_STYLE_DIRECTIONS.bold_type);
    expect(prompt).toContain('"Your website is losing you clients"');
    expect(prompt).not.toContain("example");
  });

  it("drops the button when the look uses none, and names a previous misspelling", () => {
    const prompt = buildFlyerDesignPrompt(
      copy,
      tokens,
      "1:1",
      { profile: { ...profile, cta_style: "none" }, exampleCount: 1, roles },
      { misspelled: ["Your website is losing you clients"] },
    );
    expect(prompt).not.toContain('"Book a call"');
    expect(prompt).toContain("A previous attempt got this text wrong");
  });

  it("numbers the product first, then the examples", () => {
    const prompt = buildFlyerDesignPrompt(copy, tokens, "1:1", { profile, exampleCount: 2, roles }, { hasProduct: true });
    expect(prompt).toContain("Image 1 is the real product photo. Images 2 to 3 are the design examples to match.");
    expect(prompt).toContain("Show the product from Image 1 exactly as photographed");
  });

  it("gives each line of text its own type direction", () => {
    const prompt = buildFlyerDesignPrompt(copy, tokens, "1:1", { profile, exampleCount: 1, roles });
    expect(prompt).toContain('Headline: "Your website is losing you clients", huge condensed sans');
    expect(prompt).toContain('Call to action: "Book a call", styled as a pill.');
  });

  it("makes a client's flyer from their logo and colors, never the brand's", () => {
    const prompt = buildFlyerDesignPrompt(
      copy,
      tokens,
      "1:1",
      { profile, exampleCount: 1, roles },
      { logoCorner: "top-right", client: { name: "The Tax Moguls", hasLogo: true, hasColors: true } },
    );
    expect(prompt).toContain("for The Tax Moguls");
    expect(prompt).toContain("Image 1 is the design example to match. Image 2 shows The Tax Moguls' logo.");
    expect(prompt).toContain("Reproduce The Tax Moguls' logo from Image 2 exactly");
    expect(prompt).toContain("in the top-right corner");
    expect(prompt).toContain("use The Tax Moguls' colors");
    expect(prompt).not.toContain("brand logo is added there afterwards");
    expect(prompt).not.toContain(tokens.fonts.heading.split(",")[0].replace(/['"]/g, ""));
  });

  it("takes a client's colors from the logo when none were given", () => {
    const prompt = buildFlyerDesignPrompt(
      copy,
      tokens,
      "1:1",
      { profile, exampleCount: 1, roles },
      { client: { name: "Acme", hasLogo: true, hasColors: false } },
    );
    expect(prompt).toContain("take Acme's colors from their logo (Image 2)");
  });

  it("keeps option 1 close and riffs on the rest", () => {
    const close = buildFlyerDesignPrompt(copy, tokens, "1:1", { profile, exampleCount: 1, roles }, { riff: 0 });
    const riff = buildFlyerDesignPrompt(copy, tokens, "1:1", { profile, exampleCount: 1, roles }, { riff: 1 });
    const none = buildFlyerDesignPrompt(copy, tokens, "1:1", { profile, exampleCount: 1, roles });
    expect(close).toContain(DESIGN_RIFFS[0]);
    expect(riff).toContain(DESIGN_RIFFS[1]);
    for (const r of DESIGN_RIFFS) expect(none).not.toContain(r);
  });

  it("typesets extras under their own label and drops the examples' other text", () => {
    const prompt = buildFlyerDesignPrompt(
      { ...copy, extras: [{ slot: "date and time in two pills", text: "Nov 2 | 8 PM" }] },
      tokens,
      "1:1",
      { profile, exampleCount: 1, roles },
    );
    expect(prompt).toContain('Date and time in two pills: "Nov 2 | 8 PM".');
    expect(prompt).toContain("Any other text element the examples have");
  });
});

describe("buildPlaceImagePrompt", () => {
  it("edits the current design with the owner's placement note, keeping the text", () => {
    const prompt = buildPlaceImagePrompt("4:5", { note: "Put her on the right \u2014 holding the phone." });
    expect(prompt).toContain("Edit the first attached image, a finished portrait post (4:5) design.");
    expect(prompt).toContain("into this design: Put her on the right");
    expect(prompt).toContain("holding the phone. Keep that subject");
    expect(prompt).toContain("every word of text, spelled exactly as it is now");
    expect(prompt).not.toMatch(/[\u2013\u2014]/);
  });

  it("falls back to a sensible placement and names text a retry must restore", () => {
    const prompt = buildPlaceImagePrompt("1:1", { misspelled: ["Book a call"] });
    expect(prompt).toContain("place it where it suits the composition best");
    expect(prompt).toContain('A previous attempt changed this text: "Book a call"');
  });
});

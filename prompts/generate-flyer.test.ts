import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLYER_ASPECT,
  FLYER_ASPECTS,
  FLYER_STYLE_DIRECTIONS,
  FLYER_VARIANT_COUNT,
  buildFlyerCopyMessages,
  buildFlyerImagePrompt,
  isFlyerAspect,
  isFlyerStyle,
  parseFlyerVariants,
  pickFlyerStyleSet,
  resolveVariantStyles,
  type FlyerCopyOutput,
} from "./generate-flyer";
import { FLYER_STYLE_CATALOG } from "@/lib/design-styles";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { FlyerStyleId } from "@/lib/db/types";

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
  it("passes every text string verbatim and the brand palette", () => {
    const prompt = buildFlyerImagePrompt(copy, tokens, "4:5", false);
    expect(prompt).toContain('"Your website is losing you clients"');
    expect(prompt).toContain('"We fix that in 14 days"');
    expect(prompt).toContain('"Book a call"');
    expect(prompt).toContain("#111827");
    expect(prompt).toContain("#7C3AED");
    expect(prompt).toContain("Sora, sans-serif");
    expect(prompt).toContain("portrait post (4:5)");
    expect(prompt).toContain(copy.scene.replace(/\.$/, ""));
    expect(prompt).not.toContain("reference image");
  });

  it("omits subtext and cta clauses when absent", () => {
    const prompt = buildFlyerImagePrompt(
      { headline: "Hello", caption: "c", scene: "a plain desk" },
      tokens,
      "1:1",
      false,
    );
    expect(prompt).toContain('"Hello"');
    expect(prompt).not.toContain("supporting line \"");
    expect(prompt).not.toContain("call-to-action button or banner reading");
  });

  it("appends the style-transfer directive only when a reference is attached", () => {
    const withRef = buildFlyerImagePrompt(copy, tokens, "1:1", true);
    expect(withRef).toContain("reference image is attached");
    expect(withRef).toContain("keep the text content exactly as specified");
  });

  it("splices the design-direction preset when one is chosen", () => {
    const prompt = buildFlyerImagePrompt(copy, tokens, "1:1", false, "retro_print");
    expect(prompt).toContain(FLYER_STYLE_DIRECTIONS.retro_print);
  });

  it("drops the preset when a reference is attached (the reference IS the style)", () => {
    const prompt = buildFlyerImagePrompt(copy, tokens, "1:1", true, "retro_print");
    expect(prompt).not.toContain(FLYER_STYLE_DIRECTIONS.retro_print);
    expect(prompt).toContain("reference image is attached");
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
});

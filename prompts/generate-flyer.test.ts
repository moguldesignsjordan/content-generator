import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLYER_ASPECT,
  FLYER_ASPECTS,
  FLYER_STYLE_DIRECTIONS,
  buildFlyerCopyMessages,
  buildFlyerImagePrompt,
  isFlyerAspect,
  isFlyerStyle,
  pickVariedFlyerStyle,
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

  it("pickVariedFlyerStyle is deterministic per seed and stays in the catalog", () => {
    const seed = "11111111-2222-3333-4444-555555555555";
    expect(pickVariedFlyerStyle(seed)).toBe(pickVariedFlyerStyle(seed));
    const seen = new Set<FlyerStyleId>();
    for (let i = 0; i < 40; i++) {
      const style = pickVariedFlyerStyle(`seed-${i}-${i * 7}`);
      expect(isFlyerStyle(style)).toBe(true);
      seen.add(style);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("buildFlyerCopyMessages", () => {
  const base = {
    brandName: "Mogul",
    voiceBlock: "BRAND: Mogul\nVOICE: direct",
    topicTitle: "Why slow sites lose clients",
    aspect: "1:1" as const,
  };

  it("includes the topic, shape, and voice block", () => {
    const { system, user } = buildFlyerCopyMessages(base);
    expect(system).toContain("save_flyer_copy");
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
});

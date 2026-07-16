import { describe, expect, it } from "vitest";
import type { ContentImageStyle, VisualVibe } from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import {
  VISUAL_VIBE_IMAGE_STYLE,
  buildFinalImagePrompt,
  buildImagePromptMessages,
  resolveBrandPalette,
} from "./generate-image";

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
    const others: ContentImageStyle[] = [
      "illustration",
      "texture",
      "render3d",
      "collage",
      "lineart",
    ];
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

  it("never leaves the {SCENE} or {COLOR} placeholders unfilled", () => {
    const styles: ContentImageStyle[] = [
      "illustration",
      "photo",
      "texture",
      "render3d",
      "collage",
      "lineart",
    ];
    for (const style of styles) {
      for (const mode of ["accents", "none"] as const) {
        const prompt = buildFinalImagePrompt(style, "a desk", TOKENS, undefined, mode);
        expect(prompt).not.toContain("{SCENE}");
        expect(prompt).not.toContain("{COLOR}");
        expect(prompt).not.toContain("{PALETTE}");
      }
    }
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

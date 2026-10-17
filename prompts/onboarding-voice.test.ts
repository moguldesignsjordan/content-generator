import { describe, expect, it } from "vitest";
import type { OnboardingProposal } from "@/lib/db/types";
import { buildVoiceSampleMessages, cleanVoiceSamples } from "./onboarding-voice";

// Built at runtime so this file never contains the banned character itself.
const EM_DASH = String.fromCharCode(0x2014);

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + ".";

const sample = (over: Record<string, unknown> = {}) => ({
  name: "Friendly neighbor",
  voice: "Warm and plain.",
  tone: "Upbeat.",
  text: words(50),
  from_site: false,
  ...over,
});

describe("cleanVoiceSamples", () => {
  it("keeps three valid samples", () => {
    const out = cleanVoiceSamples(
      { samples: [sample(), sample(), sample(), sample()] },
      { max: 3, hasSiteLines: false },
    );
    expect(out).toHaveLength(3);
  });

  it("drops samples that are too short or missing a name", () => {
    const out = cleanVoiceSamples(
      { samples: [sample({ text: words(10) }), sample({ name: "" }), sample()] },
      { max: 3, hasSiteLines: false },
    );
    expect(out).toHaveLength(1);
  });

  it("cuts a long sample at a sentence end", () => {
    const long = `${words(60)} ${words(60)}`;
    const [out] = cleanVoiceSamples({ samples: [sample({ text: long })] }, { max: 3, hasSiteLines: false });
    expect(out.text.split(/\s+/).length).toBeLessThanOrEqual(90);
    expect(out.text.endsWith(".")).toBe(true);
  });

  it("strips em dashes", () => {
    const [out] = cleanVoiceSamples(
      { samples: [sample({ text: `${words(40)} Fast ${EM_DASH} and tidy.` })] },
      { max: 3, hasSiteLines: false },
    );
    expect(out.text).not.toContain(EM_DASH);
  });

  it("marks at most one sample as the site's, and none without site lines", () => {
    const input = { samples: [sample({ from_site: true }), sample({ from_site: true })] };
    expect(cleanVoiceSamples(input, { max: 3, hasSiteLines: true }).map((s) => s.from_site)).toEqual([
      true,
      false,
    ]);
    expect(cleanVoiceSamples(input, { max: 3, hasSiteLines: false }).some((s) => s.from_site)).toBe(false);
  });

  it("returns nothing for empty input", () => {
    expect(cleanVoiceSamples(undefined, { max: 3, hasSiteLines: false })).toEqual([]);
  });
});

describe("buildVoiceSampleMessages", () => {
  const base: OnboardingProposal = {
    name: "Acme Roofing",
    products: [{ slug: "roof-repair", name: "Roof repair" }],
    audience: {},
    differentiators: [],
    competitors: [],
    main_action: {},
    example_lines: [],
    guesses: [],
    sources: [],
  };

  it("writes about a real service and forbids invented facts", () => {
    const { user } = buildVoiceSampleMessages(base);
    expect(user).toContain('all about "Roof repair"');
    expect(user).toContain("No invented numbers");
  });

  it("asks for one site-like sample only when the site has lines", () => {
    expect(buildVoiceSampleMessages(base).user).toContain("All from_site false");
    const withLines = buildVoiceSampleMessages({ ...base, example_lines: ["We fix roofs."] }).user;
    expect(withLines).toContain("sound like their site");
    expect(withLines).toContain('"We fix roofs."');
  });
});

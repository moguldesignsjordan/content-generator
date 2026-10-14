import { describe, expect, it } from "vitest";
import { parseLookProfile } from "./extract-look";

const EM_DASH = String.fromCharCode(0x2014);
const valid = {
  summary: `Bold ${EM_DASH} punchy print ads`,
  layout: "product centered on a flat color field",
  text_placement: "headline top, left aligned",
  text_amount: "minimal",
  headline_treatment: "huge condensed uppercase sans",
  color_roles: { background: "vivid", accent_usage: "only on the button" },
  imagery: "studio product shot",
  cta_style: "pill",
  logo_placement: "top-right",
  mood: ["bold", "playful"],
};

describe("parseLookProfile", () => {
  it("accepts a valid profile and strips em dashes", () => {
    const p = parseLookProfile(valid)!;
    expect(p.summary).not.toContain(EM_DASH);
    expect(p.color_roles.background).toBe("vivid");
  });

  it("rejects out-of-range enums and missing fields", () => {
    expect(parseLookProfile({ ...valid, text_amount: "lots" })).toBeNull();
    expect(parseLookProfile({ ...valid, color_roles: { background: "plaid", accent_usage: "" } })).toBeNull();
    expect(parseLookProfile({ summary: "x" })).toBeNull();
  });
});

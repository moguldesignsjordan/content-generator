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
  subjects: "a bearded man, chest up",
  has_people: true,
};

describe("parseLookProfile", () => {
  it("accepts a valid profile and strips em dashes", () => {
    const p = parseLookProfile(valid)!;
    expect(p.summary).not.toContain(EM_DASH);
    expect(p.color_roles.background).toBe("vivid");
  });

  it("keeps what the examples show apart from the style", () => {
    const p = parseLookProfile(valid)!;
    expect(p.subjects).toBe("a bearded man, chest up");
    expect(p.has_people).toBe(true);
    const { has_people: _drop, ...noPeopleFlag } = valid;
    expect(parseLookProfile(noPeopleFlag)).toBeNull();
  });

  it("rejects out-of-range enums and missing fields", () => {
    expect(parseLookProfile({ ...valid, text_amount: "lots" })).toBeNull();
    expect(parseLookProfile({ ...valid, color_roles: { background: "plaid", accent_usage: "" } })).toBeNull();
    expect(parseLookProfile({ summary: "x" })).toBeNull();
  });

  it("keeps the extra text spots when present, and accepts a profile without them", () => {
    const p = parseLookProfile({ ...valid, text_slots: [`date pills ${EM_DASH} two`, " "] })!;
    expect(p.text_slots).toHaveLength(1);
    expect(p.text_slots![0]).toMatch(/^date pills/);
    expect(p.text_slots![0]).not.toContain(EM_DASH);
    expect(parseLookProfile(valid)!.text_slots).toBeUndefined();
  });

  it("trims long mood and text spot lists instead of rejecting the profile", () => {
    const p = parseLookProfile({ ...valid, mood: ["a", "b", "c", "d", "e", "f", "g"], text_slots: ["1", "2", "3", "4", "5"] })!;
    expect(p.mood).toHaveLength(6);
    expect(p.text_slots).toHaveLength(4);
  });
});

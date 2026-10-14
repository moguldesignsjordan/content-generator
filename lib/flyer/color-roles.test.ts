import { describe, expect, it } from "vitest";
import { mapBrandColors } from "./color-roles";
import { contrast } from "@/lib/color/contrast";

const mogul = {
  primary: "#FF3D8C",
  secondary: "#161618",
  accent: "#FFAE3C",
  background: "#FAFAF8",
  text: "#08080A",
};

describe("mapBrandColors", () => {
  it("puts the brand's darkest color behind a dark look, with a readable text color", () => {
    const roles = mapBrandColors(mogul, "dark");
    expect(roles.background).toBe("#08080A");
    expect(contrast(roles.text, roles.background)).toBeGreaterThanOrEqual(4.5);
    expect(roles.accent).toBe("#FFAE3C");
  });

  it("uses the light color for a light look and the boldest for a vivid one", () => {
    expect(mapBrandColors(mogul, "light").background).toBe("#FAFAF8");
    expect(mapBrandColors(mogul, "vivid").background).toBe("#FF3D8C");
  });

  it("never uses the background color as the accent, and keeps the accent visible", () => {
    const roles = mapBrandColors({ primary: "#FF3D8C", accent: "#FF3D8C", background: "#FFFFFF" }, "vivid");
    expect(roles.accent).not.toBe(roles.background);
    expect(contrast(roles.accent, roles.background)).toBeGreaterThanOrEqual(1.5);
  });

  it("falls back to a neutral when the brand has nothing dark enough", () => {
    expect(mapBrandColors({ primary: "#FFD6E8", background: "#FFFFFF" }, "dark").background).toBe("#111114");
  });

  it("keeps a saturated accent on a pale background, and ignores non-hex colors", () => {
    const roles = mapBrandColors({ primary: "rgb(1,2,3)", accent: "#FFAE3C" }, "light");
    expect(roles.background).toBe("#FAFAF7");
    expect(roles.accent).toBe("#FFAE3C");
  });
});

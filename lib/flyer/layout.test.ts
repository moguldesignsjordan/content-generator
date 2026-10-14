import { describe, expect, it } from "vitest";
import {
  FLYER_LAYOUTS,
  artHeightFraction,
  headlineSize,
  pickLayout,
  primaryFontFamily,
  quietZoneFor,
} from "./layout";

describe("pickLayout", () => {
  it("gives a flyer's four options four different layouts", () => {
    const four = [0, 1, 2, 3].map(pickLayout);
    expect(new Set(four).size).toBe(4);
    expect(pickLayout(4)).toBe(pickLayout(0));
  });
});

describe("quietZoneFor and artHeightFraction", () => {
  it("asks for a calm lower zone only where text covers the art", () => {
    expect(quietZoneFor("gradient")).toBe("bottom");
    expect(quietZoneFor("card")).toBe("bottom");
    expect(quietZoneFor("band_bottom")).toBe("none");
    expect(quietZoneFor("band_top")).toBe("none");
  });

  it("gives band layouts a partial art region and overlays the full frame", () => {
    for (const layout of FLYER_LAYOUTS) {
      const f = artHeightFraction(layout);
      expect(f).toBeGreaterThan(0.5);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(artHeightFraction("gradient")).toBe(1);
  });

  it("gives a square canvas's band more room", () => {
    expect(artHeightFraction("band_top", 1080, 1080)).toBeLessThan(
      artHeightFraction("band_top", 1080, 1350),
    );
  });
});

describe("headlineSize", () => {
  it("runs short headlines bigger than long ones", () => {
    expect(headlineSize("Book now", 1080)).toBeGreaterThan(
      headlineSize("Your website is losing you clients every single week", 1080),
    );
  });

  it("scales with canvas width", () => {
    expect(headlineSize("Book now", 540)).toBe(Math.round(headlineSize("Book now", 1080) / 2));
  });
});

describe("primaryFontFamily", () => {
  it("takes the first real family from a CSS stack", () => {
    expect(primaryFontFamily("'Sora', sans-serif")).toBe("Sora");
    expect(primaryFontFamily('"Playfair Display", Georgia, serif')).toBe("Playfair Display");
  });

  it("returns null for generic-only or empty stacks", () => {
    expect(primaryFontFamily("system-ui, -apple-system, sans-serif")).toBeNull();
    expect(primaryFontFamily(undefined)).toBeNull();
    expect(primaryFontFamily("var(--font-hanken), sans-serif")).toBeNull();
  });
});

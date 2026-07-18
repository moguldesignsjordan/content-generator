import { describe, expect, it } from "vitest";
import type { EmailStyleId, VisualVibe } from "@/lib/db/types";
import {
  EMAIL_STYLES,
  EMAIL_STYLE_IDS,
  VISUAL_VIBE_STYLES,
  pickEmailStyle,
  pickRotation,
} from "./email-styles";
import { EMAIL_DESIGN_CATALOG } from "@/lib/design-styles";

describe("EMAIL_STYLES", () => {
  it("has a directive for every id in EMAIL_STYLE_IDS, and vice versa", () => {
    for (const id of EMAIL_STYLE_IDS) {
      expect(EMAIL_STYLES[id]).toBeDefined();
      expect(EMAIL_STYLES[id].id).toBe(id);
      expect(EMAIL_STYLES[id].lines.length).toBeGreaterThan(0);
    }
    expect(Object.keys(EMAIL_STYLES).length).toBe(EMAIL_STYLE_IDS.length);
  });

  it("has at least the 8 curated professional directions", () => {
    expect(EMAIL_STYLE_IDS.length).toBeGreaterThanOrEqual(8);
  });

  it("stays in sync with the client-safe picker catalog (lib/design-styles.ts)", () => {
    expect(EMAIL_DESIGN_CATALOG.map((s) => s.id).sort()).toEqual(
      [...EMAIL_STYLE_IDS].sort(),
    );
    for (const entry of EMAIL_DESIGN_CATALOG) {
      expect(entry.label).toBe(EMAIL_STYLES[entry.id].label);
      expect(entry.description).toBeTruthy();
    }
  });
});

describe("pickEmailStyle", () => {
  it("never repeats any of the last 3 used styles", () => {
    // Run many times since the non-seeded path is random; every result must
    // avoid the excluded window regardless of the random draw.
    const recent: EmailStyleId[] = ["soft_card", "editorial_serif", "bold_accent_band"];
    for (let i = 0; i < 200; i++) {
      const picked = pickEmailStyle({ recent });
      expect(recent).not.toContain(picked);
    }
  });

  it("can still pick when the recent window is empty", () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickEmailStyle({});
      expect(EMAIL_STYLE_IDS).toContain(picked);
    }
  });

  it("assigns distinct styles by index across one full series (seedIndex)", () => {
    const picks = EMAIL_STYLE_IDS.map((_, i) => pickEmailStyle({ seedIndex: i }));
    expect(new Set(picks).size).toBe(EMAIL_STYLE_IDS.length);
  });

  it("never repeats consecutively across seedIndex boundaries", () => {
    for (let i = 0; i < 20; i++) {
      const a = pickEmailStyle({ seedIndex: i });
      const b = pickEmailStyle({ seedIndex: i + 1 });
      expect(a).not.toBe(b);
    }
  });

  it("seedIndex selection is deterministic", () => {
    expect(pickEmailStyle({ seedIndex: 3 })).toBe(pickEmailStyle({ seedIndex: 3 }));
    expect(pickEmailStyle({ seedIndex: 11 })).toBe(
      pickEmailStyle({ seedIndex: 11 - EMAIL_STYLE_IDS.length }),
    );
  });

  it("narrows to the vibe's curated subset when a vibe is given", () => {
    const vibes: VisualVibe[] = ["punchy", "sleek", "playful", "premium"];
    for (const vibe of vibes) {
      for (let i = 0; i < 50; i++) {
        expect(VISUAL_VIBE_STYLES[vibe]).toContain(pickEmailStyle({ vibe }));
      }
    }
  });

  it("never repeats any of the last 3 used styles even within a vibe subset", () => {
    const recent: EmailStyleId[] = ["bold_accent_band", "pill_modern"];
    for (let i = 0; i < 100; i++) {
      const picked = pickEmailStyle({ vibe: "punchy", recent });
      expect(picked).toBe("warm_gradient_top");
    }
  });
});

describe("pickRotation", () => {
  it("throws on an empty id list", () => {
    expect(() => pickRotation([], {})).toThrow();
  });

  it("returns the only id when given a single-element list", () => {
    expect(pickRotation(["only"], {})).toBe("only");
  });

  it("wraps seedIndex modulo the id list length", () => {
    const ids = ["a", "b", "c"];
    expect(pickRotation(ids, { seedIndex: 3 })).toBe("a");
    expect(pickRotation(ids, { seedIndex: 4 })).toBe("b");
  });

  it("falls back gracefully when avoidLastK would exclude everything", () => {
    const ids = ["a", "b"];
    for (let i = 0; i < 50; i++) {
      const picked = pickRotation(ids, { recent: ["a", "b"], avoidLastK: 2 });
      expect(ids).toContain(picked);
    }
  });
});

import { describe, expect, it } from "vitest";
import { cleanExamples, cleanLookName } from "./looks";

const host = "stujpgjxhyivsqvnhdfs.supabase.co";
const ok = `https://${host}/storage/v1/object/public/content-images/a.jpg`;

describe("cleanExamples", () => {
  it("keeps only https images hosted on our own storage", () => {
    const out = cleanExamples(
      [
        { url: ok, source: "upload" },
        { url: "https://evil.example/x.jpg", source: "url" },
        { url: `http://${host}/storage/x.jpg`, source: "url" },
        { url: "not a url" },
      ],
      host,
    );
    expect(out).toEqual([{ url: ok, source: "upload" }]);
  });

  it("dedupes, caps at 6, keeps ref ids, and defaults an unknown source", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ url: `${ok}?v=${i}`, source: "weird", ref_id: `r${i}` }));
    const out = cleanExamples([...many, many[0]], host)!;
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ url: `${ok}?v=0`, source: "upload", ref_id: "r0" });
  });

  it("returns null when nothing valid is left or storage isn't configured", () => {
    expect(cleanExamples([{ url: "https://evil.example/x.jpg" }], host)).toBeNull();
    expect(cleanExamples([{ url: ok }], null)).toBeNull();
  });
});

describe("cleanLookName", () => {
  it("trims, caps at 60, and refuses blanks", () => {
    expect(cleanLookName("  Bold print promo ")).toBe("Bold print promo");
    expect(cleanLookName("x".repeat(80))).toHaveLength(60);
    expect(cleanLookName("   ")).toBeNull();
    expect(cleanLookName(42)).toBeNull();
  });
});

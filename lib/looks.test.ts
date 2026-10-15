import { describe, expect, it } from "vitest";
import { cleanClientBrand, cleanExamples, cleanLookName, cleanReferenceUrls } from "./looks";

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

describe("cleanReferenceUrls and cleanClientBrand", () => {
  const own = (u: string) => u.startsWith("https://own.example/");

  it("keeps only allowed, deduped reference URLs, at most 3", () => {
    const urls = ["https://own.example/1", "https://own.example/1", "https://evil.example/2", "https://own.example/3", "https://own.example/4", "https://own.example/5"];
    expect(cleanReferenceUrls(urls, own)).toEqual(["https://own.example/1", "https://own.example/3", "https://own.example/4"]);
    expect(cleanReferenceUrls("nope", own)).toEqual([]);
  });

  it("drops a logo outside the allowed host but keeps the brand", () => {
    expect(cleanClientBrand({ name: "Acme", colors: ["#112233", "red"], logo_url: "https://evil.example/l.png" }, own)).toEqual({
      name: "Acme",
      colors: ["#112233"],
    });
    expect(cleanClientBrand({ colors: ["#112233"] }, own)).toBeNull();
  });
});

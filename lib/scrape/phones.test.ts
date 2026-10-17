import { describe, expect, it } from "vitest";
import { formatPhone, phoneCandidates, pickPhone } from "./phones";

describe("phoneCandidates", () => {
  it("puts tel: links first and formats US numbers", () => {
    expect(
      phoneCandidates(["tel:+1-214-555-0101"], "Or call our office at 972.555.0199 today."),
    ).toEqual(["(214) 555-0101", "(972) 555-0199"]);
  });

  it("dedupes the same number seen as a link and in the text", () => {
    expect(phoneCandidates(["tel:2145550101"], "Call (214) 555-0101")).toEqual(["(214) 555-0101"]);
  });

  it("ignores digit runs without phone separators", () => {
    expect(phoneCandidates([], "Order #2145550101 shipped. SKU 1234567890.")).toEqual([]);
  });

  it("keeps a non-US tel: link as written", () => {
    expect(phoneCandidates(["tel:+44%2020%207946%200958"], "")).toEqual(["+44 20 7946 0958"]);
  });

  it("caps the list at three", () => {
    const text = "202-555-0101 303-555-0102 404-555-0103 505-555-0104";
    expect(phoneCandidates([], text)).toHaveLength(3);
  });
});

describe("pickPhone", () => {
  const candidates = ["(214) 555-0101"];

  it("accepts a candidate in any formatting, returned in its display form", () => {
    expect(pickPhone("+1 214.555.0101", candidates)).toBe("(214) 555-0101");
  });

  it("drops a number the site never showed", () => {
    expect(pickPhone("(214) 555-9999", candidates)).toBeUndefined();
    expect(pickPhone(undefined, candidates)).toBeUndefined();
  });
});

describe("formatPhone", () => {
  it("formats ten and eleven digit US numbers", () => {
    expect(formatPhone("12145550101")).toBe("(214) 555-0101");
    expect(formatPhone("214-555-0101")).toBe("(214) 555-0101");
  });
});

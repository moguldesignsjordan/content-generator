import { describe, expect, it } from "vitest";
import { bucketUsage, humanizeReason } from "./usage-labels";

describe("bucketUsage", () => {
  it("groups known sources into their human category", () => {
    const result = bucketUsage([
      { source: "email-copy", count: 3, estimatedUsd: 0.3 },
      { source: "email-copy-retry", count: 1, estimatedUsd: 0.1 },
      { source: "email-qa", count: 3, estimatedUsd: 0.03 },
    ]);
    expect(result).toEqual([{ label: "Email generation", count: 7, estimatedUsd: 0.43 }]);
  });

  it("sorts buckets by spend descending", () => {
    const result = bucketUsage([
      { source: "redesign", count: 1, estimatedUsd: 0.05 },
      { source: "email-copy", count: 1, estimatedUsd: 0.5 },
    ]);
    expect(result.map((b) => b.label)).toEqual(["Email generation", "Redesign"]);
  });

  it("title-cases an unmapped source instead of showing a raw slug", () => {
    const result = bucketUsage([{ source: "some-new-thing", count: 1, estimatedUsd: 0.01 }]);
    expect(result[0].label).toBe("Some New Thing");
  });

  it("caps to maxRows and folds the remainder into Other", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      source: `thing-${i}`,
      count: 1,
      estimatedUsd: 0.1 * (8 - i), // descending so order is deterministic
    }));
    const result = bucketUsage(rows, 4);
    expect(result).toHaveLength(4);
    expect(result[3].label).toBe("Other");
    // thing-0..thing-2 are top 3 (kept), thing-3..thing-7 (5 rows) fold into Other.
    expect(result[3].count).toBe(5);
    expect(result[3].estimatedUsd).toBeCloseTo(0.5 + 0.4 + 0.3 + 0.2 + 0.1, 5);
  });

  it("returns [] for no usage", () => {
    expect(bucketUsage([])).toEqual([]);
  });
});

describe("humanizeReason", () => {
  it("maps known reasons to friendly labels", () => {
    expect(humanizeReason("pack_purchase")).toBe("Credit pack purchase");
    expect(humanizeReason("allowance_paid")).toBe("Pro monthly allowance");
  });

  it("falls back to the raw value for an unknown reason", () => {
    expect(humanizeReason("some_future_reason")).toBe("some_future_reason");
  });
});

import { describe, expect, it } from "vitest";
import { userAskedForResearch } from "./research-consent";

describe("userAskedForResearch", () => {
  it("accepts the yes chip and typed requests", () => {
    expect(userAskedForResearch(["Fall sale", "Yes, research it"])).toBe(true);
    expect(userAskedForResearch(["please do the research first"])).toBe(true);
  });

  it("is false when research never came up, even after a bare yes", () => {
    expect(userAskedForResearch(["Fall sale", "yes", "go"])).toBe(false);
  });

  it("respects a no", () => {
    expect(userAskedForResearch(["No, just plan it without research"])).toBe(false);
    expect(userAskedForResearch(["skip the research"])).toBe(false);
    expect(userAskedForResearch(["don't research anything"])).toBe(false);
  });

  it("goes by the latest message that mentions research", () => {
    expect(userAskedForResearch(["research it", "actually no research"])).toBe(false);
    expect(userAskedForResearch(["no research", "ok fine, research it"])).toBe(true);
  });
});

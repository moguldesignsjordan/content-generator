import { describe, expect, it } from "vitest";
import { buildChosenAngleBlock } from "./angle";
import { buildPerformanceBlock } from "./pick-angle";
import type { TopPerformingEmail } from "@/lib/db/types";

const angle = {
  hook: "Your designer isn't slow, your brief is vague.",
  reader_belief: "Design takes forever because designers are precious.",
  why_it_works: "Names the reader's private frustration and reframes the blame.",
  cta_rationale: "The brief template is the immediate fix for the problem named.",
};

describe("buildChosenAngleBlock", () => {
  it("is empty when no angle was chosen, so generation is unchanged", () => {
    expect(buildChosenAngleBlock(null)).toBe("");
    expect(buildChosenAngleBlock(undefined)).toBe("");
  });

  it("states the angle as a decision, not a suggestion", () => {
    const block = buildChosenAngleBlock(angle);
    expect(block).toContain("already decided");
    expect(block).toContain("do not pick a");
    expect(block).toContain(angle.hook);
    expect(block).toContain(angle.reader_belief);
    expect(block).toContain(angle.cta_rationale);
  });

  it("holds every section to the angle", () => {
    expect(buildChosenAngleBlock(angle)).toContain(
      "If a paragraph would fit equally",
    );
  });
});

describe("buildPerformanceBlock", () => {
  const top: TopPerformingEmail[] = [
    { subject: "The brief that saved us a week", opening: "Most\nrevisions", open_rate: 48.2, click_rate: 9.55 },
  ];

  it("is empty with no send history, so new brands are unaffected", () => {
    expect(buildPerformanceBlock([])).toBe("");
    expect(buildPerformanceBlock(undefined)).toBe("");
  });

  it("shows the numbers and flattens the opening onto one line", () => {
    const block = buildPerformanceBlock(top);
    expect(block).toContain("The brief that saved us a week");
    expect(block).toContain("Opened 48.2%, clicked 9.6%");
    expect(block).toContain("Most revisions");
  });

  it("frames past winners as evidence, never as copy to reuse", () => {
    expect(buildPerformanceBlock(top)).toContain("never reuse the wording");
  });
});

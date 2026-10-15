import { describe, expect, it } from "vitest";
import type { FactoryKind } from "@/lib/db/types";
import {
  composeIntakeMessage,
  nextIntakeStep,
  type CreateKind,
  type IntakeStep,
} from "./create-intake";

describe("composeIntakeMessage", () => {
  it("states the kind, purpose, and photo instructions", () => {
    const msg = composeIntakeMessage({
      kind: "flyer",
      purpose: "  Our $49 care plan, starts Nov 1 ",
      photoCount: 2,
      photoNote: "Feature the product",
    });
    expect(msg).toBe(
      [
        "I want to create: a flyer design.",
        "What it's for: Our $49 care plan, starts Nov 1",
        "Photos: 2 attached. What to do with them: Feature the product.",
      ].join("\n"),
    );
  });

  it("says when there are no photos and leaves an unanswered note to the agent", () => {
    expect(composeIntakeMessage({ kind: "email", purpose: "x", photoCount: 0 })).toContain(
      "Photos: none.",
    );
    expect(composeIntakeMessage({ kind: "blog", purpose: "x", photoCount: 1 })).toContain(
      "What to do with them: your call.",
    );
  });

  it("lists campaign settings in a fixed order and the research answer", () => {
    const msg = composeIntakeMessage({
      kind: "campaign",
      purpose: "Fall sale",
      photoCount: 0,
      lookPicked: true,
      campaign: { kinds: ["email", "social"], size: 12, days: 14, research: false },
    });
    expect(msg).toContain("Look: they picked a look to follow in the app.");
    expect(msg).toContain("Campaign includes: social posts, emails. 12 pieces over 2 weeks.");
    expect(msg).toContain("Research first: no.");
  });

  it("ignores campaign settings on a single piece", () => {
    const msg = composeIntakeMessage({
      kind: "email",
      purpose: "x",
      photoCount: 0,
      campaign: { kinds: ["email"], size: 6, days: 30, research: true },
    });
    expect(msg).not.toContain("Campaign includes");
  });
});

describe("nextIntakeStep", () => {
  const walk = (kind: CreateKind, photoCount: number, campaignKinds: FactoryKind[] = []) => {
    const steps: IntakeStep[] = ["purpose"];
    let next = nextIntakeStep("purpose", { kind, photoCount, campaignKinds });
    while (next) {
      steps.push(next);
      next = nextIntakeStep(next, { kind, photoCount, campaignKinds });
    }
    return steps;
  };

  it("asks about photos, then hands an email or blog to the agent", () => {
    expect(walk("email", 0)).toEqual(["purpose", "photos"]);
    expect(walk("blog", 2)).toEqual(["purpose", "photos", "photoNote"]);
  });

  it("adds the look step for a flyer", () => {
    expect(walk("flyer", 1)).toEqual(["purpose", "photos", "photoNote", "look"]);
  });

  it("always asks about research last for a campaign, with a look only for social or ads", () => {
    expect(walk("campaign", 0, ["email", "blog"])).toEqual([
      "purpose",
      "photos",
      "campaignKinds",
      "campaignSize",
      "campaignDays",
      "research",
    ]);
    expect(walk("campaign", 0, ["ad"])).toContain("look");
  });
});

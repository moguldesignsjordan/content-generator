import { describe, expect, it } from "vitest";
import { buildFlyerBriefText, buildPieceBrief, buildResearchNotes } from "./brief";
import type { FactoryPlanItem } from "@/lib/db/types";

const base: FactoryPlanItem = {
  id: "r1",
  kind: "email",
  format: "email_promotional",
  title: "Care plan launch",
  hook: "Your site broke at 2am. Nobody noticed.",
  core_idea: "Monitoring catches problems before customers do",
  key_message: "Book the care plan",
  preview: "Nobody noticed for 6 hours",
  date: "2026-11-02",
  needs_detail: true,
  detail_prompt: "How fast do you respond?",
};

describe("buildPieceBrief", () => {
  it("carries the row's own hook and idea, the subject, and an image for emails", () => {
    const brief = buildPieceBrief(base, { sentence: "Care plan, $49/mo" });
    expect(brief.hook).toBe(base.hook);
    expect(brief.angle).toContain(base.core_idea);
    expect(brief.angle).toContain("Promotion");
    expect(brief.subject_line).toBe(base.preview);
    expect(brief.include_image).toBe(true);
    expect(brief.goal).toBe("Care plan, $49/mo");
  });

  it("uses the owner's real detail as proof and never invents one", () => {
    expect(buildPieceBrief(base, { sentence: "x" }).proof).toBeUndefined();
    expect(
      buildPieceBrief({ ...base, detail: "Under 1 hour, 24/7" }, { sentence: "x" }).proof,
    ).toBe("Under 1 hour, 24/7");
  });

  it("gives blogs no subject line or forced image", () => {
    const brief = buildPieceBrief({ ...base, kind: "blog", format: "blog_how_to" }, { sentence: "x" });
    expect(brief.subject_line).toBeUndefined();
    expect(brief.include_image).toBeUndefined();
  });
});

describe("buildFlyerBriefText", () => {
  it("lists the hook, idea, picture, and real detail for the flyer writer", () => {
    const text = buildFlyerBriefText(
      { ...base, kind: "social", format: "proof", visual: "Laptop on a desk", detail: "Saved 3 launches" },
      "Care plan",
    );
    expect(text).toContain("Hook (open with this idea): Your site broke at 2am");
    expect(text).toContain("Picture: Laptop on a desk");
    expect(text).toContain("Real detail to use (true, from the owner): Saved 3 launches");
    expect(text).toContain("Format: Proof.");
  });
});

describe("research notes and the angle lock", () => {
  const research = {
    summary: "",
    trends: [
      { point: "Short before/after posts are winning", sources: ["https://a.example"] },
      { point: "Price-first ads outperform", sources: ["https://b.example"] },
      { point: "Third trend", sources: ["https://c.example"] },
    ],
    competitor_patterns: [],
    hook_patterns: [],
    brand_facts: [{ point: "Plans start at $49 a month", sources: [] }],
    sources: [],
  };

  it("locks the angle and carries real facts plus the inspiring trend", () => {
    const brief = buildPieceBrief({ ...base, inspired_by: "https://b.example" }, {
      sentence: "x",
      research,
    });
    expect(brief.angle_locked).toBe(true);
    expect(brief.research_notes).toContain("Plans start at $49 a month");
    expect(brief.research_notes).toContain("Price-first ads outperform");
    expect(brief.research_notes).not.toContain("Short before/after");
  });

  it("falls back to the top two trends when nothing specific inspired the piece", () => {
    const notes = buildResearchNotes(research, {});
    expect(notes).toContain("Short before/after posts are winning");
    expect(notes).toContain("Price-first ads outperform");
    expect(notes).not.toContain("Third trend");
  });

  it("is empty without research, and the brief has no notes field then", () => {
    expect(buildResearchNotes(undefined, {})).toBe("");
    expect(buildPieceBrief(base, { sentence: "x" }).research_notes).toBeUndefined();
  });

  it("puts the facts into a flyer's brief too", () => {
    expect(buildFlyerBriefText({ ...base, kind: "social", format: "proof" }, "x", research)).toContain(
      "Plans start at $49 a month",
    );
  });
});

describe("the plan's picture idea", () => {
  it("becomes the hero's subject for emails and blogs", () => {
    expect(buildPieceBrief({ ...base, visual: "A dashboard on a phone at 2am" }, { sentence: "x" }).image_subject).toBe(
      "A dashboard on a phone at 2am",
    );
    expect(buildPieceBrief(base, { sentence: "x" }).image_subject).toBeUndefined();
  });
});

describe("one product per piece", () => {
  const product = { name: "Door hangers", description: "Die-cut, full color", price_point: "$45" };

  it("leads the flyer brief with its product and keeps the campaign as background", () => {
    const text = buildFlyerBriefText({ ...base, kind: "social", product: "Door hangers" }, "Our print lineup", undefined, product);
    const lines = text.split("\n");
    expect(lines[0]).toBe(
      "Product (this piece is only about this one; the others get their own pieces): Door hangers. About it: Die-cut, full color. Price: $45",
    );
    expect(lines[1]).toBe("Campaign (background only): Our print lineup");
  });

  it("keeps an email or blog on its product", () => {
    const brief = buildPieceBrief(base, { sentence: "Our print lineup" }, { name: "Door hangers" });
    expect(brief.goal).toBe(
      "Product (this piece is only about this one; the others get their own pieces): Door hangers. Campaign background: Our print lineup",
    );
    expect(brief.constraints).toBe("Only about Door hangers. Never show or mention the campaign's other products.");
  });

  it("is unchanged without a product", () => {
    expect(buildFlyerBriefText(base, "Care plan").split("\n")[0]).toBe("Campaign: Care plan");
    expect(buildPieceBrief(base, { sentence: "Care plan" }).constraints).toBeUndefined();
  });
});

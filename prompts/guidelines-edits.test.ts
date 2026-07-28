import { describe, expect, it } from "vitest";
import type { DraftEdit } from "@/lib/db/types";
import { buildEditHistoryBlock } from "./guidelines";

function edit(overrides: Partial<DraftEdit> = {}): DraftEdit {
  return {
    kind: "inline",
    region: "body",
    before_text: "We are absolutely thrilled to announce our brand new offering!",
    after_text: "New this week: brand audits.",
    instruction: null,
    created_at: "2026-07-20T00:00:00Z",
    ...overrides,
  };
}

describe("buildEditHistoryBlock", () => {
  it("is empty with no history, so a new account's synthesis is unchanged", () => {
    expect(buildEditHistoryBlock([], [])).toBe("");
    expect(buildEditHistoryBlock(undefined, undefined)).toBe("");
  });

  it("shows both sides of an inline edit, since the diff is the signal", () => {
    const block = buildEditHistoryBlock([edit()], []);
    expect(block).toContain('was: "We are absolutely thrilled');
    expect(block).toContain('became: "New this week: brand audits."');
  });

  it("skips inline edits missing either side", () => {
    const block = buildEditHistoryBlock([edit({ after_text: null })], []);
    expect(block).toBe("");
  });

  it("passes style instructions and rejection reasons through as written", () => {
    const block = buildEditHistoryBlock(
      [edit({ kind: "style", instruction: "the button is too small", before_text: null, after_text: null })],
      ["too corporate"],
    );
    expect(block).toContain("the button is too small");
    expect(block).toContain("too corporate");
  });

  it("collapses whitespace and caps runaway text", () => {
    const long = "x".repeat(400);
    const block = buildEditHistoryBlock(
      [edit({ before_text: "a\n\n  b", after_text: long })],
      [],
    );
    expect(block).toContain('was: "a b"');
    expect(block).not.toContain("x".repeat(300));
  });
});

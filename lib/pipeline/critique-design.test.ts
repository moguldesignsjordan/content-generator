import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@/lib/clients/anthropic", () => ({
  HARD_MODEL: "claude-opus-5",
  cacheableSystem: (s: string) => s,
  getAnthropic: () => ({ messages: { create: createMock } }),
  logUsage: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { critiqueDesign } from "./critique-design";

// A minimally valid document: validateModelEmailHtml requires a complete
// html/body pair and at least 500 characters.
const PAD = "<p>filler paragraph for length</p>".repeat(20);
const HTML = `<html><body><a href="#" style="padding:4px">Go</a>${PAD}</body></html>`;

function critiqueResponse(input: Record<string, unknown>) {
  return {
    id: "msg_1",
    content: [{ type: "tool_use", name: "critique_design", input }],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

const base = {
  html: HTML,
  designBrief: "600px card, one CTA.",
  designSource: "model" as const,
  brandId: "b1",
};

describe("critiqueDesign", () => {
  beforeEach(() => createMock.mockReset());

  it("never spends a call on the code template, which is already known good", async () => {
    const result = await critiqueDesign({ ...base, designSource: "template" });
    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("applies an edit and reports what it fixed", async () => {
    createMock.mockResolvedValueOnce(
      critiqueResponse({
        verdict: "CTA is too small to notice.",
        edits: [
          { problem: "CTA has no padding", find: 'style="padding:4px"', replace: 'style="padding:16px 28px"' },
        ],
      }),
    );
    const result = await critiqueDesign(base);
    expect(result?.html).toContain("padding:16px 28px");
    expect(result?.applied).toEqual(["CTA has no padding"]);
  });

  it("treats a clean verdict as a real result, not a failure", async () => {
    createMock.mockResolvedValueOnce(
      critiqueResponse({ verdict: "Reads well.", edits: [] }),
    );
    const result = await critiqueDesign(base);
    expect(result?.applied).toEqual([]);
    expect(result?.verdict).toBe("Reads well.");
    expect(result?.html).toBe(HTML);
  });

  it("skips an edit whose find text doesn't match, keeping the others", async () => {
    createMock.mockResolvedValueOnce(
      critiqueResponse({
        verdict: "Two problems.",
        edits: [
          { problem: "not in the document", find: "<div class=nope>", replace: "<div>" },
          { problem: "CTA has no padding", find: 'style="padding:4px"', replace: 'style="padding:16px"' },
        ],
      }),
    );
    const result = await critiqueDesign(base);
    expect(result?.applied).toEqual(["CTA has no padding"]);
    expect(result?.html).toContain("padding:16px");
  });

  it("keeps the original when every edit fails to match", async () => {
    createMock.mockResolvedValueOnce(
      critiqueResponse({
        verdict: "Hmm.",
        edits: [{ problem: "phantom", find: "<nope>", replace: "<div>" }],
      }),
    );
    const result = await critiqueDesign(base);
    expect(result?.html).toBe(HTML);
    expect(result?.applied).toEqual([]);
  });

  it("discards a patch that breaks the document", async () => {
    // Removing </body></html> must not be allowed to ship.
    createMock.mockResolvedValueOnce(
      critiqueResponse({
        verdict: "Restructuring.",
        edits: [{ problem: "tightening", find: "</body></html>", replace: "" }],
      }),
    );
    const result = await critiqueDesign(base);
    expect(result?.html).toBe(HTML);
    expect(result?.applied).toEqual([]);
  });

  it("returns null when the model errors, so the draft is unaffected", async () => {
    createMock.mockRejectedValueOnce(new Error("boom"));
    expect(await critiqueDesign(base)).toBeNull();
  });
});

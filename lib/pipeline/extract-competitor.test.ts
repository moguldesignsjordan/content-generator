import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@/lib/clients/anthropic", () => ({
  DRAFT_MODEL: "claude-sonnet-4-6",
  getAnthropic: () => ({ messages: { create: createMock } }),
  logUsage: vi.fn(),
}));

import { extractCompetitorProfile } from "./extract-competitor";

function toolUseResponse(input: Record<string, unknown>) {
  return {
    content: [{ type: "tool_use", name: "save_competitor_profile", input }],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

const VALID_PROFILE = {
  summary: "Leads with a bold before/after claim, then stacks proof.",
  hook_type: "bold claim",
  angle: "problem/solution",
  structure: ["headline claim", "three proof points", "urgent CTA"],
  cta_style: "direct and urgent",
};

describe("extractCompetitorProfile", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns null when neither content nor imageUrl is given", async () => {
    const result = await extractCompetitorProfile({});
    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns the parsed profile for pasted text", async () => {
    createMock.mockResolvedValueOnce(toolUseResponse(VALID_PROFILE));
    const result = await extractCompetitorProfile({ content: "Buy now, 50% off!" });
    expect(result).toEqual(VALID_PROFILE);
  });

  it("sends a text-only user message when no imageUrl is given", async () => {
    createMock.mockResolvedValueOnce(toolUseResponse(VALID_PROFILE));
    await extractCompetitorProfile({ content: "Buy now, 50% off!" });
    const call = createMock.mock.calls[0][0];
    expect(typeof call.messages[0].content).toBe("string");
  });

  it("attaches an image block when imageUrl is given", async () => {
    createMock.mockResolvedValueOnce(toolUseResponse(VALID_PROFILE));
    await extractCompetitorProfile({ imageUrl: "https://example.com/ad.jpg" });
    const call = createMock.mock.calls[0][0];
    const content = call.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/ad.jpg" },
    });
  });

  it("forces the save_competitor_profile tool and forbids transcribing words in the system prompt", async () => {
    createMock.mockResolvedValueOnce(toolUseResponse(VALID_PROFILE));
    await extractCompetitorProfile({ content: "Buy now, 50% off!" });
    const call = createMock.mock.calls[0][0];
    expect(call.tool_choice).toEqual({ type: "tool", name: "save_competitor_profile" });
    expect(call.system).toMatch(/NEVER transcribe/);
    expect(call.system).toMatch(/strategy/i);
  });

  it("returns null and does not throw when the model omits the tool call", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "sorry, I can't help" }],
      usage: { input_tokens: 5, output_tokens: 5 },
    });
    const result = await extractCompetitorProfile({ content: "Buy now, 50% off!" });
    expect(result).toBeNull();
  });

  it("returns null when the tool input fails schema validation", async () => {
    createMock.mockResolvedValueOnce(toolUseResponse({ summary: "too short" }));
    const result = await extractCompetitorProfile({ content: "Buy now, 50% off!" });
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the API call rejects", async () => {
    createMock.mockRejectedValueOnce(new Error("network error"));
    const result = await extractCompetitorProfile({ content: "Buy now, 50% off!" });
    expect(result).toBeNull();
  });
});

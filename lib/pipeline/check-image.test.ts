import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@/lib/clients/anthropic", () => ({
  DRAFT_MODEL: "claude-sonnet-5",
  getAnthropic: () => ({ messages: { create: createMock } }),
  logUsage: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ logWarn: vi.fn() }));

import { buildImageCheckPrompt, checkHeroImage, parseImageCheck } from "./check-image";

const IMAGE = { data: "aGk=", mimeType: "image/jpeg" };

function checkResponse(input: Record<string, unknown>) {
  return {
    id: "msg_1",
    content: [{ type: "tool_use", name: "report_image_check", input }],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

describe("parseImageCheck", () => {
  it("rejects an unusable shape", () => {
    expect(parseImageCheck(undefined)).toBeNull();
    expect(parseImageCheck({ problems: [] })).toBeNull();
  });

  it("keeps named problems on a fail", () => {
    expect(parseImageCheck({ pass: false, problems: ["garbled letters", " "] })).toEqual({
      pass: false,
      problems: ["garbled letters"],
    });
  });

  it("treats a fail with nothing named as a pass", () => {
    expect(parseImageCheck({ pass: false, problems: [] })).toEqual({ pass: true, problems: [] });
  });

  it("drops stray problems on a pass", () => {
    expect(parseImageCheck({ pass: true, problems: ["meh"] })).toEqual({ pass: true, problems: [] });
  });
});

describe("buildImageCheckPrompt", () => {
  it("allows real product text only when asked", () => {
    expect(buildImageCheckPrompt("a mug", true)).toContain("Real printed text on the product itself is fine");
    expect(buildImageCheckPrompt("a mug", false)).toContain("meant to have none");
    expect(buildImageCheckPrompt("a mug", false)).toContain("a mug");
  });
});

describe("checkHeroImage", () => {
  beforeEach(() => createMock.mockReset());

  it("returns the parsed check and records usage", async () => {
    createMock.mockResolvedValueOnce(checkResponse({ pass: false, problems: ["six fingers"] }));
    const usage: unknown[] = [];
    const result = await checkHeroImage(IMAGE, { intended: "a hand", allowProductText: false, usage: usage as never });
    expect(result).toEqual({ pass: false, problems: ["six fingers"] });
    expect(usage).toHaveLength(1);
  });

  it("returns null when the call fails", async () => {
    createMock.mockRejectedValueOnce(new Error("401"));
    const result = await checkHeroImage(IMAGE, { intended: "a hand", allowProductText: false, usage: [] });
    expect(result).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { logPrompt } from "@/lib/log";
import {
  alreadyCaptured,
  capturePrompt,
  previewOf,
  sanitizeValue,
} from "./prompt-capture";

vi.mock("@/lib/log", () => ({ logPrompt: vi.fn() }));

const mockedLogPrompt = vi.mocked(logPrompt);

beforeEach(() => {
  mockedLogPrompt.mockClear();
});

describe("sanitizeValue", () => {
  it("replaces long base64 strings with a size placeholder", () => {
    const base64 = "iVBORw0KGgo".repeat(1000); // 11,000 chars, base64 alphabet
    const out = sanitizeValue({
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", data: base64 } },
          ],
        },
      ],
    }) as {
      messages: { content: { source: { data: string } }[] }[];
    };
    expect(out.messages[0].content[0].source.data).toMatch(
      /^\[\d+ KB base64 omitted\]$/,
    );
  });

  it("never touches long prose, even past the size threshold", () => {
    const prose = "Write an email about client portals. ".repeat(300);
    expect(sanitizeValue(prose)).toBe(prose);
  });

  it("passes primitives and nested structures through unchanged", () => {
    const body = { max_tokens: 4096, stream: true, tags: ["a", "b"], nul: null };
    expect(sanitizeValue(body)).toEqual(body);
  });
});

describe("previewOf", () => {
  it("uses the first non-empty line of a string system prompt", () => {
    expect(previewOf({ system: "\nYou are the brand voice.\nMore." })).toBe(
      "You are the brand voice.",
    );
  });

  it("reads block-array system prompts (cacheableSystem shape)", () => {
    const system = [{ type: "text", text: "Email design system rules." }];
    expect(previewOf({ system })).toBe("Email design system rules.");
  });

  it("falls back to the first user message when there is no system prompt", () => {
    const messages = [{ role: "user", content: "Plan a campaign about SEO" }];
    expect(previewOf({ messages })).toBe("Plan a campaign about SEO");
  });
});

describe("alreadyCaptured", () => {
  it("flags an identical body seen within the window (SDK retry)", () => {
    const body = JSON.stringify({ model: "m", messages: [{ unique: "retry-case" }] });
    expect(alreadyCaptured(body, 1_000)).toBe(false);
    expect(alreadyCaptured(body, 2_000)).toBe(true);
  });

  it("lets the same body through again after the window", () => {
    const body = JSON.stringify({ model: "m", messages: [{ unique: "expiry-case" }] });
    expect(alreadyCaptured(body, 1_000)).toBe(false);
    expect(alreadyCaptured(body, 1_000 + 11 * 60 * 1000)).toBe(false);
  });
});

describe("capturePrompt", () => {
  const url = "https://api.anthropic.com/v1/messages";

  function post(body: unknown): RequestInit {
    return { method: "POST", body: JSON.stringify(body) };
  }

  it("logs model, preview, message count, and the sanitized body", () => {
    capturePrompt(
      url,
      post({
        model: "claude-sonnet-4-6",
        system: "You write Mogul emails.",
        messages: [{ role: "user", content: "Topic: portals" }],
        max_tokens: 4096,
      }),
    );
    expect(mockedLogPrompt).toHaveBeenCalledTimes(1);
    const capture = mockedLogPrompt.mock.calls[0][0];
    expect(capture.provider).toBe("anthropic");
    expect(capture.endpoint).toBe("/v1/messages");
    expect(capture.model).toBe("claude-sonnet-4-6");
    expect(capture.preview).toBe("You write Mogul emails.");
    expect(capture.messageCount).toBe(1);
    expect(capture.request.max_tokens).toBe(4096);
  });

  it("ignores non-message endpoints like count_tokens", () => {
    capturePrompt(
      "https://api.anthropic.com/v1/messages/count_tokens",
      post({ model: "m", messages: [] }),
    );
    expect(mockedLogPrompt).not.toHaveBeenCalled();
  });

  it("ignores GET requests and bodiless calls", () => {
    capturePrompt(url, { method: "GET" });
    capturePrompt(url, { method: "POST" });
    expect(mockedLogPrompt).not.toHaveBeenCalled();
  });
});

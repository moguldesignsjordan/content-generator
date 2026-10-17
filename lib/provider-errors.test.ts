import { APIError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  ProviderHttpError,
  detectProviderOutage,
  httpStatusOf,
  outageMessage,
} from "./provider-errors";

function anthropicError(status: number, type: string, message: string): APIError {
  return new APIError(status, { type: "error", error: { type, message } }, message, new Headers());
}

describe("detectProviderOutage: Anthropic", () => {
  it("flags a 402 billing_error as billing", () => {
    const outage = detectProviderOutage(anthropicError(402, "billing_error", "Billing issue"));
    expect(outage).toMatchObject({ provider: "anthropic", kind: "billing", status: 402 });
  });

  it("flags a 400 spend-limit error as billing", () => {
    const err = anthropicError(400, "invalid_request_error", "Your credit balance is too low to access the API.");
    expect(detectProviderOutage(err)?.kind).toBe("billing");
  });

  it("flags 401 and 403 as auth", () => {
    expect(detectProviderOutage(anthropicError(401, "authentication_error", "invalid x-api-key"))?.kind).toBe("auth");
    expect(detectProviderOutage(anthropicError(403, "permission_error", "no access"))?.kind).toBe("auth");
  });

  it("ignores rate limits, overloads and ordinary bad requests", () => {
    expect(detectProviderOutage(anthropicError(429, "rate_limit_error", "slow down"))).toBeNull();
    expect(detectProviderOutage(anthropicError(529, "overloaded_error", "overloaded"))).toBeNull();
    expect(detectProviderOutage(anthropicError(400, "invalid_request_error", "max_tokens too large"))).toBeNull();
  });
});

describe("detectProviderOutage: OpenAI", () => {
  it("flags a 429 with a billing code as billing", () => {
    for (const code of ["credit_balance_exhausted", "insufficient_quota", "project_spend_limit_exceeded"]) {
      const err = new ProviderHttpError("GPT Image 429: quota", "openai", 429, code);
      expect(detectProviderOutage(err)?.kind).toBe("billing");
    }
  });

  it("treats a plain 429 as a rate limit, not an outage", () => {
    expect(detectProviderOutage(new ProviderHttpError("GPT Image 429: slow down", "openai", 429))).toBeNull();
  });

  it("flags 401 as auth", () => {
    expect(detectProviderOutage(new ProviderHttpError("GPT Image 401", "openai", 401))?.kind).toBe("auth");
  });
});

describe("detectProviderOutage: Gemini", () => {
  it("flags a 402 as billing", () => {
    const outage = detectProviderOutage(new ProviderHttpError("402 {}", "gemini", 402));
    expect(outage).toMatchObject({ provider: "gemini", kind: "billing" });
  });

  it("flags billing-not-enabled and a bad key", () => {
    const billing = new ProviderHttpError("400 FAILED_PRECONDITION: enable billing on your project", "gemini", 400);
    const key = new ProviderHttpError("400 API key not valid. Please pass a valid API key.", "gemini", 400);
    expect(detectProviderOutage(billing)?.kind).toBe("billing");
    expect(detectProviderOutage(key)?.kind).toBe("auth");
  });

  it("ignores an ordinary 400 such as a content refusal", () => {
    expect(detectProviderOutage(new ProviderHttpError("400 prompt blocked", "gemini", 400))).toBeNull();
  });
});

describe("detectProviderOutage: wrapping", () => {
  it("finds an outage rewrapped by a pipeline", () => {
    const inner = new ProviderHttpError("402 {}", "gemini", 402);
    const outer = new Error("Hero image failed", { cause: new Error("render failed", { cause: inner }) });
    expect(detectProviderOutage(outer)?.provider).toBe("gemini");
  });

  it("returns null for plain errors and non-errors", () => {
    expect(detectProviderOutage(new Error("Topic not found"))).toBeNull();
    expect(detectProviderOutage("boom")).toBeNull();
    expect(detectProviderOutage(null)).toBeNull();
  });
});

describe("httpStatusOf", () => {
  it("reads a status field, then a leading code in the message", () => {
    expect(httpStatusOf({ status: 503 })).toBe(503);
    expect(httpStatusOf(new Error("402 {\"httpMeta\":{}}"))).toBe(402);
    expect(httpStatusOf(new Error("fetch failed"))).toBeNull();
  });
});

describe("outageMessage", () => {
  it("never mentions the provider or billing", () => {
    for (const provider of ["anthropic", "gemini", "openai"] as const) {
      const message = outageMessage({ provider, kind: "billing", status: 402, detail: "" });
      expect(message).not.toMatch(/gemini|openai|anthropic|claude|billing|credit/i);
    }
  });
});
